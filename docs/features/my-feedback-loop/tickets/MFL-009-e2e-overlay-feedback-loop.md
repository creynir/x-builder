---
status: done
---

# MFL-009: [E2E] Verify overlay feedback happy path

## User Flows to Verify

- Given the overlay is mounted over the mock X composer with feedback transport available / When the user generates a draft and records it / Then the overlay calls `recordFeedbackPrediction` once and shows a pending/unlinked feedback state.
- Given a recorded prediction and later captured actual metrics in the local test harness / When the user opens settings / Then the feedback section shows predicted-vs-actual summary and format adjustment.
- Given an ambiguous prediction in the summary / When the user manually links it to a platform post id / Then the settings section refreshes and shows `Linked manually` for that row.
- Given the user only types in the composer / When debounce analysis runs / Then no feedback prediction is recorded.

## Architectural Invariants

- Full user path goes through overlay `useTransport`, runner transport assembly, bound engine services, and local engine repositories.
- No e2e step depends on real x.com, live network metrics, developer storage, or hosted analytics.
- Manual linking is explicit; ambiguous content matches are never auto-selected by the UI.
- Feedback UI renders from server-derived summary data rather than scanning local UI state.

## Modules Under Test

- `ComposeCockpit`
- `SettingsAffordance`
- `SettingsPanel`
- `OverlayTransportProvider`
- runner transport harness
- feedback engine services over a temp database
- mock X fixtures

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented and passed targeted Playwright E2E coverage for generated recording, typed-draft non-recording, settings actuals, and ambiguous manual linking.
