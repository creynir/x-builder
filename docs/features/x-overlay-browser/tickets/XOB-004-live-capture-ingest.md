---
status: in-progress
---

# XOB-004: LiveCaptureService.ingest — accumulate live posts + profile

## Implementation Details

Add `engine/src/capture/live-capture-service.ts`. Class constructor: `LiveCaptureService(repo: PostLibraryRepository, now?: () => string)`.

**`ingest(request: CaptureIngestRequest): Promise<CaptureIngestResponse>`**

- Parse `request` with `captureIngestRequestSchema` (from `@x-builder/shared`, added in XOB-002).
- Map each `LiveCapturedPost` to a `CanonicalOwnPostInput`:
  - `id`: `crypto.randomUUID()` (stable only within a single upsert; dedup is by `platform:platformPostId`)
  - `platform`: `"x"`
  - `platformPostId`: `post.platformPostId`
  - `text`, `createdAt`, `kind`, `language`, `replyReferences`, `entityFlags` mapped 1:1 from the live post
  - `weakMetrics`: `{}` (no archive favorites/retweets from live capture)
  - `metricSnapshots`: one `liveMetricSnapshotSchema` entry — `{ source: "x_live_capture", capturedAt: post.capturedAt, impressions, likes, reposts, replies, quotes, bookmarks }` with undefined fields absent
  - `sourceRefs`: one `x_live_capture` source ref — `{ source: "x_live_capture", captureSessionId, rawId: post.platformPostId }` where `captureSessionId` is a UUID minted once per `ingest` call
- Call `repo.upsertPosts(inputs)`. The existing accumulate-by-upsert merge logic (merge by `platform:platformPostId`, dedup `metricSnapshots` by `snapshotKey`) handles re-ingestion automatically — a second call with the same `platformPostId` appends a new `liveMetricSnapshotSchema` entry if `capturedAt` differs.
- If `request.profile` is present: push a `liveProfileSnapshot` (`liveCapturedProfileSchema` value) into `store.profileSnapshots[]` via a new `pushProfileSnapshot(snapshot: LiveCapturedProfile): Promise<void>` method on `PostLibraryRepository` (implemented in `JsonFilePostLibraryRepository`, using the existing `withSerializedWrite` queue).
- Return `CaptureIngestResponse`: `{ insertedCount, updatedCount, unchangedCount, duplicateCount }` from `PostLibraryWriteResult` + `profileApplied: request.profile !== undefined` + `corpusSize: (await repo.loadStore()).posts.length`.
- On `PostLibraryStorageError`: re-throw (caller / transport layer maps to `library_storage_failed`).
- Tolerate-and-skip: individual items that fail `liveCapturedPostSchema` parse are skipped and logged; the batch continues.

**Export** `LiveCaptureService` from `engine/src/index.ts`.

## Data Models

All schemas from `@x-builder/shared` (XOB-002):

- `captureIngestRequestSchema` — `{ posts: LiveCapturedPost[] (max 200, default []), profile?: LiveCapturedProfile }`
- `captureIngestResponseSchema` — `{ insertedCount, updatedCount, unchangedCount, duplicateCount, profileApplied: bool, corpusSize: int }`
- `liveCapturedPostSchema` — `{ platformPostId, text, createdAt, kind, language?, replyReferences, entityFlags, liveMetrics, capturedAt }`
- `liveCapturedProfileSchema` — `{ platformUserId, screenName, followers?, capturedAt }`

Engine-internal (XOB-003 v2 store):

- `liveMetricSnapshotSchema` — discriminated union member `source: "x_live_capture"`
- `x_live_capture` sourceRef — `{ source: "x_live_capture", captureSessionId, rawId }`
- `postLibraryStoreSchema.profileSnapshots: liveProfileSnapshot[]` (v2)

## Integration Point

In-process only in v1. The runner (`@x-builder/runner`) calls `LiveCaptureService.ingest` directly from `GraphQlCaptureObserver`'s response batch handler — no HTTP route. An HTTP wrapper (`POST /capture/ingest`) is reserved for the MV3 era; the shared schemas are already in `@x-builder/shared` to make that wrapper thin when the time comes.

`pushProfileSnapshot` on `JsonFilePostLibraryRepository` is a new method added in this ticket; it is consumed here and by XOB-008 (`LiveCaptureService.summary`).

## Scope Boundaries / Out of Scope

- No HTTP route (`POST /capture/ingest`) — in-process only in v1.
- No auto-pagination or crafted GraphQL — capture is entirely passive.
- No auto-scroll or harvesting of posts not already returned by the user's own navigation.
- `pushProfileSnapshot` appends without dedup limit in v1 (full dedup/trim is a post-v1 concern).
- `captureSessionId` uniqueness per batch is sufficient; no session persistence across `RunnerApp` restarts needed in v1.

## Test Strategy & Fixture Ownership

**Suite:** `engine/src/capture/tests/live-capture-service.test.ts` (Vitest)

**Setup:** `os.tmpdir()` + `mkdtemp`; construct `JsonFilePostLibraryRepository` against the temp dir. No `buildServer()` — this service is in-process only.

**LLM dependency:** none.

**Dependency category:** unit/integration (disk I/O via `JsonFilePostLibraryRepository`; no subprocess).

**Isolation:** each test gets its own `mkdtemp` tmpdir, cleaned up in `afterEach`.

Coverage:

1. Empty corpus → single `ingest` call with one post → `insertedCount:1`, `corpusSize:1`, `profileApplied:false`.
2. Two `ingest` calls with the same `platformPostId` but different `capturedAt`/rising `impressions` → `corpusSize:1`, exactly two `liveMetricSnapshotSchema` entries on that post.
3. `ingest` with `profile` present → `profileApplied:true`; `loadStore().profileSnapshots` has one entry.
4. Malformed item in batch (fails schema) → tolerated; remaining items inserted; no throw.
5. Batch with duplicate `platformPostId` within one call → `duplicateCount ≥ 1`, final store has one post.

## Definition of Done

- `LiveCaptureService.ingest` implemented with accumulate-merge semantics and tolerate-and-skip on malformed items.
- `pushProfileSnapshot` added to `PostLibraryRepository` interface and `JsonFilePostLibraryRepository`.
- `LiveCaptureService` exported from `engine/src/index.ts`.
- All tests in the coverage list pass.
- TypeScript strict-mode clean (`pnpm typecheck` green).

## Acceptance Criteria

**Given** an empty corpus

**When** `ingest` is called twice with the same `platformPostId` but `capturedAt` and `impressions` differ between calls

**Then** `loadStore().posts` has exactly one post; that post's `metricSnapshots` has exactly two entries (one per call, distinguished by `capturedAt`); the second `ingest` call returns `{ updatedCount: 1, corpusSize: 1 }`.

---

**Given** a batch containing one item whose `platformPostId` exceeds 160 characters

**When** `ingest` is called

**Then** the malformed item is skipped; valid items are inserted; no exception is thrown.

---

**Given** `request.profile` is present

**When** `ingest` is called

**Then** `profileApplied: true` in the response and `loadStore().profileSnapshots` contains the profile entry.

---

**Given** a batch of 200 posts all with distinct `platformPostId`

**When** `ingest` is called once

**Then** `corpusSize: 200` and `insertedCount: 200`.

## Edge Cases

- `request.posts` is an empty array → `ingest` succeeds, `corpusSize` reflects existing posts (no write), `profileApplied` depends on whether `profile` was passed.
- `PostLibraryStorageError` from `upsertPosts` (e.g., disk full) → re-thrown unchanged so the transport layer can map it to `library_storage_failed`.
- `liveMetrics` fields absent on a post → `liveMetricSnapshotSchema` entry created with all metric fields `undefined`; no validation error.
- Two posts with the same `platformPostId` within one batch → second treated as a duplicate; `duplicateCount` incremented; final store has one post with the first item's data.
- Very large `text` field exactly at 8 000 characters → accepted; over 8 000 → item skipped (schema violation, tolerate-and-skip).
