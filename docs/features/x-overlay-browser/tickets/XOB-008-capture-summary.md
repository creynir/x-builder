---
status: todo
---

# XOB-008: LiveCaptureService.summary + GET /capture/summary — capture summary / auto-followers source

## Implementation Details

Extend `engine/src/capture/live-capture-service.ts` (created in XOB-004) with a second method:

**`summary(): Promise<CaptureSummary>`**

- Call `repo.loadStore()`.
- Compute fields:
  - `postsCaptured`: `store.posts.length`.
  - `lastCaptureAt`: find the maximum `capturedAt` value across all `liveMetricSnapshotSchema` entries in all posts. If no live snapshots exist (empty corpus or archive-only), omit this field.
  - `followers`: from `store.profileSnapshots` — find the most recent snapshot by `capturedAt`; return its `followers` if defined. Omit if no profile snapshots or if `followers` is `undefined` on the most recent snapshot.
  - `screenName`: from the same most-recent profile snapshot's `screenName`. Omit if absent.
  - `profileCapturedAt`: `capturedAt` of the most-recent profile snapshot. Omit if no profile snapshots.
- Return a `captureSummarySchema`-valid object (all optional fields absent rather than `null` when not available).
- On `PostLibraryStorageError`: re-throw.

**Transport bindings:**

- In-process: `__xbuilder_getCaptureSummary` binding (registered in `ExposeFunctionTransport` in XOB-016). This is the overlay's **sole auto-followers source** — `MetricCard` in the overlay reads `captureSummary.followers`; there is no manual input in the overlay.
- HTTP: `GET /capture/summary` — registered in `buildServer` (in `engine/src/server/server.ts`). This is the `/writer` fallback path. Response parsed via `parseResponseContract(captureSummarySchema)`. On `PostLibraryStorageError` → `library_storage_failed` (status 500).

`summary()` is a new method on `LiveCaptureService` (which already owns `ingest()` from XOB-004). No new class; no new file beyond what XOB-004 created.

**Export** already satisfied by XOB-004 (`LiveCaptureService` exported from `engine/src/index.ts`).

## Data Models

From `@x-builder/shared` (XOB-002, §15.3):

- `captureSummarySchema` — `{ postsCaptured: int≥0, lastCaptureAt?: datetime, followers?: int≥0, screenName?: ≤80, profileCapturedAt?: datetime }`

Engine-internal (XOB-003 v2 store):

- `liveMetricSnapshotSchema` — `source: "x_live_capture"`, `capturedAt` (used for `lastCaptureAt`)
- `store.profileSnapshots: LiveProfileSnapshot[]` — `{ platformUserId, screenName, followers?, capturedAt }` (added in XOB-003/XOB-004)

## Integration Point

**`buildServer` wiring** (`engine/src/server/server.ts`):

- Add `liveCaptureService?: LiveCaptureService` to `BuildServerOptions` (may already be present from XOB-004 wiring if done together; otherwise add here).
- Register `GET /capture/summary` as a Fastify route. Construct `LiveCaptureService` lazily from `postLibraryRepository` if not injected.
- Response: `parseResponseContract(captureSummarySchema, await service.summary())`.
- Error: `PostLibraryStorageError` → `library_storage_failed` (status 500).

**`ExposeFunctionTransport`** (XOB-016): registers `__xbuilder_getCaptureSummary` → `LiveCaptureService.summary`. This binding is the overlay's only channel to auto-followers — it replaces the `ManualScoringContextPanel` friction for overlay users.

**`EngineTransport`** (XOB-002): `getCaptureSummary(): Promise<CaptureSummary>` — method 15.

**Dep chain:** XOB-004 creates `LiveCaptureService` and `pushProfileSnapshot`; this ticket adds `summary()` to the same class and adds the HTTP route. XOB-003 provides the v2 store with `profileSnapshots[]`.

## Scope Boundaries / Out of Scope

- Does not aggregate metrics across snapshots (no averaging, no summing) — reports only the single most-recent profile snapshot.
- Does not trim or expire `profileSnapshots[]` — the list grows unbounded in v1 (post-v1 concern).
- The `/writer` `ManualScoringContextPanel` is not removed — this route provides an HTTP equivalent for the `/writer` fallback; the panel stays for sessions without a captured profile.
- `screenName` is informational only; no validation against the current browser session.
- No pagination or filtering — `postsCaptured` is a simple total count, not scoped by date or source.

## Test Strategy & Fixture Ownership

**Suite:** `engine/src/capture/tests/live-capture-service.test.ts` (Vitest) — extend the file created in XOB-004.

**Setup:** `os.tmpdir()` + `mkdtemp`; construct `JsonFilePostLibraryRepository` against the temp dir. Seed the store using `repo.upsertPosts()` for posts and `pushProfileSnapshot()` for profile entries directly.

**Route tests:** `buildServer({ liveCaptureService }).inject()` pattern.

**LLM dependency:** none.

**Dependency category:** unit/integration (disk I/O + route).

**Isolation:** `mkdtemp` tmpdir per test, cleaned up in `afterEach`.

Coverage:

1. Store with 3 posts and one profile snapshot (`followers: 8000`, `screenName: "alice"`) → `summary()` returns `{ postsCaptured: 3, followers: 8000, screenName: "alice", profileCapturedAt: <snapshot.capturedAt> }`.
2. `lastCaptureAt` is the max `capturedAt` across all `x_live_capture` metricSnapshots in the store.
3. Empty store (no posts, no profiles) → `summary()` returns `{ postsCaptured: 0 }` with all optional fields absent; no crash.
4. Store with only archive posts (no `x_live_capture` snapshots, no `profileSnapshots`) → `{ postsCaptured: N, lastCaptureAt: undefined, followers: undefined }`.
5. Two profile snapshots; most-recent has `followers: 9000` → `followers: 9000` returned.
6. HTTP route: `GET /capture/summary` → status 200, response parses as `captureSummarySchema`.
7. HTTP route: `PostLibraryStorageError` → status 500, `code: "library_storage_failed"`.

## Definition of Done

- `LiveCaptureService.summary()` implemented.
- `GET /capture/summary` route registered in `buildServer`.
- All tests in the coverage list pass.
- TypeScript strict-mode clean (`pnpm typecheck` green).
- Existing XOB-004 tests remain green.

## Acceptance Criteria

**Given** a corpus containing a profile snapshot with `followers: 12000`, `screenName: "bob"` and 5 posts with live metric snapshots

**When** `summary()` is called (or `GET /capture/summary`)

**Then** the response contains `{ postsCaptured: 5, followers: 12000, screenName: "bob" }` plus `lastCaptureAt` (max capturedAt of live snapshots) and `profileCapturedAt` (snapshot's capturedAt).

---

**Given** an empty corpus (no posts, no profile snapshots)

**When** `summary()` is called

**Then** the response is `{ postsCaptured: 0 }` with no other fields; no exception is thrown.

---

**Given** a store with only archive-imported posts (no `x_live_capture` snapshots) and no profile snapshots

**When** `GET /capture/summary` is called

**Then** status 200 with `{ postsCaptured: N }` and `lastCaptureAt`, `followers`, `screenName`, `profileCapturedAt` all absent.

---

**Given** the post library store is unreadable (corrupt JSON)

**When** `GET /capture/summary` is called

**Then** status 500 with `code: "library_storage_failed"` in the error envelope.

## Edge Cases

- Profile snapshot with `followers: undefined` (profile captured but follower count absent) → `followers` field absent from summary; `screenName` and `profileCapturedAt` still present if available.
- Multiple profile snapshots with the same `capturedAt` → pick the first in array order (tie-break stable).
- Posts with both archive and live metric snapshots → `lastCaptureAt` considers only `x_live_capture` snapshots; `postsCaptured` counts all posts regardless of source.
- `screenName` at exactly 80 characters → accepted; 81 → silently truncated or surfaced as a schema validation issue upstream (the capture normalizer enforces ≤ 80).
- `PostLibraryStorageError` from `loadStore` → re-thrown by `summary()`; the route maps it to `library_storage_failed`.
