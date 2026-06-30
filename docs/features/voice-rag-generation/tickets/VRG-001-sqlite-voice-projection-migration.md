---
status: done
---

# VRG-001: [FND] SQLite voice projection migration

## Implementation Details

Append migration 4 to the existing `openEngineDatabase` migrations array. The migration creates a local rebuildable voice projection beside the canonical corpus tables. It must not edit existing migration entries.

Create `voice_index_meta`:

```sql
CREATE TABLE voice_index_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  embedder_id TEXT NOT NULL,
  embedder_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  distance_metric TEXT NOT NULL CHECK (distance_metric IN ('cosine')),
  updated_at TEXT NOT NULL,
  last_successful_index_at TEXT,
  last_error_at TEXT,
  last_error TEXT
);
```

Create `voice_post_embedding`:

```sql
CREATE TABLE voice_post_embedding (
  post_id TEXT PRIMARY KEY REFERENCES post(id) ON DELETE CASCADE,
  platform_post_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  post_updated_at TEXT NOT NULL,
  embedder_id TEXT NOT NULL,
  embedder_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_blob BLOB NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE INDEX idx_voice_post_embedding_model
  ON voice_post_embedding(embedder_id, embedder_version);
CREATE INDEX idx_voice_post_embedding_content
  ON voice_post_embedding(content_hash, post_updated_at);
```

The projection stores only derived local vectors and metadata needed to detect staleness. The canonical corpus stays in `post` and related tables.

## Data Models

`voice_index_meta` is a singleton status row keyed by `singleton = 1`. `last_error_at` and `last_error` are optional local status fields for indexing-level failures. They are not prompt content and must not be sent to the LLM.

`voice_post_embedding.post_id` references canonical `post.id` with `ON DELETE CASCADE`. `platform_post_id`, `content_hash`, and `post_updated_at` mirror canonical row values at indexing time so later services can detect stale rows without changing canonical tables.

`vector_blob` is an opaque BLOB at this ticket. VRG-002 owns its binary encoding contract.

## Integration Point

User entry point: existing Generate button in the overlay. The user does not directly trigger this migration; it runs when the host opens the local database before generation services are constructed.

Consumer: `VoiceIndexService` in VRG-003 reads and writes these tables.

Terminal outcome: a migrated local `x-builder.db` at `PRAGMA user_version = 4` with rebuildable voice projection tables ready for lazy indexing.

## Scope Boundaries / Out of Scope

In scope: migration 4 DDL, indexes, FK cascade behavior, idempotent open behavior, and tests that prove the schema exists.

Out of scope: embedding implementation, retrieval, guidance rendering, runner wiring, UI, transport changes, feedback actual changes, and any cloud/model dependency.

## Test Strategy & Fixture Ownership

Coverage level: engine storage/migration tests. Owning suite: existing engine server SQLite migration tests. Fixture strategy: `openEngineDatabase(":memory:")` and `makeTempEngineDb()`; seed canonical posts through `seedPosts()` when testing cascade behavior. Dependency category: in-process SQLite. Isolation boundary: temp DB or in-memory DB only, never the real user storage path.

## Definition of Done

- Opening a fresh DB applies migration 4 after migrations 1-3.
- Reopening an already migrated DB leaves schema and user version unchanged.
- `voice_post_embedding` rows cascade when their canonical `post` row is deleted.
- The canonical `PostLibraryRepository` method surface remains unchanged.

## Acceptance Criteria

- Given a migrated v3 database, when `openEngineDatabase` runs, then `PRAGMA user_version` becomes 4 and both voice projection tables exist.
- Given a v4 database, when it is reopened, then migration 4 does not duplicate indexes or fail.
- Given a canonical post with an embedding row, when the canonical post row is deleted, then the embedding row is removed by FK cascade.
- Given a repository instance, when public repository methods are inspected, then no voice-specific method has been added.

## Edge Cases

- `:memory:` database opens.
- Existing file-backed user DB opens.
- Migration DDL failure rolls back through the existing migration transaction.
- Foreign keys stay enabled for cascade behavior.

## Pipeline Log

- 2026-06-29: Implemented migration 4 with `voice_index_meta` and `voice_post_embedding`, FK cascade coverage, and updated current-schema version assertions to 4. Focused storage migration tests pass.
