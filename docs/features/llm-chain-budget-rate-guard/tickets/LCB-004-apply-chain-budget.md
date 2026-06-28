---
status: done
---

# LCB-004: Enforce apply chain budget

## Implementation Details

Wire the engine deadline from LCB-001 into `ApplyJudgeSuggestionsService`.

Create one chain deadline for the apply flow. Bound all three LLM legs with the deadline:

1. original judge;
2. rewrite; and
3. re-judge.

Each step must ask the deadline for remaining budget immediately before invocation. Any budget exhaustion or failed step remains chain-fatal and maps through the existing `generation_failed` contract for the HTTP route.

The existing never-worse guard remains unchanged: when re-judge succeeds but the rewrite score is not better than the original, return the original text and original verdict with `improvedOverOriginal: false`.

## Data Models

No public schema changes.

Internal contracts consumed:

```ts
type ApplyJudgeSuggestionsRequest = {
  text: string;
};

type ApplyJudgeSuggestionsResponse = {
  text: string;
  verdict: JudgeVerdict;
  approved: boolean;
  improvedOverOriginal: boolean;
};

type JudgeDraftOptions = {
  timeoutMs?: number;
};
```

## Integration Point

Producer: `ApplyJudgeSuggestionsService`.

Known consumers: `POST /drafts/apply-suggestions`, runner `applyJudgeSuggestions` binding, and overlay judge strip apply-all action.

User entry point: clicking Apply all suggestions in the overlay, or calling the existing apply-suggestions HTTP endpoint.

Terminal outcome: apply either returns a never-worse checked result inside the chain budget, or fails through the existing `generation_failed` error contract.

## Scope Boundaries / Out of Scope

In scope: one deadline over original judge, rewrite, and re-judge; per-step timeout propagation; fatal budget exhaustion; route error-contract preservation; never-worse non-regression.

Out of scope: no standalone judge route behavior changes, no overlay cancellation work, no edit-while-applying behavior, no shared schema changes, no UI error copy, no rewrite prompt changes except what is required for timeout wiring.

Zero-trace: do not add abort/cancel placeholders or UI-state interfaces for cancellation in this ticket.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests plus route-level coverage for the public error contract.

Owning suites: engine LLM tests and existing apply route tests.

Fixture strategy: reuse per-step fake judge and rewrite LLM helpers. Inspect per-call timeout options passed to judge and rewrite fakes. Use route injection for public error mapping.

Dependency category: in-process and local-substitutable fakes only.

Isolation boundary: no real provider, child process, browser, live x.com, runtime settings, customer files, database, or network.

## Definition of Done

- Original judge receives a timeout derived from remaining chain budget.
- Rewrite receives a timeout derived from remaining chain budget.
- Re-judge receives a timeout derived from remaining chain budget.
- Budget exhaustion before any step fails the chain through the existing apply error path.
- Never-worse guard still returns the original text and original verdict when rewrite score is not better.
- Profile resolver failure still falls back to profile-less judge behavior.

## Acceptance Criteria

- Given an apply request / When the original judge runs / Then it receives a timeout from the chain deadline.
- Given original judge succeeds / When rewrite runs / Then it receives a timeout from the remaining chain budget.
- Given rewrite succeeds / When re-judge runs / Then it receives a timeout from the remaining chain budget.
- Given the chain budget is exhausted before re-judge / When apply continues / Then apply fails through `generation_failed`.
- Given re-judge scores the rewrite no better than the original / When apply returns / Then the original text and original verdict are returned with `improvedOverOriginal: false`.
- Given the account profile resolver throws / When apply runs / Then the chain continues with an undefined profile as today.

## Edge Cases

- Tiny budgets can fail before rewrite or re-judge; this is expected and must be typed.
- Failed original judge remains fatal.
- Failed re-judge remains fatal; the service must not return a rewrite whose quality is unknown.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: RGB pipeline started; ticket moved to in-progress.
- 2026-06-28: Red coverage added in e773672 and tightened in 7752a3c for per-step apply timeout propagation and exhausted-budget failure.
- 2026-06-28: Green implementation completed in 3530167, enforcing one chain deadline across original judge, rewrite, and re-judge.
- 2026-06-28: Hardening coverage added in a1a14e0 for exhaustion before the original judge.
- 2026-06-28: Blue and Yellow reviews approved; focused apply tests and engine typecheck passed.
- 2026-06-28: Ticket completed.
