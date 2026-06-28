---
status: done
---

# MFL-003: Build FeedbackLoopService

## Implementation Details

Implement `FeedbackLoopService` over `FeedbackLoopRepository` and `PostLibraryRepository`.

Responsibilities:

- Record prediction snapshots from `RecordFeedbackPredictionRequest`.
- Create `recorded_platform_post_id` links during recording only when the request includes a confirmed `platformPostId`.
- Create `normalized_content_hash` links only when the normalized hash matches exactly one post-library item.
- Leave zero matches as `pending_unlinked`.
- Mark multiple normalized hash matches as `ambiguous` and do not link.
- Explicitly link predictions through `linkPrediction` with `manual_platform_post_id`.
- Read actuals only from `PostLibraryRepository.loadStore()` and `CanonicalOwnPost.metricSnapshots`.
- Compute recent outcomes, deltas, buckets, and format learnings on demand.

## Data Models

```ts
interface FeedbackLoopService {
  recordPrediction(request: RecordFeedbackPredictionRequest): Promise<RecordFeedbackPredictionResponse>;
  linkPrediction(request: LinkFeedbackPredictionRequest): Promise<LinkFeedbackPredictionResponse>;
  getSummary(request?: GetFeedbackLoopSummaryRequest): Promise<GetFeedbackLoopSummaryResponse>;
}
```

Outcome status rules:

- `linked`: prediction has a link and a live actual with impressions.
- `pending_unlinked`: prediction has no link and zero unique hash matches.
- `ambiguous`: prediction has no link and multiple content-hash candidate posts.
- `partial_actuals`: prediction has a link but only weak archive metrics or missing impressions.

Bucket rules compare actual impressions to the snapshotted prediction's stall/escape ranges.

## Integration Point

Producer: `FeedbackLoopService`.

Known consumers: feedback Fastify routes and runner bound services.

User entry point: later overlay record/link/summary actions.

Terminal outcome: callers receive a validated feedback summary that compares predicted reach with actual local metrics.

## Scope Boundaries / Out of Scope

In scope: service orchestration, hash matching, explicit link semantics, latest actual snapshot selection, format-level aggregation, and schema-validated responses.

Out of scope: no route registration, no transport binding, no UI, no reach weight mutation, no LLM calls, no standalone judge verdict persistence, no every-keystroke storage.

Zero-trace: do not add background jobs, polling hooks, or future vector/embedding seams.

## Test Strategy & Fixture Ownership

Coverage level: engine service unit/integration tests. Owning suite: engine feedback tests. Fixture strategy: use `makeTempEngineDb()` and `seedPosts()` with canonical posts containing live and archive metric snapshots. Dependency category: in-process SQLite and in-process repository. Isolation boundary: temp DB; no user storage, no network, no live X.

## Definition of Done

- Record, link, and summary paths return shared-schema-valid responses.
- Summary defaults to a 90-day window and max 50 recent outcomes.
- Unique hash auto-link works.
- Ambiguous hash matches fail closed.
- Explicit manual platform id link wins over hash matching.
- Format learnings use snapshotted prediction format, not a recomputed prediction-time format.

## Acceptance Criteria

- Given a generated prediction and one captured post with the same normalized text / When summary is requested / Then the outcome is linked by `normalized_content_hash` and includes impression deltas.
- Given a prediction whose normalized text matches two captured posts / When summary is requested / Then the outcome status is `ambiguous` and no link is created.
- Given a prediction explicitly linked to a platform post id / When summary is requested / Then that platform post id is used even if content hash candidates differ.
- Given a linked post with only archive weak metrics / When summary is requested / Then the outcome status is `partial_actuals`.
- Given actual outcomes for one format / When format learnings are computed / Then medians, ratio, direction, and adjustment are populated.

## Edge Cases

- Predictions without matching posts remain `pending_unlinked`.
- Missing metric snapshots produce partial/missing actuals, not crashes.
- Empty stores produce zero totals and empty arrays.
- Older predictions outside `windowDays` are excluded.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented FeedbackLoopService recording, linking, unique-hash matching, summaries, and service tests.
