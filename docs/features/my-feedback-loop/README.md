---
status: done
---

# My Feedback Loop

Purpose: learn from the user's actual published post performance: predicted vs actual, which formats work for this account, and what the writer should adjust next.

## Architecture Context

My Feedback Loop is a local calibration ledger on top of the SQLite corpus shipped by Local Persistence Foundation. It persists only deliberate prediction snapshots, then compares them with actual post metrics already captured in the local post library. It does not change `PostLibraryRepository`, does not change `metric_obs`, does not auto-tune reach weights, does not store every debounced typed draft, and does not add cloud analytics.

The core loop is:

1. The overlay records a prediction only after a deliberate user/engine action: generated draft written, apply-all result written, or manual posted-draft record.
2. The engine stores the prediction snapshot in `feedback_prediction`.
3. The engine links the prediction to a real X post through a recorded platform post id, an explicit manual platform post id, or a unique normalized content hash match.
4. Existing live capture / archive import continues writing actual metrics into the post library.
5. `FeedbackLoopService` computes server-derived summaries: predicted-vs-actual outcomes, format-level lessons, pending/unlinked records, ambiguous matches, and partial actuals.
6. The overlay surfaces compact learning in the compose/settings experience without guessing client-side analytics.

Hash matching is intentionally fail-closed. A normalized content hash may auto-link only when it matches exactly one captured post-library item. Zero matches stay `pending_unlinked`; multiple matches become `ambiguous` and require explicit user linking through `linkFeedbackPrediction`.

Summary status names stay schema-first: `linked`, `pending_unlinked`, `ambiguous`, and `partial_actuals`. UI labels such as "Auto-linked" or "Linked manually" derive from the link method, not from separate wire statuses.

## API Endpoints

- `POST /feedback/predictions` - records a deliberate prediction snapshot; may immediately create a `recorded_platform_post_id` link if a confirmed `platformPostId` is supplied.
- `POST /feedback/predictions/link` - explicitly links a stored prediction to a platform post id using `manual_platform_post_id`.
- `POST /feedback/summary` - returns the server-derived feedback summary for a bounded window and optional format filter.

The overlay reaches the same behavior through the three new `EngineTransport` methods:

- `recordFeedbackPrediction(request)`
- `linkFeedbackPrediction(request)`
- `getFeedbackLoopSummary(request?)`

The transport surface grows from exactly 17 methods to exactly 20 methods. Every shared, runner, and overlay binding-count test must move together.

## User Guide

- [Use My Feedback Loop](../../how-to/use-my-feedback-loop.md)

## Component Breakdown

- `feedback-loop` shared schemas - Zod contracts for record/link/summary requests, prediction records, links, outcomes, actuals, format learnings, and feedback API errors.
- `SqliteFeedbackLoopRepository` - writes `feedback_prediction` and `feedback_prediction_link` rows through the same SQLite handle as the post library.
- `normalizeFeedbackContentHash` - single engine-owned helper for NFKC + whitespace-collapse + trim + `sha256:mfl:v1:<normalized>` hashing.
- `FeedbackLoopService` - records predictions, creates explicit links, attempts unique hash links, reads actuals from `PostLibraryRepository.loadStore()`, and computes summaries.
- `buildServer` feedback routes - validates feedback requests/responses and maps storage failures to feedback API errors.
- `BoundEngineServices` feedback bindings - exposes the three feedback methods to the runner transport.
- `ComposeCockpit` feedback recording - records only deliberate generated/apply/manual actions, never normal typing/debounced analysis.
- `FeedbackLoopSettingsSection` - renders summary health, status rows, format learnings, and explicit manual linking controls.

## Dependencies

- `local-persistence-foundation` is complete. It provides `openEngineDatabase`, `SqlitePostLibraryRepository`, `makeTempEngineDb`, and `seedPosts`.
- Existing deterministic analysis response fields: `detectedFormat`, `score.value`, `prediction`, `analyzerVersion`, `analyzedAt`, and `scoringContext`.
- Existing actual metric source: `CanonicalOwnPost.metricSnapshots`.
- Existing overlay transport and settings patterns.

## Sub-Tickets Overview

1. `MFL-001: [FND] Define feedback-loop shared contracts`
2. `MFL-002: [FND] Add SQLite migration 2 and feedback repository`
3. `MFL-003: Build FeedbackLoopService`
4. `MFL-004: Add feedback Fastify routes`
5. `MFL-005: Extend EngineTransport and runner bindings`
6. `MFL-006: Record deliberate compose actions`
7. `MFL-007: Show feedback summary and manual links in settings`
8. `MFL-008: [INT] Cover backend and transport feedback loop`
9. `MFL-009: [E2E] Verify overlay feedback happy path`
10. `MFL-010: [DOC] Document My Feedback Loop`

## Pipeline Log

- 2026-06-28: Arch recon approved with concerns. Concerns folded into tickets: schema-first summary statuses, shared SQLite handle wiring, and single normalized content hash helper.
- 2026-06-28: RGB ticket audit approved. Correction applied: integration/e2e dependency table now separates backend-transport integration from compose/settings e2e dependencies.
- 2026-06-28: Build implemented through MFL-010. Targeted Playwright E2E passed for generated recording, typed-draft non-recording, settings summary, and ambiguous manual linking.
