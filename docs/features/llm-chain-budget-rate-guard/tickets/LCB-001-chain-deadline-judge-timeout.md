---
status: done
---

# LCB-001: [FND] Add chain deadline and judge timeout override

## Implementation Details

Add an engine-local LLM deadline helper and an additive judge timeout override.

Introduce `ChainDeadline` and `ChainBudgetExceededError` in the engine LLM layer. The helper tracks `startedAt`, `budgetMs`, elapsed time, remaining time, and a minimum-remaining assertion.

Extend `JudgeDraft` and `JudgeDraftService.judge` to accept an optional `JudgeDraftOptions` object with `timeoutMs`. The standalone judge path must keep the existing default timeout when no options are supplied.

Do not change public judge request/response schemas, transport schemas, route signatures, or overlay code in this ticket.

## Data Models

```ts
interface ChainDeadline {
  readonly startedAt: number;
  readonly budgetMs: number;
  elapsedMs(): number;
  remainingMs(maxStepMs?: number): number;
  assertRemaining(minMs?: number): void;
}

class ChainBudgetExceededError extends Error {
  code: "chain_budget_exhausted";
  retryable: true;
  budgetMs: number;
  elapsedMs: number;
}

interface JudgeDraftOptions {
  timeoutMs?: number;
}
```

`remainingMs(maxStepMs?)` returns the positive remaining wall-clock budget, capped by `maxStepMs` when provided. `assertRemaining(minMs?)` throws `ChainBudgetExceededError` when less than the required minimum remains.

## Integration Point

Producer: the engine LLM layer.

Known consumers: `JudgeDraftService`, `GenerateIdeasService`, and `ApplyJudgeSuggestionsService`.

User entry point: unchanged standalone judge, generate, and apply routes/bindings.

Terminal outcome: standalone judge still uses the existing 180 second timeout; later generate/apply tickets can pass per-step remaining chain budget into judge calls.

## Scope Boundaries / Out of Scope

In scope: engine-local helper, typed chain-budget error, additive judge options, unit tests proving default and override timeout behavior.

Out of scope: no AbortSignal support, no shared schema edits, no public API edits, no UI/config setting, no generate/apply service rewiring beyond compile-safe signature updates needed for existing callers.

Zero-trace: do not add placeholder budget calls in generate/apply in this ticket. Those are owned by LCB-003 and LCB-004.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests.

Owning suite: engine LLM tests.

Fixture strategy: reuse the existing spy-backed judge LLM fake that records the `StructuredLlmRequest.options.timeoutMs`; add focused deadline helper tests with a deterministic clock or fake `now` provider if the implementation supports one.

Dependency category: in-process only.

Isolation boundary: no real LLM provider, child process, filesystem, database, runtime settings, browser, or network.

## Definition of Done

- `JudgeDraftService.judge` keeps the existing 180 second timeout when no options are supplied.
- `JudgeDraftService.judge` passes caller-provided `timeoutMs` to `StructuredLlmService` when supplied.
- `ChainDeadline` reports elapsed/remaining budget deterministically.
- `ChainDeadline.assertRemaining` throws a typed `chain_budget_exhausted` error when budget is exhausted.
- Existing judge route and runner bound-service callers compile unchanged or with only additive internal signature compatibility.

## Acceptance Criteria

- Given no judge options / When `JudgeDraftService.judge` calls the LLM gateway / Then the request uses the existing 180 second timeout.
- Given `JudgeDraftOptions.timeoutMs` / When `JudgeDraftService.judge` calls the LLM gateway / Then the request uses the supplied timeout.
- Given a chain deadline with budget remaining / When `remainingMs(maxStepMs)` is called / Then it returns the lesser of remaining wall-clock budget and `maxStepMs`.
- Given an expired chain deadline / When `assertRemaining()` is called / Then it throws `ChainBudgetExceededError` with code `chain_budget_exhausted` and retryable metadata.
- Given existing standalone judge route or binding callers / When the project typechecks / Then no public payload contract changes are required.

## Edge Cases

- A supplied timeout of zero or an invalid value should follow the existing `StructuredLlmService` validation path; this ticket does not create a second timeout validation system.
- Tiny chain budgets may immediately throw from `assertRemaining`; this is expected and must be typed.
- The helper must avoid negative returned timeout values.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: RGB pipeline started; ticket moved to in-progress.
- 2026-06-28: Red/Green completed; Blue, Yellow, and [FND] architecture checkpoint approved. Implemented in `d68f085`, `135d2c5`, and `0a03d53`.
