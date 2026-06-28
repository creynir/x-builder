---
status: done
---

# MFL-002: [FND] Add SQLite migration 2 and feedback repository

## Implementation Details

Append migration version 2 to `migrations[]`. Do not edit migration 1. Create `feedback_prediction` and `feedback_prediction_link`, then implement `SqliteFeedbackLoopRepository` over the same `DatabaseHandle` type used by the SQLite post library.

Define one engine-owned `normalizeFeedbackContentHash` helper. It normalizes with NFKC, collapses whitespace, trims, and hashes `sha256:mfl:v1:<normalized>` with SHA-256. Both record and summary/link matching must use this helper.

## Data Models

```sql
CREATE TABLE feedback_prediction (
  id TEXT PRIMARY KEY,
  client_event_id TEXT UNIQUE,
  action TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  content_hash TEXT NOT NULL,
  text TEXT NOT NULL,
  detected_format_snapshot TEXT NOT NULL,
  source_format TEXT,
  score_value INTEGER NOT NULL,
  predicted_mid_impressions INTEGER NOT NULL,
  stall_low INTEGER NOT NULL,
  stall_high INTEGER NOT NULL,
  escape_low INTEGER NOT NULL,
  escape_high INTEGER NOT NULL,
  escape_probability REAL NOT NULL,
  expected_replies REAL NOT NULL,
  base_impressions INTEGER NOT NULL,
  base_source TEXT NOT NULL,
  quality_basis TEXT NOT NULL,
  reach_model_version TEXT NOT NULL,
  prediction_signals_json TEXT NOT NULL,
  scoring_context_json TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE feedback_prediction_link (
  prediction_id TEXT PRIMARY KEY REFERENCES feedback_prediction(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'x' CHECK (platform = 'x'),
  platform_post_id TEXT NOT NULL,
  method TEXT NOT NULL,
  linked_at TEXT NOT NULL
);

CREATE INDEX idx_feedback_prediction_hash ON feedback_prediction(content_hash);
CREATE INDEX idx_feedback_prediction_created ON feedback_prediction(created_at);
CREATE INDEX idx_feedback_prediction_format ON feedback_prediction(detected_format_snapshot, created_at);
CREATE INDEX idx_feedback_link_post ON feedback_prediction_link(platform_post_id);
```

Repository interface:

```ts
interface FeedbackLoopRepository {
  recordPrediction(input: FeedbackPredictionRecord): Promise<{ record: FeedbackPredictionRecord; duplicate: boolean }>;
  upsertLink(input: FeedbackPredictionLink): Promise<FeedbackPredictionLink>;
  listPredictions(request: GetFeedbackLoopSummaryRequest): Promise<FeedbackPredictionRecord[]>;
  listLinks(predictionIds: string[]): Promise<FeedbackPredictionLink[]>;
}
```

There is intentionally no foreign key from `feedback_prediction_link.platform_post_id` to `post.platform_post_id` because a link can be known before live capture inserts the post.

## Integration Point

Producer: `openEngineDatabase` migration runner and `SqliteFeedbackLoopRepository`.

Known consumers: `FeedbackLoopService`, Fastify host construction, runner service bundle, and tests.

User entry point: later overlay actions record predictions and view summaries.

Terminal outcome: prediction rows and explicit links survive process restart and can be listed without reading developer runtime files.

## Scope Boundaries / Out of Scope

In scope: migration 2, repository row mapping, repository tests, content hash helper, duplicate `clientEventId` behavior, and reopen/idempotency coverage.

Out of scope: no service aggregate logic, no post-library schema changes, no `metric_obs` changes, no Fastify routes, no transport, no overlay UI.

Zero-trace: no placeholder service class or unused route wiring.

## Test Strategy & Fixture Ownership

Coverage level: engine storage unit/integration tests. Owning suite: engine server/storage tests. Fixture strategy: use `makeTempEngineDb()` for file-backed reopen tests and `openEngineDatabase(":memory:")` for focused repository tests. Dependency category: in-process SQLite. Isolation boundary: temp DB only; never user storage.

## Definition of Done

- New databases start at user_version 2.
- Existing user_version 1 databases migrate to version 2 without changing migration 1 tables.
- Recorded prediction rows round-trip through schemas.
- Duplicate `clientEventId` returns the existing record with `duplicate: true`.
- Links upsert and survive reopen.
- The content hash helper is covered once and used by repository/service tests.

## Acceptance Criteria

- Given a migrated temp DB / When a prediction is recorded and the DB is reopened / Then the same prediction can be listed.
- Given two records with the same `clientEventId` / When both are recorded / Then only one row exists and the second result is marked duplicate.
- Given an explicit link / When `upsertLink` runs twice for the same prediction / Then the latest link is returned and no duplicate link rows exist.
- Given equivalent Unicode/whitespace text / When `normalizeFeedbackContentHash` runs / Then both inputs produce the same hash.

## Edge Cases

- `client_event_id` may be absent; absent values do not collide.
- Invalid persisted JSON payload columns fail through shared schema parsing.
- Deleting a prediction cascades its link.
- Hash helper never falls back to raw text comparison.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented SQLite migration 2, feedback repository, hash helper, and migration/repository tests.
