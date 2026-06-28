---
status: done
---

# MFL-007: Show feedback summary and manual links in settings

## Implementation Details

Add a feedback-loop section to the existing settings experience. The section fetches `getFeedbackLoopSummary(request?)`, renders server-derived totals, format learnings, recent outcomes, and exposes manual linking controls for `pending_unlinked` and `ambiguous` outcomes.

When a user provides or selects a platform post id for an unlinked prediction, call `linkFeedbackPrediction` with method `manual_platform_post_id`, then refresh the summary.

UI labels derive from schema fields:

- `linked` + `normalized_content_hash` -> `Auto-linked`
- `linked` + `recorded_platform_post_id` -> `Linked from captured post`
- `linked` + `manual_platform_post_id` -> `Linked manually`
- `pending_unlinked` -> `Waiting for captured post` or `Needs link`
- `ambiguous` -> `Multiple possible posts found`
- `partial_actuals` -> `Linked, waiting for impressions`

## Data Models

```ts
type FeedbackLoopLoadable =
  | "loading"
  | { error: string }
  | GetFeedbackLoopSummaryResponse;

type FeedbackLinkFormState =
  | { status: "idle"; platformPostId: string }
  | { status: "linking"; platformPostId: string }
  | { status: "linked"; platformPostId: string }
  | { status: "failed"; platformPostId: string; message: string };
```

## Integration Point

Producer: `FeedbackLoopSettingsSection` mounted by `SettingsPanel`.

Known consumers: `getFeedbackLoopSummary` and `linkFeedbackPrediction` transport methods.

User entry point: existing settings launcher in the overlay.

Terminal outcome: user can see which formats work, which predictions are waiting, and manually link ambiguous/unlinked predictions.

## Scope Boundaries / Out of Scope

In scope: settings section, load/error/empty/ready states, format learning rows, recent outcome rows, manual platform post id linking, summary refresh after link.

Out of scope: no compose recording changes, no backend aggregation changes, no new launcher, no raw history table beyond bounded recent outcomes, no auto-tuning, no client-side analytics scan.

Zero-trace: do not duplicate summary computation in the overlay; render only server-derived data.

## Test Strategy & Fixture Ownership

Coverage level: overlay component/browser tests. Owning suite: settings tests. Fixture strategy: `FakeEngineTransport` summary/link fixtures for empty, loading, error, linked, pending, ambiguous, and partial states. Dependency category: in-process fake transport. Isolation boundary: no real runner, no real X.

## Definition of Done

- Settings fetches summary on open and supports retry.
- Empty state renders when no predictions exist.
- Format learnings render with insufficient-data and enough-data messaging.
- Recent outcomes render `linked`, `pending_unlinked`, `ambiguous`, and `partial_actuals`.
- Manual link control calls `linkFeedbackPrediction`, handles errors, and refreshes summary on success.
- UI uses existing v2 primitives and design tokens.

## Acceptance Criteria

- Given an empty summary / When settings opens / Then the feedback section shows an empty state and no link controls.
- Given a populated summary with linked outcomes / When settings opens / Then format learnings and recent predicted-vs-actual deltas render.
- Given a pending outcome / When settings opens / Then it shows pending copy without claiming linked status.
- Given an ambiguous outcome / When settings opens / Then it shows `Multiple possible posts found` and requires explicit link.
- Given a user enters a platform post id for an ambiguous outcome / When linking succeeds / Then the row refreshes and shows `Linked manually` with the platform post id.
- Given linking fails validation / When the user submits / Then the row shows a retryable error and preserves the entered id.

## Visual AC

- Use `Skeleton` for loading, `Alert` for error/partial warnings, `EmptyState` for no predictions, `KeyValueList` for counts, `Badge` for status labels, and `Button`/`Input` for link actions.
- Keep the section dense and scannable; no nested cards.
- Long post ids/status URLs truncate without overflowing.
- Keyboard users can focus the link input, submit, retry, and refresh.
- Dynamic link success/failure uses `aria-live="polite"`.

## Edge Cases

- Summary request failure must not break the rest of settings.
- Ambiguous rows with multiple candidate ids do not auto-select.
- Invalid platform post ids reject before transport call when possible.
- Refresh after link may still return `partial_actuals` if actual impressions are not captured yet.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented settings feedback summary, status labels, format learnings, refresh, and manual post-id/status-URL linking.
