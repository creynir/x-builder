---
status: done
---

# XOB-005: RepetitionWindowService — real rolling-window cooldown over the merged corpus

## Implementation Details

Add `engine/src/capture/repetition-window-service.ts`. Class constructor: `RepetitionWindowService(repo: PostLibraryRepository, now?: () => Date)`.

**`compute(windowDays: number = 7): Promise<CooldownReport>`**

- Load the store via `repo.loadStore()`.
- Determine `corpusSource`:
  - `"empty"` when `store.posts` is empty.
  - `"live"` when all posts have at least one `x_live_capture` metricSnapshot and none have `archive_tweets_js`.
  - `"archive"` when all posts have only `archive_tweets_js` snapshots.
  - `"merged"` otherwise (both sources present).
- Filter to `original` kind posts only (exclude `reply`, `repost_reference`, `unknown`) for the window count — same population the scoring engine considers.
- For each post, classify via `classifyPostFormat(post.text)`. Exclude format `"other"`.
- Partition posts into `inWindow` (where `post.createdAt >= windowCutoff`) and `all`. `windowCutoff = now() - windowDays * 24 * 60 * 60 * 1000`.
- Group `inWindow` posts by format. For each format that appears in `inWindow`:
  - `countInWindow`: count of posts in that format in the window.
  - `lastPostedAt`: max `createdAt` among all posts in that format (not just in-window — most recent ever).
  - `status`:
    - `"cooldown"` when `countInWindow >= 4`.
    - `"warming"` when `countInWindow >= 2`.
    - `"clear"` otherwise.
  - `message`: human-readable string (≤ 240 chars), e.g. `"4 hot_take posts in the last 7 days — give this format a rest."` / `"2 hot_take posts in the last 7 days — warming up."` / `"1 hot_take post in the last 7 days — all clear."`. Exact wording is implementation detail; must reference `countInWindow` and `windowDays`.
- Return `cooldownReportSchema`-valid object: `{ windowDays, generatedAt: now().toISOString(), corpusSource, signals: CooldownSignal[] (max 40) }`.
- Signals list: one entry per format that has `countInWindow >= 1`. Sort descending by `countInWindow`.
- On `PostLibraryStorageError`: re-throw.

**`asRepeatHistory(report: CooldownReport): RepeatHistoryEntry[]`**

Pure function (no async, no I/O). Maps each `CooldownSignal` in `report.signals` to a `RepeatHistoryEntry`:
- `format`: `signal.format`
- `lastPostedAt`: `signal.lastPostedAt` (use current time as fallback if absent — unlikely given signal exists because posts are in window)
- `countLast7d`: `signal.countInWindow`

This feeds directly into `computeRepeatMultiplier` (already in `engine/src/deterministic/`) via the `scoringContext.repeatHistory` path.

**Export** `RepetitionWindowService` from `engine/src/index.ts`.

## Data Models

All schemas from `@x-builder/shared` (XOB-002):

- `cooldownReportSchema` — `{ windowDays, generatedAt, corpusSource: enum(live|archive|merged|empty), signals: CooldownSignal[] }`
- `cooldownSignalSchema` — `{ format: detectedPostFormat, countInWindow: int, windowDays: 1..90, lastPostedAt?: datetime, status: enum(clear|warming|cooldown), message: ≤240 }`
- `cooldownStatusSchema` — `enum("clear" | "warming" | "cooldown")`

Existing engine types reused:

- `classifyPostFormat(text: string): PostFormat` — from `engine/src/deterministic/format-classifier.ts` (already exported from `engine/src/index.ts`)
- `RepeatHistoryEntry` / `repeatHistoryEntrySchema` — from `@x-builder/shared` `deterministic-analysis.ts` (`{ format, lastPostedAt, countLast7d }`)
- `computeRepeatMultiplier` — existing engine function; `asRepeatHistory` feeds it via the scoring path

## Integration Point

`RepetitionWindowService` is consumed by:

- **XOB-006** (`GenerateCategoryService`): calls `compute(7)` to annotate `cooldownStatus` on each category and exclude cooldown formats from top-performer ranking.
- **XOB-007** (`LiveContextResolver`): calls `compute(windowDays)` → `asRepeatHistory(report)` → injects into `scoringContext.repeatHistory` before the existing `ArchiveStudioContextResolver.mergeAnalysisRequest` runs.
- **XOB-009** (`GET /capture/cooldown` route): thin HTTP wrapper — calls `compute(windowDays)` and returns the report.

The service reads the merged corpus (archive + live), so it naturally covers both XOB-003 archive posts and XOB-004 live-ingested posts without additional plumbing.

## Scope Boundaries / Out of Scope

- Does not extend `ArchiveDerivedContextService` — that service fakes the window via static `repeatHistory`; this is a focused new service with real rolling-window semantics.
- Does not write to the store — read-only.
- No HTTP route in this ticket (that is XOB-009).
- `windowDays` validation (1..90) is owned by the XOB-009 route schema as the first-line guard. The service itself returns a `cooldownReportSchema`-valid report, and that schema also bounds `windowDays` to `1..90` — so an out-of-range `windowDays` reaching `compute` directly is **rejected by the schema parse (ZodError)**, not silently computed. (Corrected from an earlier draft that said "accepts any positive integer" — that contradicted the shared schema bound; flagged by Blue+Yellow in validation.)
- No per-topic or per-theme analysis — signals are by `detectedPostFormat` only.
- Post-v1 threshold tuning (e.g., different `warming`/`cooldown` counts) is out of scope.

## Test Strategy & Fixture Ownership

**Suite:** `engine/src/capture/tests/repetition-window-service.test.ts` (Vitest)

**Setup:** `os.tmpdir()` + `mkdtemp`; construct `JsonFilePostLibraryRepository` against the temp dir. Seed corpus by calling `repo.upsertPosts()` directly with `CanonicalOwnPostInput` fixtures that have controlled `createdAt` values.

**LLM dependency:** none.

**Dependency category:** unit/integration (disk I/O; no subprocess).

**Isolation:** each test gets its own `mkdtemp` tmpdir, cleaned up in `afterEach`. Pass a `now` stub to `RepetitionWindowService` to make window boundary deterministic.

Coverage:

1. 4 `hot_take` originals with `createdAt` within last 7 days + 1 `hot_take` from 30 days ago → `compute(7)` → `signals` contains exactly one signal for `hot_take` with `countInWindow: 4`, `status: "cooldown"`.
2. 2 `founder_story` in last 7 days → signal `status: "warming"`.
3. 1 `story` in last 7 days → signal `status: "clear"`.
4. Empty corpus → `corpusSource: "empty"`, `signals: []`.
5. Posts of kind `reply` or `repost_reference` are excluded from window counts even if `createdAt` is recent.
6. Format `"other"` posts are excluded from signals even if within window.
7. `asRepeatHistory` maps a `CooldownReport` with two signals to two `RepeatHistoryEntry` values with correct `countLast7d`.
8. Mixed archive + live corpus → `corpusSource: "merged"`.

## Definition of Done

- `RepetitionWindowService.compute` and `asRepeatHistory` implemented.
- `RepetitionWindowService` exported from `engine/src/index.ts`.
- All tests in the coverage list pass.
- TypeScript strict-mode clean (`pnpm typecheck` green).

## Acceptance Criteria

**Given** a corpus with 4 `hot_take` original posts dated within the last 7 days and 1 `hot_take` post dated 30 days ago

**When** `compute(7)` is called

**Then** the returned report has exactly one signal for `hot_take` with `countInWindow: 4` and `status: "cooldown"`; the 30-day-old post is not counted in `countInWindow`.

---

**Given** an empty corpus (no posts)

**When** `compute(7)` is called

**Then** the report has `corpusSource: "empty"` and `signals: []`; no exception is thrown.

---

**Given** a corpus containing only `reply`-kind posts with `hot_take` text within the last 7 days

**When** `compute(7)` is called

**Then** `signals` is empty (replies excluded from window counts).

---

**Given** a `CooldownReport` with a `hot_take` signal (`countInWindow: 4`, `lastPostedAt: <datetime>`)

**When** `asRepeatHistory(report)` is called

**Then** the result contains a `RepeatHistoryEntry` with `format: "hot_take"`, `countLast7d: 4`, and `lastPostedAt` matching the signal.

## Edge Cases

- `windowDays` of 0 or > 90 reaching `compute` directly: the final `cooldownReportSchema.parse` rejects it (ZodError), since the shared schema bounds `windowDays` to `1..90`. The XOB-009 route validates the range before calling, so consumers never hit this; an in-range value (e.g. a very large-but-≤90, or a window covering all/no posts) computes correctly.
- A format appears in the corpus but only outside the window → no signal emitted (no `countInWindow: 0` signals in the report).
- Posts with `createdAt` exactly at the window boundary (within milliseconds): boundary is inclusive — `>= windowCutoff`.
- More than 40 distinct formats in window (highly unlikely given the classifier has 17 formats) → signals array capped at 40 by schema; top 40 by `countInWindow` are kept.
- `PostLibraryStorageError` from `loadStore` → re-thrown unchanged.
- Corpus with only `"other"` format posts → `signals: []` (no signals for excluded format).

## Pipeline Log

Lean Red-first lane.

- **Red** (`85ad344`): `repetition-window-service.test.ts` — 19 tests (8 Coverage + ACs + edges + a classifier-guard test). Verified fixture text → format mappings via a throwaway probe against the real `classifyPostFormat`, then locked them with an in-suite guard test. Deterministic `now` injection. RED via missing module.
- **Gates** (post-Red, base `8ff9007`): `[scope]` + `[ticket-ids]` CLEAN.
- **Green** (`4f7af02`): `RepetitionWindowService.compute` + `asRepeatHistory` + barrel export. Read-only; result parsed through `cooldownReportSchema` (fail-fast). `corpusSource` via `.source` discriminant inspection; `lastPostedAt` spans all originals while `countInWindow` is window-bounded (inclusive `>=`). 19/620 tests, typecheck 9/9.
- **Gates** (post-Green, base `85ad344`): all CLEAN; no test files touched.
- **Blue (Validate Green)**: APPROVE_WITH_CONCERNS — all mechanical green, typecheck honest (cache-bypassed), logic faithful to spec (corpusSource, inclusive window, thresholds, sort/cap, error propagation, ISO lexical ordering sound).
- **Yellow (intent)**: APPROVE_WITH_CONCERNS — real rolling-window (no delegation to the static `ArchiveDerivedContextService` fake), wired to XOB-006/007/009, `asRepeatHistory` shape matches `repeatHistoryEntrySchema`/`computeRepeatMultiplier`, merged-corpus coverage uniform, zero-trace.

### Concern — RESOLVED (doc fix)
- **Spec/schema contradiction on out-of-range `windowDays`** — ticket prose claimed `compute` "accepts any positive integer" / "windowDays of 0 or very large computes correctly," but the service's terminal `cooldownReportSchema.parse` bounds `windowDays` to `1..90`, so out-of-range throws a ZodError. Code is correct (fail-fast); the prose was wrong. **Fixed in this ticket's Scope Boundaries + Edge Cases** to state out-of-range is schema-rejected (XOB-009 route is the first-line guard; consumers always pass in-range). No code change needed.
