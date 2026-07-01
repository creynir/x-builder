---
status: todo
---

# RTC-005: Observed Thread Storage

## Implementation Details

Add an engine SQLite migration and repository for observed thread posts. Store observed non-own root/parent/ancestor nodes separately from the canonical own-post corpus. Ingest observed graph nodes from passive GraphQL capture and local archive/live own-post projections.

## Data Models

SQLite tables:

```sql
observed_thread_post(
  platform_post_id text primary key,
  author_handle text,
  author_display_name text,
  author_user_id text,
  text text not null,
  created_at text,
  status_url text,
  kind text,
  in_reply_to_post_id text,
  in_reply_to_user_id text,
  conversation_id text,
  weak_metrics_json text not null,
  observed_at text not null,
  updated_at text not null
)
```

```sql
observed_thread_post_source(
  platform_post_id text not null,
  source text not null,
  first_observed_at text not null,
  last_observed_at text not null,
  raw_id text,
  capture_session_id text,
  import_run_id text,
  primary key (platform_post_id, source)
)
```

Indexes:

- `platform_post_id`
- `in_reply_to_post_id`
- `conversation_id, created_at`
- `author_handle`

## Integration Point

User entry point: passive capture and archive/live import already performed by the local runner/engine.

Existing module consumers: engine SQLite migration runner, `LiveCaptureService`, archive/live projection code, `ReplyThreadContextResolver`.

Terminal outcome: resolver can query observed thread nodes by status id, parent id, and conversation id.

## Scope Boundaries / Out of Scope

In scope:

- Append-only migration.
- Repository upsert/query methods for observed thread posts.
- Dual-write from passive capture into observed-thread storage.
- Projection of own archive/live posts as observed own reply evidence.

Out of scope:

- Modifying `PostLibraryRepository` public semantics for non-own posts.
- Treating non-own tweets as voice/corpus evidence.
- Network fetches or parent-chain enrichment.
- Cloud storage.

## Test Strategy & Fixture Ownership

Coverage level: SQLite migration and repository integration tests.

Owning suite: engine storage tests.

Fixture strategy: in-memory SQLite database with root, parent, target, duplicate observation, missing optional fields, and previous own reply rows.

Dependency category: local-substitutable SQLite.

Isolation boundary: in-memory or temp SQLite path only.

## Definition of Done

- Migration creates observed-thread tables and indexes.
- Repository can upsert duplicate observations without duplicate graph nodes.
- Repository can load by status id, parent id, and conversation id.
- Non-own observed posts are not stored in canonical own-post tables.

## Acceptance Criteria

- Given: observed root, parent, and target nodes / When: they are upserted / Then: they can be loaded by status id and edge relationship.
- Given: duplicate observations for one status id / When: they are upserted / Then: stored evidence merges without duplicate graph nodes.
- Given: a non-own parent tweet / When: it is ingested / Then: it appears in observed-thread storage and not in canonical own-post storage.
- Given: an own prior reply from archive/live evidence / When: it is projected / Then: it can be queried as a previous own reply candidate.

## Edge Cases

- Missing optional author handle.
- Empty text rejected before storage.
- Duplicate observation with newer metrics.
- Parent id cycle.
- Unknown source string rejected.

## Pipeline Log
