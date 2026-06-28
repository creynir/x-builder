---
status: done
---

# MFL-006: Record deliberate compose actions

## Implementation Details

Extend `ComposeCockpit` to record feedback predictions only after deliberate actions:

- generated draft written to the composer -> `generated_draft_written`
- apply-all result written to the composer -> `apply_all_result_written`
- user explicitly marks the current draft as posted -> `manual_record_posted_draft`

Do not record normal typing, debounced `analyzePosts`, passive judge runs without a selected/written draft, or stale async resolutions.

When a deliberate action has no current scored snapshot, re-run `analyzePosts` for the exact current text before recording. The request must include `detectedFormat`, `score.value`, available `prediction`, `scoringContext`, `analyzerVersion`, and `analyzedAt` from the static analysis result.

## Data Models

```ts
recordFeedbackPrediction({
  clientEventId,
  action,
  text,
  platform: "x",
  platformPostId?,
  snapshot,
});

type FeedbackRecordState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "recorded"; linked: boolean }
  | { status: "failed"; message: string };
```

## Integration Point

Producer: `ComposeCockpit` feedback recording flow.

Known consumers: `recordFeedbackPrediction` transport method and `FeedbackLoopService`.

User entry point: X compose modal inside the existing cockpit.

Terminal outcome: a deliberate prediction snapshot is recorded, and the user sees a quiet recorded/pending/error state without posting automation.

## Scope Boundaries / Out of Scope

In scope: compose-side record state, deliberate action hooks, manual posted-draft control, exact-text analysis before record when needed, non-blocking failure display.

Out of scope: no settings summary UI, no manual platform id link form, no transport/schema changes, no auto-posting, no typed-draft recording, no polling.

Zero-trace: do not add hidden background recorders or local storage caches.

## Test Strategy & Fixture Ownership

Coverage level: overlay browser-mode component/integration tests. Owning suite: compose cockpit tests. Fixture strategy: `FakeEngineTransport` overrides for `analyzePosts`, `recordFeedbackPrediction`, `generateIdeas`, and `applyJudgeSuggestions`; use existing compose fixture helpers. Dependency category: in-process fake transport and DOM fixture. Isolation boundary: no real X, no real runner.

## Definition of Done

- Generate path records exactly once for the written candidate.
- Apply-all path records exactly once for the improved text.
- Manual posted-draft control records `manual_record_posted_draft`.
- Regular typing and debounce analysis never call `recordFeedbackPrediction`.
- Failed recording does not block composing, generating, judging, or applying.

## Acceptance Criteria

- Given a generated candidate is written to the composer / When recording succeeds / Then `recordFeedbackPrediction` is called once with action `generated_draft_written`.
- Given the user types and static analysis runs / When no deliberate record action occurs / Then `recordFeedbackPrediction` is not called.
- Given apply-all writes improved text / When static analysis for that text is available / Then `recordFeedbackPrediction` is called once with action `apply_all_result_written`.
- Given the user marks a draft as posted with no platform post id / When recording succeeds / Then the UI shows a pending/unlinked state, not linked.
- Given recording fails / When the user keeps composing / Then the cockpit remains usable and shows a retryable feedback error.

## Visual AC

- Record controls are secondary/quiet, never primary CTA.
- Recorded state must not imply actual performance is already linked.
- Pending/unlinked copy uses concise text such as `Waiting for captured post` or `Needs link`.
- Use existing v2 `Button`, `Badge`, `Alert`, and token styles only.
- No layout shift in the existing cockpit pins.

## Edge Cases

- Stale generated/apply promises must not record after the composer has changed.
- A disabled prediction is not recorded.
- Empty composer text disables manual record.
- Duplicate client event responses show recorded state without duplicate UI rows.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented deliberate compose recording for generated drafts, apply-all results, and the manual Record posted draft control; typing remains non-recording.
