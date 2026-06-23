---
status: done
---

# XOB-006: GenerateCategoryService + GET /generate/categories — dynamic categories from the corpus

## Implementation Details

Add `engine/src/suggest/generate-category-service.ts`. Class constructor: `GenerateCategoryService(repo: PostLibraryRepository, windowService: RepetitionWindowService)`.

**`getCategories(): Promise<GenerateCategory[]>`**

**Cold-start path (corpus < 10 originals):**

- Count `original`-kind posts in the store. If fewer than 10, return the fixed default set immediately — no corpus ranking:

  ```
  [
    { id: "default_hot_take",      label: "Hot take",        format: "hot_take",         basis: "default", cooldownStatus: "clear", sampleCount: 0 },
    { id: "default_founder_story", label: "Build-in-public", format: "founder_story",    basis: "default", cooldownStatus: "clear", sampleCount: 0 },
    { id: "default_audience_q",    label: "Question",        format: "audience_question", basis: "default", cooldownStatus: "clear", sampleCount: 0 },
    { id: "default_story",         label: "Story",           format: "story",            basis: "default", cooldownStatus: "clear", sampleCount: 0 },
  ]
  ```

**Corpus path (≥ 10 originals):**

1. Load the store. Classify each `original`-kind post with `classifyPostFormat(post.text)`. Exclude format `"other"`.
2. For each non-`"other"` format, compute:
   - `sampleCount`: number of originals classified as that format.
   - `avgReplies`: arithmetic mean of reply metrics. For each post in this format, the reply value is: `metricSnapshots.find(s => s.source === "x_live_capture")?.replies ?? post.weakMetrics.favoriteCount ?? 0`. (Live replies preferred; fall back to archive favorites as a weak proxy.)
   - `performanceScore`: `sampleCount * avgReplies` (frequency × replies-weighted performance).
3. Sort formats descending by `performanceScore`.
4. Call `windowService.compute(7)` to get the `CooldownReport`.
5. Annotate each format's `cooldownStatus` from the report: look up by `signal.format`; if no signal, `"clear"`.
6. Assign `basis`:
   - Top format (highest `performanceScore`) → `"top_performer"`.
   - Remaining formats → `"frequent"`.
7. Return top 3–4 formats (minimum 3; include a 4th if `performanceScore` is non-zero and the format is not in `cooldown` status). If fewer than 3 non-`"other"` formats exist, backfill with default entries (`basis: "default"`, `sampleCount: 0`, `cooldownStatus: "clear"`) from the cold-start set until 3 are present.
8. Each returned `GenerateCategory` has:
   - `id`: `"corpus_${format}"` for corpus-derived entries.
   - `label`: human-readable display label. Use the same label map as the overlay button map: `hot_take → "Hot take"`, `founder_story → "Build-in-public"`, `audience_question → "Question"`, `story → "Story"`; for all other formats, derive from the format key (replace `_` with space, title-case).
   - `format`, `basis`, `cooldownStatus`, `sampleCount`.

**Transport bindings:**

- In-process: `__xbuilder_getGenerateCategories` binding (registered in `ExposeFunctionTransport` in XOB-016).
- HTTP: `GET /generate/categories` — registered in `buildServer` (in `engine/src/server/server.ts`). Response parsed via `parseResponseContract(z.array(generateCategorySchema))`. On `PostLibraryStorageError` → respond with `library_storage_failed` (status 500). No request body.

**Export** `GenerateCategoryService` from `engine/src/index.ts`.

## Data Models

From `@x-builder/shared` (XOB-002):

- `generateCategorySchema` — `{ id: ≤120, label: ≤40, format: detectedPostFormat, basis: enum(top_performer|frequent|default), cooldownStatus: cooldownStatusSchema, sampleCount: int≥0 }`
- `cooldownStatusSchema` — `enum("clear" | "warming" | "cooldown")`

Existing types reused:

- `classifyPostFormat` — `engine/src/deterministic/format-classifier.ts`
- `RepetitionWindowService` / `CooldownReport` — XOB-005
- `PostLibraryRepository` / `loadStore` — `engine/src/server/post-library-repository.ts` (v2, XOB-003)
- `liveMetricSnapshotSchema` — v2 store discriminated union (`source: "x_live_capture"`)

## Integration Point

**`buildServer` wiring** (`engine/src/server/server.ts`):

- Add `generateCategoryService?: GenerateCategoryService` to `BuildServerOptions`.
- Register `GET /generate/categories` as a Fastify route. Construct `GenerateCategoryService` lazily from `postLibraryRepository` + `RepetitionWindowService` if not injected (default construction mirrors how `DeterministicAnalysisService` is constructed inline today).
- Response: `parseResponseContract(z.array(generateCategorySchema), await service.getCategories())`.
- Error: `PostLibraryStorageError` → `library_storage_failed` (status 500).

**`ExposeFunctionTransport`** (XOB-016) registers `__xbuilder_getGenerateCategories` → `GenerateCategoryService.getCategories`.

**`EngineTransport`** (XOB-002): `getGenerateCategories():Promise<GenerateCategory[]>` — method 16.

## Scope Boundaries / Out of Scope

- No LLM call — purely deterministic ranking.
- No theme/topic-based categories (Tier 2, deferred).
- Hardcoded label→format button map in the overlay UI is deleted as a UI constant; the overlay renders one button per returned `GenerateCategory`.
- `cooldown`-status formats are annotated but not excluded from the return list — the overlay may choose to grey them out; the service does not hide them.
- No caching in v1; `getCategories` reads from disk on every call.
- The `id` field convention (`"corpus_${format}"` vs `"default_*"`) is stable across calls for the same basis but not intended as a persistent identifier.

## Test Strategy & Fixture Ownership

**Suite:** `engine/src/suggest/tests/generate-category-service.test.ts` (Vitest)

**Setup:** `os.tmpdir()` + `mkdtemp`; construct `JsonFilePostLibraryRepository` against the temp dir. Seed corpus via `repo.upsertPosts()`. Construct a real `RepetitionWindowService` against the same repo (with a `now` stub for deterministic windows).

**LLM dependency:** none.

**Dependency category:** unit/integration (disk I/O).

**Isolation:** each test gets its own `mkdtemp` tmpdir, cleaned up in `afterEach`.

Coverage:

1. Corpus < 10 originals → returns 4 defaults, all `basis: "default"`, `sampleCount: 0`, `cooldownStatus: "clear"`.
2. Corpus ≥ 10 originals with skewed `hot_take` frequency and live replies → `hot_take` appears first with `basis: "top_performer"`.
3. Cooldown condition on `hot_take` (4+ in last 7 days via `RepetitionWindowService`) → returned `hot_take` category has `cooldownStatus: "cooldown"`.
4. Format `"other"` posts are excluded from ranking; do not appear in result.
5. HTTP route: `buildServer().inject({ method: 'GET', url: '/generate/categories' })` → status 200, response parses as `z.array(generateCategorySchema)`.
6. HTTP route: injected service throws `PostLibraryStorageError` → status 500, `code: "library_storage_failed"`.

## Definition of Done

- `GenerateCategoryService.getCategories` implemented with cold-start and corpus paths.
- `GET /generate/categories` route registered in `buildServer`.
- `GenerateCategoryService` exported from `engine/src/index.ts`.
- All tests in the coverage list pass.
- TypeScript strict-mode clean (`pnpm typecheck` green).

## Acceptance Criteria

**Given** a corpus with ≥ 10 originals, heavily skewed toward `hot_take` (highest frequency × replies-weighted performance), and a `hot_take` cooldown (4+ in last 7 days)

**When** `getCategories()` is called

**Then** the first returned category has `format: "hot_take"`, `basis: "top_performer"`, `cooldownStatus: "cooldown"`, `sampleCount > 0`.

---

**Given** an empty corpus (0 posts)

**When** `getCategories()` is called

**Then** the result contains exactly 4 items, all with `basis: "default"`, `sampleCount: 0`, `cooldownStatus: "clear"`, and formats `hot_take`, `founder_story`, `audience_question`, `story`.

---

**Given** a seeded corpus and a running `buildServer` with a `GenerateCategoryService`

**When** `GET /generate/categories` is called

**Then** status 200 and response body parses as `z.array(generateCategorySchema)` with 3–4 items.

---

**Given** the `PostLibraryRepository` throws `PostLibraryStorageError` on `loadStore`

**When** `GET /generate/categories` is called

**Then** status 500 with `code: "library_storage_failed"` in the error envelope.

## Edge Cases

- All originals classify as `"other"` → no corpus-derived categories; return 4 defaults (backfill).
- Exactly 3 distinct non-`"other"` formats with non-zero `performanceScore` → return exactly 3.
- `weakMetrics.favoriteCount` absent and no live replies → `avgReplies: 0`; ranking is by frequency only.
- Multiple formats have identical `performanceScore` → stable tie-break by format name alphabetically.
- Corpus has posts but 0 originals (all replies/reposts) → corpus count < 10 → cold-start path returns 4 defaults.

## Pipeline Log

Lean Red-first lane.

- **Red** (`6556d83`): `generate-category-service.test.ts` — 12 tests (4 service-logic + edges + 2 HTTP-route via `buildServer().inject`) + a classifier-guard test. Verified format fixtures (hot_take/founder_story/audience_question/story/other); 500-path injects a `GenerateCategoryService` over a `failingRepository()`. RED via 3 expected feature-missing errors (missing module + `generateCategoryService` option). Flagged the all-other → 4-defaults nuance.
- **Gates** (post-Red, base `6d8b94f`): `[scope]` + `[ticket-ids]` CLEAN.
- **Green** (`2133c49`): `GenerateCategoryService.getCategories` (cold-start + corpus ranking by `sampleCount × avgReplies`, alpha tie-break, cooldown annotation via `windowService.compute(7)`, backfill nuance) + `GET /generate/categories` route + `BuildServerOptions.generateCategoryService?` + a dedicated `libraryStorageFailedError()` helper (archive helper emits a different code; `library_storage_failed`/`library` both valid in `apiErrorSchema`) + barrel export. 12/632 tests, typecheck 9/9.
- **Gates** (post-Green, base `6556d83`): all CLEAN; no test files touched.
- **Blue (Validate Green)**: APPROVE — typecheck honest (cache-bypassed), ranking/cooldown/backfill logic faithful, route 200 + 500 paths correct, new error helper schema-valid, no `@ts-ignore`/`any`, guarded non-null assertions.
- **Yellow (intent)**: APPROVE — real deterministic ranking of the user's own formats (no LLM, no fake), wired to transport method 16 (`getGenerateCategories`), zero-trace (no theme/topic, no cache), backfill coherent (4 only when no corpus signal; 3–4 when usable formats exist), `libraryStorageFailedError` justified + used.
- Concerns ledger: none. Status → **done**.
