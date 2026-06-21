---
status: todo
---

# XOB-007: LiveContextResolver + /posts/analyze wiring — auto followers/median/repeatHistory + per-item cooldown

## Implementation Details

Add `engine/src/capture/live-context-resolver.ts`. Class constructor: `LiveContextResolver(repo: PostLibraryRepository, windowService: RepetitionWindowService)`.

**`mergeAnalysisRequest(request: AnalyzePostsRequest): Promise<AnalyzePostsRequest>`**

1. Load the store via `repo.loadStore()`.
2. Derive `followers`:
   - `store.profileSnapshots` — find the most recent snapshot by `capturedAt`.
   - If found and `snapshot.followers !== undefined`, use `snapshot.followers`.
   - Otherwise: `undefined` (no patch).
3. Derive `trailingMedianImpressions`:
   - Filter `store.posts` to `original`-kind posts that have at least one `x_live_capture` metricSnapshot.
   - Collect `impressions` values from all `liveMetricSnapshotSchema` entries on those posts (prefer the most recent snapshot per post — max `capturedAt`).
   - Drop `undefined` impression values.
   - Take up to the 20 most recent (by post `createdAt` descending).
   - If at least one value, compute integer median. Otherwise `undefined`.
4. Derive `repeatHistory`:
   - Call `windowService.compute(7)`, then `RepetitionWindowService.asRepeatHistory(report)`.
   - If result is an empty array, pass `undefined` (no patch — `ArchiveStudioContextResolver` may have its own).
5. Build `patch`:
   - Apply each derived value only if the request does not already have it set in `request.scoringContext`:
     - `followers`: patch only if `request.scoringContext.followers === undefined` and derived value is defined.
     - `trailingMedianImpressions`: patch only if `request.scoringContext.trailingMedianImpressions === undefined` and derived value is defined.
     - `repeatHistory`: patch only if `request.scoringContext.repeatHistory === undefined` and derived value is non-empty.
6. Return `{ ...request, scoringContext: { ...request.scoringContext, ...patch } }`.

**Wire into `POST /posts/analyze`** (`engine/src/server/server.ts`):

- Add `liveContextResolver?: LiveContextResolver` to `BuildServerOptions`.
- In the route handler, run the resolver chain in order:
  1. `request = await liveContextResolver.mergeAnalysisRequest(request)` (when injected)
  2. `request = await archiveStudioContextResolver.mergeAnalysisRequest(request)` (existing)
  3. `response = deterministicAnalysisService.analyzePosts(request)`
- Attach `cooldown: CooldownSignal | undefined` per scored item:
  - After step 3, call `windowService.compute(7)` once and look up each item's `detectedFormat` in `report.signals`.
  - For each `scoredPostItem`, attach `cooldown: signal ?? undefined` (absent if no signal for that format).
  - `score_failed` items: no `cooldown` field.
- Response schema: `analyzePostsResponseSchema` is extended additively in XOB-002 to allow `cooldown?: CooldownSignal` on `scoredPostItemSchema`. The route validates via `parseResponseContract`.

**Export** `LiveContextResolver` from `engine/src/index.ts`.

## Data Models

From `@x-builder/shared` (XOB-002):

- `cooldownSignalSchema` — `{ format, countInWindow, windowDays, lastPostedAt?, status, message }`
- `scoredPostItemSchema` — extended with `cooldown: cooldownSignalSchema.optional()` (additive, zero-trace)
- `analyzePostsResponseSchema` — unchanged container; `scoredPostItemSchema` change is additive

Existing types:

- `AnalyzePostsRequest` / `analyzePostsRequestSchema` — `@x-builder/shared` `deterministic-analysis.ts`
- `scoringContextSchema` — `{ followers?, trailingMedianImpressions?, repeatHistory?, ... }` (all optional)
- `RepeatHistoryEntry` — fed by `asRepeatHistory`; consumed by `computeRepeatMultiplier` inside `DeterministicAnalysisService.analyzePosts`
- `liveMetricSnapshotSchema` — v2 store, `source: "x_live_capture"`, `impressions?`
- `liveCapturedProfileSchema` / `profileSnapshots[]` — v2 store (XOB-003)

## Integration Point

**Execution ordering is a first-class constraint:** `LiveContextResolver.mergeAnalysisRequest` MUST run before `ArchiveStudioContextResolver.mergeAnalysisRequest`. This ordering ensures live data takes precedence — if the user already supplied `followers` in the request body (unusual), neither resolver overwrites it (both check for `=== undefined`). If the archive provides `repeatHistory` and live does not, the archive's value is preserved.

**`buildServer` wiring:**

- `liveContextResolver` is an optional injection in `BuildServerOptions` (default: undefined — existing behavior unchanged when not injected; the archive resolver always runs second).
- Construct a default `LiveContextResolver` in the runtime composition root (when not injected) once `postLibraryRepository` and a `RepetitionWindowService` instance are available.

**`windowService` shared instance:** a single `RepetitionWindowService` instance should be shared between `LiveContextResolver` and the per-request cooldown attachment step inside the route, so `compute(7)` is called at most once per request.

## Scope Boundaries / Out of Scope

- Does not modify `ArchiveStudioContextResolver` — execution order is imposed from the route, not from merging the two resolvers.
- No new `scoringContext` fields beyond `followers`, `trailingMedianImpressions`, `repeatHistory` — other fields (`plannedHourUtc`, `willAttachMedia`, `accountAgeYears`, `judgeSignals`) are not touched by this resolver.
- The `ManualScoringContextPanel` follower input in `/writer` is not removed — this resolver bypasses it by being early in the chain; the panel remains for no-captured-profile sessions.
- `trailingMedianImpressions` uses live impressions only; archive `favoriteCount` is not used as a trailing median proxy here (that would be a separate post-v1 improvement).
- `windowService.compute` window is hardcoded to 7 days in this resolver (the per-item cooldown attachment also uses 7); the `/capture/cooldown` route (XOB-009) exposes configurable `windowDays`.

## Test Strategy & Fixture Ownership

**Suite 1:** `engine/src/capture/tests/live-context-resolver.test.ts` (Vitest unit)

- Construct `LiveContextResolver` with a mock `PostLibraryRepository` (returning a hand-crafted v2 store) and a real or stubbed `RepetitionWindowService`.
- Verify: request with no `followers` → patched with latest profile snapshot's `followers`.
- Verify: request with `followers` already set → `followers` unchanged.
- Verify: 5 originals with live impressions `[100, 200, 300, 400, 500]` → `trailingMedianImpressions: 300` (median).
- Verify: no live impressions → `trailingMedianImpressions` absent from patch.
- Verify: `repeatHistory` absent from request + service has signals → patched.

**Suite 2:** `engine/src/server/tests/posts-analyze.test.ts` (Vitest route integration)

- `buildServer({ liveContextResolver, ... }).inject(...)`.
- Seeded corpus (profile snapshot + live impressions posts + cooldown corpus) → POST `/posts/analyze` with no `followers` in body → verify:
  - Response `status: 200`.
  - Each scored item `prediction.baseSource === "trailing_median"` (confirms `trailingMedianImpressions` was injected).
  - Each scored item has a `cooldown` field (may be `undefined` if the item's format has no signal, but the field exists when format has signal).
- Verify execution ordering: stub `ArchiveStudioContextResolver.mergeAnalysisRequest` to assert it receives a request that already has `followers` set by `LiveContextResolver`.

**LLM dependency:** none (deterministic only).

**Dependency category:** integration (disk I/O + route).

**Isolation:** `mkdtemp` tmpdir per test; `buildServer()` injected.

## Definition of Done

- `LiveContextResolver.mergeAnalysisRequest` implemented.
- Route handler updated: `LiveContextResolver` → `ArchiveStudioContextResolver` → `DeterministicAnalysisService` → attach per-item `cooldown`.
- `LiveContextResolver` exported from `engine/src/index.ts`.
- All tests in both suites pass.
- TypeScript strict-mode clean (`pnpm typecheck` green).
- Existing `posts-analyze.test.ts` tests remain green (additive only — no `cooldown` on responses that didn't have a cooldown corpus).

## Acceptance Criteria

**Given** a corpus containing a profile snapshot with `followers: 12000` and 10 original live posts with varying `impressions`, and the request body has no `followers` field

**When** `POST /posts/analyze` is called

**Then** the response items have `prediction.status: "available"` and `prediction.baseSource: "trailing_median"` (confirming `trailingMedianImpressions` was injected, not `followers`-estimate); each scored item carries a `cooldown` field.

---

**Given** a request body that already includes `followers: 5000` in `scoringContext`

**When** `POST /posts/analyze` is called (even with a captured profile snapshot present)

**Then** the response uses the caller-supplied `followers: 5000` — the resolver does not overwrite it.

---

**Given** `LiveContextResolver` is wired in and a `ArchiveStudioContextResolver` stub is injected

**When** the route handler processes a request

**Then** `LiveContextResolver.mergeAnalysisRequest` is called first; the result (with patched `followers`) is passed to `ArchiveStudioContextResolver.mergeAnalysisRequest` second. The execution ordering is asserted.

---

**Given** a cooldown corpus (4+ `hot_take` originals in last 7 days) and a request item whose text classifies as `hot_take`

**When** `POST /posts/analyze` is called

**Then** the `hot_take` scored item has `cooldown.status: "cooldown"` and `cooldown.countInWindow: 4`.

## Edge Cases

- No profile snapshots in store → `followers` not patched; if no live impressions either → prediction falls back to `follower_estimate` or `missing_followers` as before.
- `trailingMedianImpressions` computation with a single impression value → median equals that value.
- Even count of impressions → median is lower of the two middle values (integer, floor).
- `ArchiveStudioContextResolver` already set `repeatHistory` (from archive context patch) → `LiveContextResolver` runs first and sets it only if absent; archive resolver runs second and respects the already-set value.
- `score_failed` items in the response → no `cooldown` field attached; response still valid.
- `PostLibraryStorageError` from either resolver → route handler catches it and returns `library_storage_failed`.
