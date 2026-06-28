---
status: done
---

# MFL-001: [FND] Define feedback-loop shared contracts

## Implementation Details

Add shared feedback-loop schemas and exports for recording predictions, explicitly linking predictions, and reading bounded summaries. Add feedback API error codes `feedback_record_failed`, `feedback_link_failed`, `feedback_summary_failed`, plus API error scope `feedback`.

Do not add storage, routes, transport bindings, or UI in this ticket.

## Data Models

Define Zod schemas and exported types for:

```ts
type FeedbackPredictionAction =
  | "generated_draft_written"
  | "apply_all_result_written"
  | "manual_record_posted_draft";

type FeedbackLinkMethod =
  | "recorded_platform_post_id"
  | "manual_platform_post_id"
  | "normalized_content_hash";

type FeedbackOutcomeStatus =
  | "linked"
  | "pending_unlinked"
  | "ambiguous"
  | "partial_actuals";
```

`FeedbackPredictionSnapshot` contains `detectedFormat`, optional `sourceFormat`, `scoreValue`, available `EngagementPrediction`, `ScoringContext`, `analyzerVersion`, and `analyzedAt`.

`RecordFeedbackPredictionRequest` contains optional `clientEventId`, `action`, trimmed non-empty `text`, optional `platformPostId`, and `snapshot`. The snapshot prediction must be the `available` engagement prediction variant; disabled predictions are not recordable.

`FeedbackPredictionRecord` contains generated `id`, optional `clientEventId`, action, text, `contentHash`, platform `x`, snapshotted format/source format, score, prediction, scoring context, analyzer version, analyzed timestamp, and created timestamp.

`FeedbackPredictionLink` contains `predictionId`, platform `x`, `platformPostId`, link `method`, and `linkedAt`.

`FeedbackOutcome` contains schema-first `status`, prediction, optional link, actual data, optional ambiguity metadata, and deltas. UI labels such as auto-linked/manual-linked must derive from link method, not from additional statuses.

`FeedbackFormatLearning` contains format counts, optional medians/ratio/escape rate, direction, and adjustment copy.

`GetFeedbackLoopSummaryRequest` defaults `windowDays` to 90, caps it at 365, defaults `limit` to 50, caps it at 200, and accepts optional `format`.

`GetFeedbackLoopSummaryResponse` contains `generatedAt`, `windowDays`, totals, `formatLearnings`, and `recent` outcomes.

## Integration Point

Producer: shared feedback-loop schema module.

Known consumers: `SqliteFeedbackLoopRepository`, `FeedbackLoopService`, feedback routes, `EngineTransport`, runner transport binding, `FakeEngineTransport`, `ComposeCockpit`, and `SettingsPanel`.

User entry point: later tickets expose recording and summary through the overlay.

Terminal outcome: all downstream tickets use one typed contract instead of inventing local shapes.

## Scope Boundaries / Out of Scope

In scope: shared schemas, shared types, shared exports, feedback API error codes/scope, and schema tests.

Out of scope: no SQLite migration, no repository implementation, no Fastify routes, no runner bindings, no overlay UI, no generated/judge verdict persistence beyond the prediction snapshot contract.

Zero-trace: do not add placeholder service methods or unused transport methods in this ticket.

## Test Strategy & Fixture Ownership

Coverage level: shared schema unit tests. Owning suite: shared schema tests. Fixture strategy: minimal valid record/link/summary fixtures plus invalid variants for disabled predictions, bad hashes, too-long text, bad status names, and stale method names. Dependency category: in-process only. Isolation boundary: no filesystem, no SQLite, no network.

## Definition of Done

- All feedback-loop schemas parse valid payloads and reject invalid payloads.
- Feedback API errors parse with scope `feedback`.
- Summary statuses are only `linked`, `pending_unlinked`, `ambiguous`, and `partial_actuals`.
- Shared barrel exports schemas and types.

## Acceptance Criteria

- Given a valid available prediction snapshot / When record request parsing runs / Then the payload is accepted.
- Given a disabled prediction / When record request parsing runs / Then it is rejected.
- Given a summary outcome with status `auto_linked` / When summary parsing runs / Then it is rejected.
- Given a feedback API error with code `feedback_summary_failed` and scope `feedback` / When parsing runs / Then it is accepted.
- Given an ambiguous outcome with candidate post ids / When summary parsing runs / Then ambiguity metadata is preserved.

## Edge Cases

- Empty or whitespace-only text is rejected.
- `platform` defaults to `x` but no other platform parses.
- Optional summary request `{}` uses defaults.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented shared feedback schemas, shell feedback errors, exports, and schema tests.
