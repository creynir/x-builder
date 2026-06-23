---
status: done
---

# XOB-003: [FND] [RFR] Post-library store **v2** — widen source unions, `profileSnapshots`, forward migration

## Implementation Details

Evolve the engine-internal post-library store to `schemaVersion: 2` so it can hold
live-capture (`x_live_capture`) metrics and profile snapshots alongside the existing
archive (`archive_tweets_js`) data, with a one-time forward migration and a hard guard
against unknown future versions. **Existing archive behavior must be byte-for-byte
preserved** (this is a refactor, not a behavior change — see Behavior-Preservation
Invariants).

All edits are confined to the `post-library-repository.ts` module. Concrete steps,
by symbol name:

1. **Widen `metricSnapshots` to a discriminated union.** Keep the existing
   `archiveMetricSnapshotSchema` (`source: literal "archive_tweets_js"`, `observedAt`,
   `importedAt`, `favoriteCount?`, `retweetCount?`) unchanged. Add
   `liveMetricSnapshotSchema` `{ source: literal "x_live_capture", capturedAt: datetime,
   impressions?, likes?, reposts?, replies?, quotes?, bookmarks?: int≥0 }`. Replace the
   `metricSnapshots` field type with
   `z.array(z.discriminatedUnion("source", [archiveMetricSnapshotSchema,
   liveMetricSnapshotSchema])).default([])`.

2. **Widen `sourceRefs` to a discriminated union.** Keep the existing archive ref
   (`source: literal "archive_tweets_js"`, `importRunId`, `rawId`, `sourceHash`) — rename
   the existing const to `archiveSourceRefSchema` for clarity. Add
   `liveSourceRefSchema` `{ source: literal "x_live_capture", captureSessionId: str
   1..160, rawId: str 1..160 }` — **no `sourceHash`** (live JSON is not a stable file, so
   no content hash). Replace `sourceRefs` with
   `z.array(z.discriminatedUnion("source", [archiveSourceRefSchema,
   liveSourceRefSchema])).default([])`.

3. **Add `liveProfileSnapshotSchema`** (engine-internal) `{ platformUserId: str 1..160,
   screenName: str 1..80, followers?: int≥0, capturedAt: datetime }`. (The shared
   `liveCapturedProfileSchema` from XOB-002 is the wire/ingest shape; this is the stored
   shape — keep field names aligned but define it here, engine-internal.)

4. **Bump and extend `postLibraryStoreSchema`.** `schemaVersion` → `z.literal(2)`. Add
   `profileSnapshots: z.array(liveProfileSnapshotSchema).default([])`. Everything else
   (`updatedAt`, `posts`, `importRuns`, `derivedInsights`, `activeContext`) unchanged.

5. **Update `snapshotKey` and `sourceRefKey` to key off the union discriminant.**
   `snapshotKey`: for `archive_tweets_js` keep `[source, observedAt, importedAt]`; for
   `x_live_capture` use `[source, capturedAt]` (plus any field needed to keep distinct
   live snapshots distinct, e.g. `capturedAt`). `sourceRefKey`: archive keeps
   `[source, importRunId, rawId, sourceHash]`; live uses `[source, captureSessionId,
   rawId]`. The dedup contract (`uniqueBy` in `mergePost`) is unchanged — only the key
   function learns the second variant. **Archive keys must produce identical strings to
   today** so archive dedup is bit-identical.

6. **Add a one-time forward migration in `loadStore`.** After `JSON.parse`, before
   `postLibraryStoreSchema.parse`, branch on the raw `schemaVersion`:
   - `2` → parse with `postLibraryStoreSchema` (v2) directly.
   - `1` → migrate: add `profileSnapshots: []`, set `schemaVersion: 2`, then parse with
     the v2 schema. Existing `archive_tweets_js` snapshots/refs already satisfy the
     widened unions (the archive variant is unchanged), so posts validate as-is. The
     migration is pure in-memory; it does NOT write — the migrated store is returned, and
     the next `saveStore` (any `upsert*`/`set*`) persists it as v2 (atomic temp+rename,
     unchanged). Migration is idempotent (a v2 store is never re-migrated).
   - `> 2` (e.g. `3`) → throw `PostLibraryStorageError` (schema-version drift guard).
   - Keep the existing `ENOENT → emptyStore()` and `SyntaxError`/`ZodError →
     PostLibraryStorageError` handling. Note: `emptyStore()` must now build a **v2** store
     (`schemaVersion: 2`, `profileSnapshots: []`).

Read raw `schemaVersion` defensively (the parsed JSON is `unknown`); a missing/non-1/2
version that is `> 2` numeric hits the guard, and any other malformed shape falls through
to the v2 `parse` which rejects → `PostLibraryStorageError`.

## Data Models

- `archiveMetricSnapshotSchema` — UNCHANGED (`source: "archive_tweets_js"`).
- `liveMetricSnapshotSchema` (NEW) — `{ source: "x_live_capture", capturedAt: datetime,
  impressions?, likes?, reposts?, replies?, quotes?, bookmarks?: int≥0 }`.
- `metricSnapshots` — `discriminatedUnion("source", [archive, live])[]` `.default([])`.
- `archiveSourceRefSchema` (renamed from `sourceRefSchema`) — UNCHANGED fields
  (`importRunId`, `rawId`, `sourceHash: sourceHashSchema`).
- `liveSourceRefSchema` (NEW) — `{ source: "x_live_capture", captureSessionId: str
  1..160, rawId: str 1..160 }` (no `sourceHash`).
- `sourceRefs` — `discriminatedUnion("source", [archive, live])[]` `.default([])`.
- `liveProfileSnapshotSchema` (NEW) — `{ platformUserId, screenName, followers?: int≥0,
  capturedAt: datetime }`.
- `postLibraryStoreSchema` — `schemaVersion: z.literal(2)`; +
  `profileSnapshots: liveProfileSnapshot[] .default([])`; all prior fields unchanged.
- `canonicalOwnPostSchema`/`canonicalOwnPostInputSchema` — field set unchanged; only the
  element types of `metricSnapshots`/`sourceRefs` widen. The exported types
  (`ArchiveMetricSnapshot`, `SourceRef`, `CanonicalOwnPost`, `PostLibraryStore`, etc.)
  must be updated to reflect the unions (and add a `LiveProfileSnapshot` type).

Relationships: `profileSnapshots` is store-level (not per-post); the latest entry feeds
auto-followers (consumed downstream by XOB-007/XOB-008, out of scope here).

## Integration Point

Reached via `PostLibraryRepository.loadStore()`/`upsertPosts()`/`saveImportRun()`/
`saveDerivedInsights()`/`setActiveContext()` — the same `JsonFilePostLibraryRepository`
already consumed by the archive import services. Terminal outcome: every existing
consumer keeps working unchanged, and the store can now physically hold
`x_live_capture` snapshots/refs and `profileSnapshots` — which XOB-004
(`LiveCaptureService.ingest`) and XOB-008 (`LiveCaptureService.summary`) will write/read.
No new public method is added in this ticket; the interface signatures are unchanged.

## Refactor Scope

- **In scope:** `engine/src/server/post-library-repository.ts` (the schemas, key
  functions, `loadStore` migration/guard, `emptyStore`, and the exported types within it).
- **Out of scope:** every other module. No new service, route, or repository method. The
  shared `liveCapturedProfileSchema` (XOB-002) is referenced conceptually but the stored
  `liveProfileSnapshotSchema` lives here, engine-internal.

## Behavior-Preservation Invariants

- Existing archive **upsert / merge / dedup** behavior is identical: `upsertPosts` of an
  archive batch yields the same `insertedCount`/`updatedCount`/`unchangedCount`/
  `duplicateCount` and the same stored post objects as before this ticket.
- `snapshotKey`/`sourceRefKey` produce **byte-identical** strings for
  `archive_tweets_js` snapshots/refs as before (dedup unaffected for archive data).
- A v1 `post-library.json` loads via `loadStore` and re-saves (on the next write) as v2
  with **identical posts** (same ids, text, metrics, refs) plus `profileSnapshots: []`.
- `saveStore` ordering (sort by `createdAt` desc, then `id` asc), atomic temp+rename, and
  the `withSerializedWrite` queue are unchanged.
- `mergePost` still dedups `metricSnapshots`/`sourceRefs` via `uniqueBy`; only the key
  function gained a branch — archive merges are unchanged.

## Test Strategy & Fixture Ownership

- **Coverage level:** unit/integration against a real `JsonFilePostLibraryRepository`
  over a fresh tmpdir (mirror the existing `post-library-repository.test.ts` pattern).
- **Owning suite/workspace:** `@x-builder/engine`
  (`engine/src/server/tests/post-library-repository.test.ts` — extend the existing file;
  `vitest run`). **All existing tests in that file must stay green** with no edits beyond
  what the schema-version bump strictly requires (e.g. any literal-`1` assertions become
  literal-`2`, since the store now defaults to v2).
- **Fixture/helper strategy:** the v1→v2 migration fixture is **owned here** — an inlined
  **v1 `post-library.json` JSON string** (`schemaVersion: 1`, ≥1 archive post with
  `archive_tweets_js` snapshots/refs, no `profileSnapshots`) written to the tmpdir, then
  loaded.
- **Dependency category:** local-substitutable filesystem (real `node:fs/promises` over
  an `os.tmpdir()` `mkdtemp` directory) — no remote, no true-external.
- **Isolation boundary:** per-test tmpdir created with `mkdtemp(os.tmpdir())`; no shared
  state between tests; the repo writes only inside its own `root`.

Required cases:
- v1 fixture → `loadStore` → store with `schemaVersion: 2`, `profileSnapshots: []`, and
  posts identical to the v1 fixture's posts (archive snapshots/refs validate unchanged).
- v1 fixture → `loadStore` → `setActiveContext`/`upsertPosts` (triggers `saveStore`) →
  re-read file is `schemaVersion: 2` with the same posts (round-trip persists as v2).
- archive `upsertPosts` (insert, then re-upsert identical, then upsert with a new
  snapshot) produces the same counts/merge result as the pre-ticket suite.
- a store JSON with `schemaVersion: 3` → `loadStore` throws `PostLibraryStorageError`.
- (live readiness) a v2 store containing an `x_live_capture` metric snapshot + live
  source ref + a `profileSnapshots` entry parses/round-trips (proves the widened unions
  accept live data — even though no service writes it yet in this ticket).

## Definition of Done

- `postLibraryStoreSchema.schemaVersion` is `literal(2)`; `metricSnapshots`/`sourceRefs`
  are discriminated unions admitting `x_live_capture`; `profileSnapshots` exists with
  `.default([])`.
- `loadStore` migrates v1→v2 in memory, accepts v2, and rejects `> 2` with
  `PostLibraryStorageError`; `emptyStore()` builds a v2 store.
- All existing `post-library-repository.test.ts` cases pass; the new migration + guard +
  live-data cases pass; `pnpm -F @x-builder/engine test` and `pnpm typecheck` green.
- Behavior-Preservation Invariants all hold.

## Acceptance Criteria

- **Given** an on-disk v1 `post-library.json` (with archive posts and no
  `profileSnapshots`), **When** `loadStore()` is called, **Then** it returns a store with
  `schemaVersion: 2`, `profileSnapshots: []`, and posts identical to the v1 input
  (archive `metricSnapshots`/`sourceRefs` unchanged).
- **Given** a v1 store loaded then written (via any `upsert*`/`set*`), **When** the file
  is re-read, **Then** it is `schemaVersion: 2` with the same posts (idempotent on a
  second load — not re-migrated).
- **Given** an archive batch, **When** `upsertPosts` runs (insert → identical re-upsert →
  new-snapshot upsert), **Then** the returned counts and merged posts are exactly as
  before this ticket (behavior-preserving).
- **(Negative/guard)** **Given** a store JSON with `schemaVersion: 3`, **When**
  `loadStore()` is called, **Then** it throws `PostLibraryStorageError`.
- **(Boundary/live)** **Given** a v2 store containing an `x_live_capture` metric snapshot
  (with `impressions`/`likes`) and a live source ref (no `sourceHash`) and a
  `profileSnapshots` entry, **When** loaded, **Then** it validates and round-trips.

## Edge Cases

- A v1 store whose posts already lack the (now-defaulted) `profileSnapshots` — the
  migration adds it at store level, not per post.
- A raw `schemaVersion` that is absent or a non-numeric/`0`/negative value: not `1` and
  not `2`, and not `> 2` numeric → falls through to the v2 `parse`, which rejects →
  `PostLibraryStorageError` (no silent acceptance).
- Mixed-source post: a single post carrying both an `archive_tweets_js` and an
  `x_live_capture` snapshot must validate (the union is per-element) and dedup correctly
  across both variants (distinct discriminants → distinct keys).
- Live source ref intentionally has no `sourceHash`; ensure `sourceRefKey` for the live
  variant never references `sourceHash` (would throw on undefined).
- `discriminatedUnion("source", ...)` requires the `source` literal present on every
  element; a snapshot/ref missing `source` rejects (caught as `ZodError` →
  `PostLibraryStorageError`).
- Concurrency: migration runs inside `loadStore`, which `upsertPosts` calls under
  `withSerializedWrite`; ensure the in-memory migration does not double-apply across the
  serialized queue (idempotent guard on `schemaVersion === 2`).

## Pipeline Log

Lean lane; hybrid [FND] additive-evolution + [RFR] behavior-preservation (routed to standard lean Red-first, not pure-RFR, because the ticket introduces new behavior — v2/migration/guard/live — that pure-RFR cannot host).

- **Red** (`b2bfd0c`): extended `post-library-repository.test.ts` — 12 characterization/preserved tests (pass now & after: archive snapshot/sourceRef dedup-key semantics, saveStore ordering, re-upsert idempotence + the 6 unchanged existing) + 6 failing new-behavior tests (v1→v2 migration, idempotent re-save, `>2` guard, live-capture round-trip, mixed-source post, live-ref dedup). Updated the ONE sanctioned assertion (empty-store `schemaVersion` 1→2). Flagged quirk: `unchangedCount` is millisecond-timing-dependent (mergePost stamps fresh `updatedAt`) — pinned timing-independent facts instead; preserved behavior, Green must not "fix" it. Self-validated 12 pass / 6 fail deterministic ×8.
- **Gates** (post-Red, base `317b170`): `[scope]` + `[ticket-ids]` CLEAN.
- **Pre-Green pinning gate**: 12 pass / 6 fail confirmed independently; preserved-behavior baseline green before Green starts.
- **Green** (`3f8d4a0`): single file. `metricSnapshots`/`sourceRefs` → `z.discriminatedUnion("source", …)` admitting `x_live_capture`; `schemaVersion: literal(2)`; `profileSnapshots`; in-memory idempotent v1→v2 migration + numeric-`>2` guard in `loadStore`; `emptyStore` v2; `sourceRefSchema`→`archiveSourceRefSchema` rename. 18/18 store tests, 589/589 engine, typecheck 9/9. Archive key strings byte-identical; `unchangedCount` quirk untouched.
- **Gates** (post-Green, base `b2bfd0c`): all CLEAN; Green touched zero test files.
- **Blue (Validate Green)**: APPROVE_WITH_CONCERNS — all mechanical green, behavior preserved (no change beyond sanctioned `schemaVersion` bump); compiled an isolated probe proving the loose exported union is **sound** (never types an omittable field as required-present).
- **Yellow (intent, facade emphasis)**: APPROVE_WITH_CONCERNS — real restructuring (genuine discriminated unions, real migration, no orphans/shims, all importers resolve), extension-ready for XOB-004/008. Ruled the loose-union acceptable-with-concern (not an intent defect): XOB-004 writer zero degradation, XOB-008 mild, XOB-007 loses a forced-narrow seatbelt.
- **[FND] Architectural checkpoint (Blue)**: APPROVE — v2 store conforms to the epic's corpus-accumulation architecture (live metrics complete; `captureSessionId`+`rawId` dedup keeps re-captures additive; `profileSnapshots` single auto-followers source; migration non-destructive). XOB-004 cleared.

### Concerns Ledger (carried — triaged with user)

1. **Loose exported union type** — **RESOLVED** (user chose fix-now at the foundation checkpoint). Red `b8f8a1e` narrowed every variant-field characterization read on the `.source` discriminant via typed type-guard helpers (and made the live `sourceHash`-absent check compile-time-forbidden + runtime-asserted — strictly stronger); Green `d1b41af` then dropped the `Partial<Omit<…>>` accommodation so `MetricSnapshot`/`SourceRef`/`CanonicalOwnPost`/`PostLibraryStore` are true `z.infer` discriminated unions. XOB-007 now gets forced `.source` narrowing at compile time. 18/18 store + 589/589 engine + typecheck 9/9; gates clean (base `83f82c4`). Type-surface only, no runtime change.
2. **Stored `liveProfileSnapshotSchema` is tighter than the shared wire `liveCapturedProfileSchema`** (adds `min(1)`/`max` bounds). Non-blocking; flagged for **XOB-004** so `pushProfileSnapshot` handles a parse rejection (route to `library_storage_failed`) rather than assuming the shared value always fits.
