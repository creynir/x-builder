---
status: done
---

# MFL-008: [INT] Cover backend and transport feedback loop

## User Flows to Verify

- Given a temp engine database with feedback migration 2 and one seeded captured post / When a prediction is recorded through the feedback route and summary is requested / Then the summary includes a linked predicted-vs-actual outcome and a format learning.
- Given a prediction with no captured post / When the summary is requested through the transport binding / Then the outcome is `pending_unlinked`.
- Given two captured posts with the same normalized content hash / When the summary is requested / Then the outcome is `ambiguous` and no automatic link exists.
- Given an ambiguous prediction / When `linkFeedbackPrediction` is called with a platform post id / Then the next summary shows a manually linked outcome.

## Architectural Invariants

- The same SQLite handle backs `SqlitePostLibraryRepository` and `SqliteFeedbackLoopRepository` in host construction.
- `metric_obs` remains the only actual-metric table; feedback tables store predictions and links only.
- `EngineTransport` exposes exactly 20 methods; stale method names `getFeedbackLoop` and `recordPrediction` do not exist.
- Normalized content hash is produced by one helper used by record and summary matching.
- A facade implementation that computes actuals from feedback rows instead of post-library metrics fails these tests.

## Modules Under Test

- shared feedback-loop schemas
- `openEngineDatabase`
- `SqlitePostLibraryRepository`
- `SqliteFeedbackLoopRepository`
- `FeedbackLoopService`
- feedback Fastify routes
- `ExposeFunctionTransport`
- `createBoundEngineServices`

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented backend-route and real runner transport integration coverage for feedback recording, linking, summaries, and ambiguous matches.
