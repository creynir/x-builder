---
status: done
---

# LPF-002: [FND] openEngineDatabase, migration 1 DDL, SqlitePostLibraryRepository, and row mappers

## Implementation Details

Add the database open/migration mechanism and the SQLite-backed corpus repository — the base store, with no importer and no host wiring yet.

`openEngineDatabase(dbPath)` owns the single `better-sqlite3` `Database` handle. It opens the handle, sets `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, applies `chmod 0600` to the DB file, defines a `Migration` type (`{ version: number; up(db): void }`) and an ordered `migrations[]`, and runs every migration whose `version` exceeds the current `PRAGMA user_version` (each in its own transaction, advancing `user_version`). This feature ships exactly `{ version: 1, up }`; the array is authored so `voice-rag-generation` can append migrations 2 and 3 without editing this code. Any open or migration failure throws `PostLibraryStorageError` (reused, not a new error type). `dbPath` accepts `':memory:'` for tests.

Migration 1's `up(db)` creates the schema in the DDL block below — and only that. There is no `post_vec` table here.

`SqlitePostLibraryRepository implements PostLibraryRepository` backs the existing **6 methods unchanged** (`loadStore`, `upsertPosts`, `saveImportRun`, `saveDerivedInsights`, `setActiveContext`, `pushProfileSnapshot`) with prepared statements wrapped in `db.transaction(...)`. Because `better-sqlite3` is synchronous, multi-statement writes get atomicity from the transaction directly and the async interface is preserved by returning resolved promises — no `withSerializedWrite` queue. Port the merge semantics (`mergePost`, `uniqueBy`, `snapshotKey`, `sourceRefKey`, `postKey`) from `JsonFilePostLibraryRepository` verbatim; their behavior is test-enforced.

`loadStore()` reassembles `CanonicalOwnPost[]` from the canonical tables via the row mappers and re-parses the full result through `postLibraryStoreSchema` so the wire contract cannot drift.

A `post-row-mapping` module is the only code that knows the column layout: it reconstructs a `CanonicalOwnPost` exactly (`entityFlags` from `has_*`, `replyReferences` from `in_reply_to_*`, `weakMetrics` from `weak_*`, `metricSnapshots` from `metric_obs` discriminated on `source` — archive rows carry `imported_at`, live rows leave it `''`, `sourceRefs` from `source_ref` discriminated on `source`) and shreds a `CanonicalOwnPostInput` into `post` + `metric_obs` + `source_ref` rows, computing `content_hash` at write. The shred path applies `uniqueBy(snapshotKey)` / `uniqueBy(sourceRefKey)` to the incoming arrays before insert, so a single input post carrying duplicate snapshots/refs dedups identically whether or not a prior row already exists.

**Identity / join keys (pinned — resolves the open questions).**
- `metric_obs.tweet_id = post.platform_post_id` — the stable external id, and the key `my-feedback-loop` backfills observations against. Declared as a foreign key to a `UNIQUE(platform_post_id)` index, so a metric row's parent `post` must already exist: `upsertPosts` writes the `post` row **before** its `metric_obs` / `source_ref` rows within the same transaction.
- `source_ref.post_id = post.id` — the internal uuid, because source refs are per-canonical-post provenance.
- `logical_post_id = platform_post_id` **verbatim**. `canonicalOwnPostSchema` carries no edit-history / edit-chain field, so no other value is deterministically derivable. Collapsing an edit chain to its initial tweet id is a future enhancement gated on first capturing edit history — do **not** invent it here.
- `metric_obs` and `source_ref` dedup identity is reproduced by composite primary keys that match the ported `snapshotKey` / `sourceRefKey` exactly (see the DDL comments), using `''` sentinels for columns that a given `source` does not use (so the keys are well-defined without NULL-distinctness surprises).
- `loadStore()` orders `posts` by `created_at DESC, id ASC` to reproduce the JSON repo's `saveStore` ordering (`createdAt` desc, tie-break `id` asc); metric snapshots and source refs are reassembled in insertion order.

## Data Models

`kind` is stored verbatim as `'original' | 'reply' | 'repost_reference' | 'unknown'` (`archivePostKindSchema`). There is **no `'post'` token** and **no** `original`↔`post` mapping. `logical_post_id` is set to `platform_post_id` (no edit-history field exists in `canonicalOwnPostSchema` from which to derive an edit-chain root — see Implementation Details). All Snowflake IDs are `TEXT`.

The composite primary keys on `metric_obs` and `source_ref` are not arbitrary — they reproduce the ported `snapshotKey` / `sourceRefKey` dedup identities exactly (Blocker fixes: `metric_obs` must keep `imported_at`, and two archive snapshots that share `observed_at` but differ on `imported_at` must both survive; `source_ref` must key on `import_run_id` + `source_hash` for archive; `profile_snapshot` must **append without dedup**).

```sql
CREATE TABLE post (
  id                  TEXT PRIMARY KEY,
  platform            TEXT NOT NULL DEFAULT 'x',
  platform_post_id    TEXT NOT NULL,
  logical_post_id     TEXT NOT NULL,
  text                TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  kind                TEXT NOT NULL,
  language            TEXT,
  in_reply_to_post_id TEXT,
  in_reply_to_user_id TEXT,
  has_urls            INTEGER NOT NULL,
  has_media           INTEGER NOT NULL,
  has_hashtags        INTEGER NOT NULL,
  has_mentions        INTEGER NOT NULL,
  weak_favorite_count INTEGER,
  weak_retweet_count  INTEGER,
  content_hash        TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
-- `platform` is always 'x'; uniqueness on platform_post_id alone preserves the
-- postKey dedup AND lets metric_obs.tweet_id reference it via a foreign key.
CREATE UNIQUE INDEX idx_post_platform_post_id ON post(platform_post_id);
CREATE INDEX idx_post_kind       ON post(kind);
CREATE INDEX idx_post_logical    ON post(logical_post_id);
CREATE INDEX idx_post_created_at ON post(created_at);

-- One row per metric snapshot. The PK reproduces snapshotKey() exactly:
--   archive: (source, observed_at, imported_at)   live: (source, observed_at)   [observed_at = capturedAt]
-- imported_at is '' (NOT NULL) for live, so live rows dedup on (source, capturedAt)
-- only and the composite PK stays well-defined (no NULL-distinctness). tweet_id =
-- post.platform_post_id; parent post must exist first (upsertPosts writes it before this).
CREATE TABLE metric_obs (
  tweet_id       TEXT NOT NULL REFERENCES post(platform_post_id) ON DELETE CASCADE,
  source         TEXT NOT NULL,               -- 'archive_tweets_js' | 'x_live_capture'
  observed_at    TEXT NOT NULL,               -- archive: observedAt; live: capturedAt
  imported_at    TEXT NOT NULL DEFAULT '',    -- archive: importedAt; live: '' (n/a)
  impressions    INTEGER,
  likes          INTEGER,
  reposts        INTEGER,
  replies        INTEGER,
  quotes         INTEGER,
  bookmarks      INTEGER,
  favorite_count INTEGER,                      -- archive weak metric
  retweet_count  INTEGER,                      -- archive weak metric
  content_hash   TEXT NOT NULL,               -- my-feedback-loop's change-detection short-circuit
  PRIMARY KEY (tweet_id, source, observed_at, imported_at)
);
CREATE INDEX idx_metric_obs_tweet ON metric_obs(tweet_id, observed_at);

-- One row per source ref. The PK reproduces sourceRefKey() exactly:
--   archive: (source, import_run_id, raw_id, source_hash)   live: (source, capture_session_id, raw_id)
-- columns a given source does not use are '' (NOT NULL), keeping the PK well-defined.
CREATE TABLE source_ref (
  post_id            TEXT NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  source             TEXT NOT NULL,
  import_run_id      TEXT NOT NULL DEFAULT '',  -- archive only
  source_hash        TEXT NOT NULL DEFAULT '',  -- archive only
  capture_session_id TEXT NOT NULL DEFAULT '',  -- live only
  raw_id             TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (post_id, source, import_run_id, source_hash, capture_session_id, raw_id)
);

-- Append-only: the JSON repo's pushProfileSnapshot appends with NO dedup, so duplicate
-- (platform_user_id, captured_at) rows are allowed. Surrogate rowid PK + non-unique index.
CREATE TABLE profile_snapshot (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_user_id TEXT NOT NULL,
  screen_name      TEXT NOT NULL,
  followers        INTEGER,
  captured_at      TEXT NOT NULL
);
CREATE INDEX idx_profile_snapshot_user ON profile_snapshot(platform_user_id, captured_at);

CREATE TABLE import_run (
  id      TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

CREATE TABLE derived_insight (
  import_run_id TEXT PRIMARY KEY,
  generated_at  TEXT NOT NULL,
  payload       TEXT NOT NULL
);

CREATE TABLE active_context (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  payload   TEXT NOT NULL
);
```

- `import_run`, `derived_insight`, `active_context` keep their existing Zod payloads (`archiveImportRunSchema`, `archiveDerivedInsightSnapshot` / `archiveDerivedInsightsSchema`, `activeArchiveContextSchema`) as JSON `payload` columns; `active_context` is a singleton (`setActiveContext` upserts the single `singleton = 1` row).
- `CanonicalOwnPost`, `PostLibraryStore`, `PostLibraryWriteResult` shapes are unchanged from the existing definitions.

## Integration Point

`SqlitePostLibraryRepository` is a drop-in for `JsonFilePostLibraryRepository` behind the `PostLibraryRepository` interface — but it is **not wired into any host in this ticket** (that is LPF-003). All current corpus consumers (`ArchiveImportService`, `LiveCaptureService`, voice retrieval, judge hints, reach baseline) reach it only through the unchanged 6-method interface.

## Scope Boundaries / Out of Scope

May add `openEngineDatabase`, the `Migration` type + `migrations[]` (migration 1 only), `SqlitePostLibraryRepository`, the `post-row-mapping` module, the ported merge helpers, and the test helpers — plus their tests.

Out of scope: the importer (`importPostLibraryJsonToSqlite`) and host swap (LPF-003); removing `JsonFilePostLibraryRepository` (LPF-004); the `post_vec` vector table, `sqlite-vec`, the embedder, `@huggingface/transformers`, and migrations 2–3 (`voice-rag-generation`); any new transport method (the "exactly 17" `EngineTransport` invariant is untouched).

No raw archive file contents are persisted.

## Test Strategy & Fixture Ownership

Vitest 3, engine unit tests. Dependency category: local-substitutable embedded database. Use an in-process temp DB via `openEngineDatabase(':memory:')` or a tmpdir `x-builder.db` per test; never the user's real storage path.

**This feature OWNS the storage test helpers** `makeTempEngineDb()` and `seedPosts(db, CanonicalOwnPost[])`, exported from an engine storage testing module. They are authored here and consumed by `voice-rag-generation` and `my-feedback-loop` — keep their signatures stable and documented.

Parity is the central assertion **and the pinning surface for the LPF-004 retirement** (both repos still exist here): for a shared fixture batch of `CanonicalOwnPostInput[]`, `SqlitePostLibraryRepository` must return the same `PostLibraryWriteResult` (`insertedCount` / `updatedCount` / `unchangedCount` / `duplicateCount`) and the same `loadStore()` result as `JsonFilePostLibraryRepository`. Two comparison rules make this deterministic:

- **Compare modulo write-time timestamps.** `store.updatedAt` and every `post.updatedAt` are `nowIso()` at save, so they differ between repos by construction — normalize/strip them before the equality assertion (assert all other fields, including `createdAt`, byte-equal).
- **Reproduce post ordering.** The JSON repo's `saveStore` sorts posts `createdAt DESC, id ASC`; `loadStore()` here must `ORDER BY created_at DESC, id ASC` or the array-order comparison fails. Drive the fixture with at least one shared-`createdAt` pair so the `id ASC` tie-break is exercised.

Parity fixtures must include: an archive post with **two** snapshots sharing `observedAt` but differing on `importedAt` (both must survive); a post carrying both an archive and a live snapshot at the same timestamp (both survive); and a profile with two snapshots at the same `capturedAt` (both survive — append, no dedup).

## Definition of Done

- `openEngineDatabase(dbPath)` opens a handle, sets the three PRAGMAs, `chmod 0600`s the file, runs migration 1, and throws `PostLibraryStorageError` on open/migration failure.
- `migrations[]` advances `PRAGMA user_version` to 1 and is structured so a later migration 2/3 can be appended without editing existing entries.
- `SqlitePostLibraryRepository` implements all 6 `PostLibraryRepository` methods with `db.transaction`-wrapped prepared statements, returning resolved promises.
- Ported merge helpers (`mergePost` / `uniqueBy` / `snapshotKey` / `sourceRefKey` / `postKey`) reproduce the JSON repo's merge semantics; the `metric_obs` / `source_ref` composite PKs match `snapshotKey` / `sourceRefKey` and `profile_snapshot` is append-only.
- Archive metric snapshots round-trip `imported_at` (and `observed_at`) losslessly; `loadStore()`'s re-parse through `metricSnapshotSchema` (which requires `importedAt` on archive snapshots) succeeds.
- `loadStore()` reassembles, orders posts `created_at DESC, id ASC`, and re-parses through `postLibraryStoreSchema`.
- `kind` is stored and read back verbatim from the four-value enum; no `'post'` token appears anywhere. `logical_post_id == platform_post_id`.
- `metric_obs.tweet_id` references `post.platform_post_id`; `source_ref.post_id` references `post.id`; both documented and FK-enforced.
- `makeTempEngineDb()` and `seedPosts(...)` are exported from the engine storage testing module.

## Acceptance Criteria

- Given a fresh `openEngineDatabase(':memory:')`, When `loadStore()` runs, Then it returns an empty valid `PostLibraryStore` (`schemaVersion: 2`, `activeContext.status: 'empty'`).
- Given a shared fixture batch, When `upsertPosts(batch)` runs on both repos, Then the `PostLibraryWriteResult` counts are identical across `SqlitePostLibraryRepository` and `JsonFilePostLibraryRepository`.
- Given the same fixture batch upserted, When `loadStore()` runs on both repos, Then the returned `PostLibraryStore` (posts, metric snapshots, source refs) is identical in shape.
- Given two input posts with the same `{ platform, platformPostId }` in one `upsertPosts` call, When it runs, Then one canonical `post` row remains and `duplicateCount` is 1.
- Given an existing post re-upserted with new metric/source data, When `upsertPosts` runs, Then the post is not duplicated and its `metric_obs` / `source_ref` rows are merged (deduped by `snapshotKey` / `sourceRefKey`), counting as `updatedCount`.
- Given an archive post with two metric snapshots that share `observedAt` but differ on `importedAt`, When stored and reloaded, Then both snapshots survive (matching `JsonFilePostLibraryRepository`).
- Given a post with an archive snapshot and a live snapshot at the same timestamp, When stored and reloaded, Then both survive.
- Given an archive metric snapshot, When reloaded, Then its `importedAt` is present and the result re-parses through `metricSnapshotSchema` without error.
- Given two profile snapshots with the same `platformUserId` and `capturedAt`, When both are pushed, Then both rows persist (append, no dedup).
- Given posts with mixed and tied `createdAt`, When `loadStore()` runs, Then posts are ordered `createdAt DESC, id ASC`, matching the JSON repo.
- Given a post with `kind: 'original'`, When stored and reloaded, Then `kind` is exactly `'original'` (no `'post'` mapping) and `logical_post_id == platform_post_id`.
- Given a migration failure (e.g. a bad `up`), When `openEngineDatabase` runs, Then it throws `PostLibraryStorageError`.

## Edge Cases

- Snowflake IDs that exceed JS 53-bit safe-integer range are stored and round-tripped as `TEXT` without precision loss.
- In-batch duplicate `{ platform, platformPostId }` counted in `duplicateCount`, not double-inserted.
- Re-inserting an identical metric snapshot collides on the `(tweet_id, source, observed_at, imported_at)` PK and is an idempotent no-op (`INSERT … ON CONFLICT DO NOTHING`), matching `uniqueBy(snapshotKey)`; a snapshot that differs only in `imported_at` is a distinct row, not a collision.
- A single input post whose `metricSnapshots` / `sourceRefs` array already contains duplicates is deduped by the shred-path `uniqueBy` before insert, so new-post and merge paths behave identically.
- `logical_post_id = platform_post_id` (no edit-history available); not read from input, not invented.
- A post with NULL `in_reply_to_*` reloads with `replyReferences` defaulting to `{}`.
- A live metric/source row stores `''` for the archive-only columns (`imported_at`, `import_run_id`, `source_hash`) and round-trips back to an absent field, never an empty-string value in the reconstructed `CanonicalOwnPost`.
- `active_context` written twice updates the single `singleton = 1` row rather than inserting a second.

## Pipeline Log

- **2026-06-26 — DONE (FND: Red → Blue → Green → Blue+Yellow → Architecture checkpoint).** Commits: tests `b10528a` + `8823749` (Red), impl `9e6b2a7` (Green) — files `open-engine-database.ts`, `sqlite-post-library-repository.ts`, `post-row-mapping.ts`, `sqlite-test-helpers.ts`, `index.ts` (barrel re-exports). **1 rejection cycle** at Validate-Red: Blue caught AC-11's `logical_post_id == platform_post_id` unpinned (the stand-in only exercised the `platform_post_id` UNIQUE index — a different column); Red added a direct white-box column-read assertion. Validate-Green **APPROVE** (target suite 23/23; related 18/18; typecheck clean; the 4 full-suite failures — `posts-analyze` ×3, `judge-draft-service` ×1 — independently confirmed pre-existing via byte-identical tests at baseline `8823749` + import-graph isolation; SQL fully parameterized; one batch transaction; additive `index.ts`). Yellow **APPROVE** (real SQLite store, not a facade — `loadStore` reassembles from normalized tables + re-parses through `postLibraryStoreSchema`; `''` sentinels reconstruct to absent fields; no `'post'` token; zero out-of-scope trace — no vector/importer/host-wiring). Architecture checkpoint **APPROVE** (handle ownership, append-safe `migrations[]` for 2/3, canonical-tables-as-source-of-truth, payload tables opaque; foundation buildable by LPF-003 / voice-rag-generation / my-feedback-loop). **No concerns recorded.** SQLite repo intentionally not wired into any host yet (LPF-003).
