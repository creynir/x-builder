---
status: done
---

# MFL-004: Add feedback Fastify routes

## Implementation Details

Wire `FeedbackLoopService` into `buildServer` and expose three local Fastify routes:

- `POST /feedback/predictions`
- `POST /feedback/predictions/link`
- `POST /feedback/summary`

Each route validates its request with the shared schema, calls the service, validates the response with the shared schema, and maps storage/service failures to feedback API errors.

Host construction must create `SqlitePostLibraryRepository` and `SqliteFeedbackLoopRepository` from the same SQLite handle when `storageRoot` is used. Do not open separate DB handles for the feedback repository in production host construction.

## Data Models

```ts
POST /feedback/predictions
request: RecordFeedbackPredictionRequest
response: RecordFeedbackPredictionResponse

POST /feedback/predictions/link
request: LinkFeedbackPredictionRequest
response: LinkFeedbackPredictionResponse

POST /feedback/summary
request: GetFeedbackLoopSummaryRequest
response: GetFeedbackLoopSummaryResponse
```

Feedback API errors: `feedback_record_failed`, `feedback_link_failed`, `feedback_summary_failed`.

## Integration Point

Producer: `buildServer` route table.

Known consumers: `EngineTransport` runner bindings and direct engine API tests.

User entry point: overlay transport calls in later tickets.

Terminal outcome: local API can record, link, and summarize feedback data against isolated local storage.

## Scope Boundaries / Out of Scope

In scope: Fastify routes, dependency construction, same-handle SQLite repository wiring, response parsing, API error mapping, route tests.

Out of scope: no shared schema changes beyond consuming MFL-001, no transport binding changes, no overlay UI, no E2E browser tests.

Zero-trace: do not add hidden HTTP routes or unused service options.

## Test Strategy & Fixture Ownership

Coverage level: engine API integration tests through `app.inject()`. Owning suite: engine server tests. Fixture strategy: inject temp SQLite repositories and service dependencies; seed actual posts with `seedPosts()`. Dependency category: in-process Fastify and SQLite. Isolation boundary: temp DB or injected repositories only.

## Definition of Done

- All three routes parse requests and responses with shared schemas.
- Storage failures map to feedback-scoped API errors.
- `buildServer({ storageRoot })` creates post and feedback repositories from one DB handle.
- Bare `buildServer()` remains isolated and touches no home directory.

## Acceptance Criteria

- Given a valid record request / When `POST /feedback/predictions` is called / Then it returns a schema-valid record response.
- Given a valid link request / When `POST /feedback/predictions/link` is called / Then it returns a schema-valid link response.
- Given seeded prediction and actual data / When `POST /feedback/summary` is called / Then the response includes linked outcome and format learning data.
- Given a repository storage failure / When any feedback route is called / Then the response has a feedback-scoped API error.

## Edge Cases

- Invalid record payload rejects before service call.
- Invalid link payload rejects before service call.
- Summary request may be omitted or `{}` and still uses defaults.
- A service error must not leak stack traces or local filesystem paths.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented feedback Fastify routes and route tests for record/link/summary behavior.
