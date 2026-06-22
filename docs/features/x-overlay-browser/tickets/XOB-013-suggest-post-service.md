---
status: done
---

# XOB-013: SuggestPostService + POST /posts/suggest

Implement `SuggestPostService.suggest` and the `POST /posts/suggest` HTTP route. The service deterministically ranks the live corpus by replies-weighted performance (excluding cooldown formats via `RepetitionWindowService`), then executes one `StructuredLlmService` pass to draft in the chosen lane. Falls back to deterministic resurfacing when the LLM fails. Returns `status: "insufficient_corpus"` when the corpus is below `minimumCorpusSize` (10).

## Implementation Details

### `SuggestPostService` (new — `engine/src/suggest/suggest-post-service.ts`)

Constructor-injected per the DI pattern:

```ts
class SuggestPostService {
  constructor(
    private readonly repository: PostLibraryRepository,
    private readonly windowService: RepetitionWindowService,
    private readonly llm: StructuredLlmService,
    private readonly resolveProvider: JudgeProviderResolver,
    private readonly now?: () => string,  // ISO datetime; defaults to new Date().toISOString()
  ) {}

  async suggest(request: SuggestPostRequest): Promise<SuggestPostResponse>
}
```

**Step 1 — load corpus:**
`await this.repository.loadStore()` → extract canonical own posts. Count originals (kind `original`, not `reply` or `repost_reference`).

If `originals.length < minimumCorpusSize` (10) → return immediately:
```ts
{
  status: "insufficient_corpus",
  suggestions: [],
  cooldown: await this.windowService.compute(request.windowDays ?? 7),
  minimumCorpusSize: 10,
}
```

**Step 2 — compute cooldown:**
`const cooldownReport = await this.windowService.compute(request.windowDays ?? 7)`.

Collect cooldown-format set: `cooldownFormats = new Set(cooldownReport.signals.filter(s => s.status === "cooldown").map(s => s.format))`.

Also apply `request.excludeFormats` (additional client-side exclusions): union with `cooldownFormats`.

**Step 3 — deterministic ranking:**
For each `detectedPostFormat` present in the corpus (via `classifyPostFormat` per post — imported from the existing engine deterministic module), aggregate:
- `replyScore`: sum of `liveMetrics.replies` (from `x_live_capture` metricSnapshots) across all posts in this format. Fallback: `favoriteCount` from `archive_tweets_js` snapshot when no live replies metric is available (weakMetrics).
- `postCount`: number of originals in this format.
- `weightedScore`: `replyScore / Math.max(postCount, 1)` (replies-per-post average).

Exclude any format in `cooldownFormats ∪ excludeFormats`. Sort descending by `weightedScore`. Take top format as `chosenFormat`. If tie, prefer higher `postCount`.

If no non-excluded format remains (entire corpus on cooldown): use a deterministic resurfacing fallback (see LLM failure path below).

Collect up to 5 `sourceExamplePostIds` from the top-performing posts in `chosenFormat` (by `weightedScore` proxy, highest first).

Select `angle` based on the chosen format's content characteristics: map `detectedPostFormat` to a preferred `angle` (e.g. `hot_take → caution`, `founder_story → constructive`, `audience_question → curious`, `story → observational`) — this mapping is a constant in the service, not a schema concern.

**Step 4 — LLM pass:**
Call `this.llm.generateStructured` with:
- `provider`: resolved via `this.resolveProvider()`
- `purpose: "writer_first_pass"` (existing enum value)
- `instructions`: a system prompt that:
  1. Describes `chosenFormat` and `angle`
  2. Provides up to 5 example post texts from `sourceExamplePostIds` as style reference
  3. Instructs the model to produce exactly `request.count` (default 3) draft posts in that format and angle, each ≤ 280 chars, original and not repeating examples
- `structuredOutput.schema`: `{ type: "object", additionalProperties: false, required: ["suggestions"], properties: { suggestions: { type: "array", minItems: 1, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["id","text","rationale"], properties: { id: { type: "string" }, text: { type: "string", minLength: 1, maxLength: 8000 }, rationale: { type: "string", maxLength: 280 } } } } } }`
- `structuredOutput.parser`: maps LLM output to `SuggestedPost[]` filling in `format`, `angle`, `cooldownStatus`, `sourceExamplePostIds`, `generatedBy: "llm"`
- `options.timeoutMs`: 60 000 ms (single LLM call)

If `generateStructured` returns `status: "failed"` → fall through to deterministic fallback.

**Step 5 — deterministic fallback (on LLM failure OR no non-excluded format):**
Resurface up to `request.count` high-performing original posts from the corpus, transformed into suggestion objects:
- `text`: original post text (verbatim)
- `rationale`: a static string like `"High-performing post in your archive, suggested for reposting or inspiration."`
- `generatedBy: "deterministic_fallback"`
- `format`: from `classifyPostFormat(post.text)`
- `angle`: from the static mapping above
- `cooldownStatus`: from `cooldownReport.signals` for that format (or `clear` if no signal)
- `sourceExamplePostIds`: `[post.platformPostId]`

**Response:**
```ts
{
  status: "ready",
  suggestions: SuggestedPost[],   // max 4
  cooldown: cooldownReport,
  minimumCorpusSize: 10,
}
```

### `suggestPostRequestSchema` (in `@x-builder/shared` — authored by XOB-002)

Shape per `§3` of `sysarch-output.md`:
```
{ windowDays: int 1..90 default 7, excludeFormats: detectedPostFormat[] default [], count: int 1..4 default 3 }
```
This ticket consumes it; does not author it.

### `suggestPostResponseSchema` (in `@x-builder/shared` — authored by XOB-002)

Shape:
```
{
  status: "ready" | "insufficient_corpus",
  suggestions: suggestedPost[] max 4,
  cooldown: cooldownReport,
  minimumCorpusSize: literal 10,
}
```

### `suggestedPostSchema` (in `@x-builder/shared` — authored by XOB-002)

Shape:
```
{
  id: string,
  format: detectedPostFormat,
  angle: "curious"|"caution"|"constructive"|"observational",
  text: string 1..8000,
  rationale: string ≤280,
  cooldownStatus: "clear"|"warming"|"cooldown",
  sourceExamplePostIds: string[] max 5,
  generatedBy: "llm"|"deterministic_fallback",
}
```

### `POST /posts/suggest` route (`engine/src/server/server.ts`)

Add:
```ts
app.post("/posts/suggest", async (request, reply) => {
  const input = suggestPostRequestSchema.parse(request.body);
  try {
    const result = await suggestPostService.suggest(input);
    return reply.send(parseResponseContract(suggestPostResponseSchema, result));
  } catch (error) {
    if (error instanceof PostLibraryStorageError) {
      throw new NormalizedApiError(libraryStorageFailedError());
    }
    throw new NormalizedApiError(generationError());
  }
});
```

`suggestPostService` is constructed in `buildServer`:
```ts
const suggestPostService =
  options.suggestPostService ??
  new SuggestPostService(
    postLibraryRepository,
    repetitionWindowService,
    new StructuredLlmService({ providers }),
    resolveProvider,
  );
```

Add `suggestPostService?: SuggestPostService` and `repetitionWindowService?: RepetitionWindowService` to `BuildServerOptions`. `repetitionWindowService` defaults to `new RepetitionWindowService(postLibraryRepository)`.

### `__xbuilder_suggestPost` binding (XOB-016)

`ExposeFunctionTransport.bindAll` registers this binding pointing to `suggestPostService.suggest`. Defined by XOB-016 consuming this ticket's service.

## Data Models

`SuggestPostRequest`: `{ windowDays?: int 1..90, excludeFormats?: detectedPostFormat[], count?: int 1..4 }` with defaults.

`SuggestPostResponse`:
```
{
  status: "ready" | "insufficient_corpus",
  suggestions: SuggestedPost[],
  cooldown: CooldownReport,
  minimumCorpusSize: 10,
}
```

`SuggestedPost`: per `suggestedPostSchema` (XOB-002).

`minimumCorpusSize` constant: `10` (literal in `suggestPostResponseSchema` and used in service logic).

## Integration Point

- `POST /posts/suggest` — new route, `engine/src/server/server.ts`.
- `__xbuilder_suggestPost` — `EngineTransport` method (registered by XOB-016).
- `RepetitionWindowService` from XOB-005 — provides `compute(windowDays)` → `CooldownReport`; cooldown-excluded formats derived from signals with `status: "cooldown"`.
- `PostLibraryRepository` (v2, XOB-003) — `loadStore()` source of corpus.
- `StructuredLlmService.generateStructured` (`purpose: "writer_first_pass"`) — single LLM pass.
- `createSettingsJudgeProviderResolver` — provider resolution per-call.
- `classifyPostFormat` — existing engine deterministic module, used to bucket posts by format.
- `SuggestAffordance`/`SuggestCard` overlay components (XOB-028) call `__xbuilder_suggestPost`.

## Scope Boundaries / Out of Scope

- No judge pass on suggestions (unlike XOB-011). Suggestions are not pre-judged.
- `GenerateCategoryService` (XOB-006) is a separate service for the generate-rail categories; not in scope here.
- Reply-assist and draft scoring for other people's posts are deferred (v1 non-goal).
- SQLite migration is deferred (post-v1 CHORE).
- No streaming. Single request/response.
- The `minimumCorpusSize` value of 10 is hardcoded as a literal; no configuration surface.

## Test Strategy & Fixture Ownership

**Framework:** Vitest (existing harness, mirror `engine/src/llm/tests/judge-draft-service.test.ts` and `engine/src/server/tests/posts-analyze.test.ts`).

**Mock surface:**
- `PostLibraryRepository` fake: inject a stub with a controlled `loadStore()` return value (seeded corpus, variable size and format distribution).
- `RepetitionWindowService` fake: inject a stub returning a controlled `CooldownReport` with configurable signals.
- `StructuredLlmService` fake: inject a stub returning `{ status: "success", output: { suggestions: [...] } }` or `{ status: "failed" }`.
- `buildServer({ suggestPostService, repetitionWindowService }).inject()` for route-level tests.
- `os.tmpdir()` / `mkdtemp` tmpdir for any test that exercises the real `PostLibraryRepository` (dependency isolation pattern from `post-library-repository.test.ts`).

**Test cases (own in `engine/src/suggest/tests/suggest-post-service.test.ts`):**

1. **Clear top-performing format, LLM succeeds:**
   Seed corpus with 15 originals: 10 `hot_take` (avg 5 replies each) and 5 `founder_story` (avg 2 replies each). No cooldown signals. LLM fake returns 3 suggestions. Assert `status: "ready"`, all suggestions have `format: "hot_take"`, `generatedBy: "llm"`.

2. **Cooldown format excluded:**
   Seed corpus with 15 originals: 10 `hot_take` (high replies) but `hot_take` is in cooldown. 5 `founder_story` (lower replies, not in cooldown). Assert suggestions have `format: "founder_story"`, not `hot_take`.

3. **LLM failure → deterministic fallback:**
   LLM fake returns `status: "failed"`. Assert `status: "ready"`, suggestions have `generatedBy: "deterministic_fallback"`, texts are verbatim post texts from the corpus.

4. **Insufficient corpus (< 10 originals):**
   Seed corpus with 8 originals. Assert `status: "insufficient_corpus"`, `suggestions: []`, `minimumCorpusSize: 10`.

5. **`excludeFormats` from request:**
   Seed corpus with formats [hot_take, founder_story, audience_question]. Request with `excludeFormats: ["hot_take"]`. hot_take has highest score. Assert suggestions are not `hot_take`.

6. **All formats on cooldown → deterministic fallback:**
   All corpus formats in cooldown. Assert `generatedBy: "deterministic_fallback"`.

7. **`count` parameter respected:**
   Request with `count: 1`. Assert `suggestions.length === 1` (or 1 from LLM/fallback).

**Route tests (own in `engine/src/server/tests/posts-suggest.test.ts`):**

8. **HTTP 200 ready:** `buildServer({ suggestPostService: fakeReady })` → `POST /posts/suggest` with `{}` → assert 200, `status: "ready"`.
9. **HTTP 200 insufficient_corpus:** fake returns insufficient → assert 200, `status: "insufficient_corpus"`.
10. **HTTP 500 library_storage_failed:** fake throws `PostLibraryStorageError` → assert 500, error code `library_storage_failed`.

**Dependency category:** unit (service) + integration (route via `buildServer().inject()`). Tmpdir where real repository is used. Mock `StructuredLlmService` and fake `RepetitionWindowService` for pure service tests.

## Definition of Done

- `SuggestPostService` exists at `engine/src/suggest/suggest-post-service.ts`, exported from `engine/src/index.ts`.
- Deterministic ranking excludes cooldown formats before LLM pass.
- LLM failure surfaces `generatedBy: "deterministic_fallback"`, not an error.
- `insufficient_corpus` response when originals < 10.
- `POST /posts/suggest` route registered in `buildServer`.
- `BuildServerOptions` accepts `suggestPostService` and `repetitionWindowService` overrides for tests.
- All new tests pass; existing tests unaffected.
- `pnpm typecheck` and `pnpm build` green.

## Acceptance Criteria

**Given** a corpus with a clear top-performing non-cooldown format (e.g. 15 `hot_take` posts, each with 5 live replies, no cooldown on `hot_take`):
**When** `POST /posts/suggest` is called with `{}`:
**Then** `status` is `"ready"`, suggestions are in the `hot_take` format, each has `rationale`, `generatedBy: "llm"`.

**Given** `hot_take` is in cooldown (`RepetitionWindowService` reports `hot_take` signal with `status: "cooldown"`):
**When** `POST /posts/suggest` is called:
**Then** no suggestion has `format: "hot_take"`.

**Given** a corpus of 8 original posts:
**When** `POST /posts/suggest` is called:
**Then** `status` is `"insufficient_corpus"`, `suggestions` is `[]`, `minimumCorpusSize` is `10`.

**Given** the LLM call fails (`status: "failed"`):
**When** `POST /posts/suggest` is called with a sufficient corpus:
**Then** `status` is `"ready"`, `suggestions` have `generatedBy: "deterministic_fallback"`, the route does NOT return an error.

## Edge Cases

- Entire corpus is reposts/replies (no `original` posts): `originals.length === 0 < 10` → `insufficient_corpus`.
- Corpus has exactly 10 originals: at threshold — proceed to ranking, not `insufficient_corpus`.
- All formats on cooldown AND LLM fails: return deterministic fallback posts from any format (ignore cooldown for the fallback — deterministic resurfacing is the escape hatch).
- `excludeFormats` excludes a format not in the corpus: silently ignored.
- `count: 4` requested but corpus has only 3 distinct high-scoring posts: return what's available (up to `count`); `suggestedPostSchema` allows a shorter array within `max(4)`.
- Live metrics absent (archive-only corpus, no `x_live_capture` snapshots): fallback to `favoriteCount` from `archive_tweets_js` snapshots as the weak-signal reply proxy; ranking still works.
- `loadStore` throws `PostLibraryStorageError`: propagate → route maps to `library_storage_failed`.
- `RepetitionWindowService.compute` throws: catch → use an empty `CooldownReport` with `signals: []` so the route does not fail; log the error for observability.
- `classifyPostFormat` returns `"other"` for a post: exclude `"other"` format from the ranking candidates (not a meaningful suggest target).

## Pipeline Log

Lean Red-first lane.

- **Red** (`acda20e`): `suggest-post-service.test.ts` (11: clear-top-format/LLM, cooldown-exclusion, LLM-fail→fallback, insufficient-corpus, excludeFormats, all-cooldown→fallback, count, archive-only ranking, threshold-10, window-throw-swallow) + `posts-suggest.test.ts` (3 route: 200 ready, 200 insufficient, 500 library_storage_failed). Real `StructuredLlmService` wrapping a fake provider that echoes raw suggestions through the contract parser; classifier-locked fixtures. RED via missing module + 3×404; `rg "XOB-"` clean.
- **Gates** (post-Red, base `d256658`): `[scope]` + `[ticket-ids]` CLEAN.
- **Green** (`033e3af`): `SuggestPostService` (insufficient-corpus short-circuit; cooldown ∪ excludeFormats exclusion; deterministic replies-per-post ranking with live-`replies`/`favoriteCount` fallback narrowed on `.source`, `"other"` excluded, tie→postCount; format→angle map; ONE `writer_first_pass` LLM pass 60s; deterministic resurfacing fallback on LLM-fail/all-cooldown; window-throw swallow → empty report) + `POST /posts/suggest` route + `suggestPostService?` option (reusing the shared `repetitionWindowService`) + barrel export. 11/3/716 tests, typecheck+build green. 3 files.
- **Gates** (post-Green, base `acda20e`): all CLEAN; no test files touched.
- **Blue (Validate Green)**: APPROVE — ran all commands (11/3/716, cache-bypassed `tsc` EXIT 0, forced clean build green); ranking/exclusion/fallback/swallow correct, route error mapping correct, shared `repetitionWindowService` reused, typecheck honest. Discovered the flagged parser premise was inverted: production ALSO double-applies the parser (providers apply it, then `StructuredLlmService` re-applies), so idempotency is REQUIRED production behavior, not a test artifact — fixpoint verified.
- **Yellow (intent)**: APPROVE — real rank+LLM+fallback (no judge pass per scope), exported per DoD, wired to method 13, cooldown-aware with deterministic escape hatch, never dead-ends, zero-trace. Confirmed the test fake faithfully mirrors the real provider parser pre-application (established codebase pattern).

### Concerns Ledger
- **Comment clarity (trivial, non-blocking):** the service's "idempotent parser" comment frames the double-parse as a test accommodation; it's actually a production-path requirement (real CLI providers pre-apply `structuredOutput.parser`, then `StructuredLlmService.parseProviderOutput` re-applies). Comment is accurate but undersells why — a future reader might mistake the dual-shape handling for removable test-only code. Worth a one-line comment improvement in a future cleanup; no behavior impact.
- Status → **done**.
