# Storage Redesign — High-Level Design

## Problem

The canonical corpus is a single JSON file, `post-library.json`, owned by `JsonFilePostLibraryRepository`. Every write loads the entire file, validates it with `postLibraryStoreSchema`, mutates it in memory, and rewrites the whole file (temp-file-plus-rename), serialized through an in-process promise queue. That model was right for a one-time archive import. It does not survive the next three features: append-only metric history, voice retrieval that filters and ranks a growing corpus, and a vector index. This feature lays the durable foundation: a single local SQLite database, with any existing JSON migrated in once and the flat file retired.

## Why SQLite

- **Indexed reads over a growing corpus.** Voice retrieval filters on `kind = 'original'` and ranks by recency / engagement. A JSON blob forces a full parse + linear scan on every read; SQLite gives `idx_post_kind`, `idx_post_created_at`, and (next feature) a vector index.
- **Append-only metric history without rewrite amplification.** The periodic-snapshot metric model (`metric_obs`) only grows. Appending one observation to a JSON file rewrites the entire corpus; in SQLite it is one `INSERT OR IGNORE`.
- **Real atomicity without a hand-rolled queue.** `better-sqlite3` is synchronous; `db.transaction(...)` gives multi-statement atomicity directly, retiring the `withSerializedWrite` promise queue.
- **Embedded, local, zero-config.** No server, no daemon. One file under the user's home directory, `chmod 0600`, WAL journaling. The product stays single-binary and offline-first.
- **A place for the voice index.** `voice-rag-generation` adds a local rebuildable voice projection as a later migration on the same handle — no second store, no cross-store consistency problem.

## Source of truth vs derived index

The redesign draws a hard line:

- **Source of truth (canonical, normalized):** `post`, `metric_obs`, `source_ref`, `profile_snapshot`. These hold corpus content and metric observations as first-class columns. Nothing else may claim to be the canonical corpus.
- **Opaque validated payloads:** `import_run`, `derived_insight`, `active_context`. These already carry self-contained, Zod-validated payloads (`archiveImportRunSchema`, `archiveDerivedInsightsSchema`, `activeArchiveContextSchema`). They are stored verbatim as JSON `payload` columns and parsed back through their existing schema. SQL does not introspect them; re-normalizing them would add coupling for no query benefit.
- **Derived index (rebuildable projection):** the voice embedding table. It is a function of `post` and can always be rebuilt from the source of truth, so it is not canonical and not in this feature. It belongs to `voice-rag-generation`.

The contract guard for "source of truth": `loadStore()` reassembles `CanonicalOwnPost[]` from the canonical tables and re-parses the full store through `postLibraryStoreSchema`. If a mapping drifts, the parse throws — the wire shape cannot silently diverge from the JSON era.

## Migration / strangler approach

This is a strangler: the interface stays, the implementation is replaced behind it, and the old store is migrated then retired — in four steps so each is independently testable and reversible.

1. **Stand up the new store next to the old one (LPF-002).** `openEngineDatabase` + migration 1 + `SqlitePostLibraryRepository`. Nothing wired in yet; proven by parity tests against the JSON repo on a shared fixture batch.
2. **One-time import + host swap (LPF-003).** `importPostLibraryJsonToSqlite` reads any existing `post-library.json` (reusing the existing v1→v2 upgrade branch), writes it into SQLite, and renames the file to `post-library.json.migrated`. Both hosts (`createBoundEngineServices`, `buildServer`) switch to constructing `SqlitePostLibraryRepository`.
3. **Retire the JSON write paths (LPF-004).** Remove `JsonFilePostLibraryRepository` and its `saveStore` / `withSerializedWrite` machinery. Keep only the importer's one-time read path so existing users still upgrade.
4. **Lock it down (LPF-005).** Cross-impl parity + idempotency tests, plus an on-disk assertion that the real artifact is `x-builder.db` (+ `.migrated`) and no JSON facade survived.

Reversibility: until LPF-004, the JSON repo still exists, and `post-library.json.migrated` is never deleted — a user can rename it back if anything goes wrong.

## Kind-vocabulary decision

The post-kind enum is **`original | reply | repost_reference | unknown`** (`archivePostKindSchema`). There is no `'post'` token anywhere in the codebase. Decision: **store the enum verbatim** in `post.kind`; introduce **no** `'post'` token and **no** `original`↔`post` mapping.

Rationale: downstream voice retrieval filters on `kind = 'original'`, and `loadStore` re-parses every row through `canonicalOwnPostSchema`. Any remap would either break the voice filter or fail the re-parse. The enum is validator-pinned at both the write boundary (insert) and the read boundary (re-parse), so it is the single thing most likely to be quietly "improved" — and the one thing that must not change.

## Performance

- **PRAGMAs:** `journal_mode = WAL` (concurrent reads during a write, no full-file rewrite), `synchronous = NORMAL` (durable enough for a local single-user corpus, far faster than `FULL`), `foreign_keys = ON` (enforce `source_ref → post` cascade).
- **Indexes:** `idx_post_platform_post_id` (UNIQUE on `platform_post_id` — the upsert key, and the FK target for `metric_obs.tweet_id`), `idx_post_kind` (voice filter, `kind='original'`), `idx_post_logical` (logical-id grouping; `logical_post_id = platform_post_id` today, edit-chain-ready), `idx_post_created_at` (recency ranking), `idx_metric_obs_tweet` on `(tweet_id, observed_at)` (latest-metrics-per-post).
- **Writes:** multi-statement upserts wrapped in `db.transaction` with prepared statements; one transaction per `upsertPosts` call rather than one per post.
- **ID precision:** all Snowflake IDs stored as `TEXT` — no numeric coercion, no precision loss, and string PKs index fine.
- **Dedup identity (parity-critical):** the `metric_obs` / `source_ref` composite PKs reproduce the ported `snapshotKey` (`(source, observed_at, imported_at)` archive / `(source, observed_at)` live) and `sourceRefKey` exactly — archive snapshots keep `imported_at` so they round-trip through `metricSnapshotSchema`, and two archive snapshots differing only in `imported_at` both survive. `profile_snapshot` is **append-only** (surrogate rowid, no dedup), matching `pushProfileSnapshot`. The separate `content_hash` column is `my-feedback-loop`'s write-time "metrics changed?" short-circuit, not the parity dedup key.

## Out of scope (this feature)

The voice index, embedder, and retrieval provider belong to `voice-rag-generation`. No transport method is added or changed by the local-persistence foundation. This feature is migration 1 (base store) plus the migration mechanism only.
