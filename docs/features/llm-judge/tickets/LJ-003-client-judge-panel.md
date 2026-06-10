# LJ-003: [FE] Client Judge Panel

## Goal

Let the user judge the current draft from the Studio route with one button and see
the verdict in a standalone panel, with graceful handling when Codex is unavailable.

## In Scope

- `EngineApiClient.judgeDraft(text)` in `client/src/api/engine-api-client.ts`:
  POST `/drafts/judge`, parse with `judgeDraftResponseSchema`, normalize errors to
  `ApiError` like the existing methods.
- A "Judge draft" button on the writer route and a `JudgePanel` component that
  renders `rating`, `headline`, `strengths`, and `improvements`.
- Button enablement gated on a non-empty trimmed draft AND
  `status.codex.state === "ready"` (from the existing app status); show a short
  hint when disabled because Codex is unavailable.
- Loading state while the request is in flight; error state rendering the
  `judge_failed` message with a retry affordance.

## Out Of Scope

- Auto-run after generation / wiring the `runCodexJudgeAfterGeneration` setting.
- Changing the deterministic Draft Review or Engagement Prediction panels.
- Persisting verdicts.

## Requirements

- The judge request is fire-on-click only; no debounce/auto-trigger.
- An in-flight request must not leak state after unmount (use the same
  cancellation discipline as the status/settings effects).
- The panel is purely presentational of the verdict; no business logic.
- Types come from `@x-builder/shared` (`JudgeVerdict`, `JudgeDraftResponse`).
- No raw error internals are shown — only the normalized `ApiError.message`.

## Integration Point

- Producer: `EngineApiClient.judgeDraft`.
- Consumer: writer route / `JudgePanel`.
- User entry point: the "Judge draft" button on the Studio route.
- Terminal outcome: verdict panel rendered, or an inline error with retry.

## Acceptance Criteria

- Clicking "Judge draft" with a non-empty draft calls `judgeDraft` and renders the
  returned rating, headline, strengths, and improvements.
- The button is disabled with a hint when the draft is empty or when
  `status.codex.state` is not `ready`.
- A `judge_failed` response renders the error message and a retry control; a retry
  re-issues the request.
- Tests import the real modules and assert rendered output / disabled state.

## Test Strategy

- Suite: client Vitest (SSR string render harness, consistent with existing tests).
- Fixtures: a fake api client returning a verdict, a failure, and a ready/unready
  status.
- Dependency category: in-process fakes; no network.

## Dependencies

- LJ-001 (shared types), LJ-002 (route).
