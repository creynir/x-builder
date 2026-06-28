# LLM Chain Budget / Rate Guard - Architecture Report

Validation outcome: APPROVE.

## Decision

Build two bounded pieces:

- an engine-local chain deadline for multi-call LLM flows; and
- a runner-local guard around page-exposed LLM-spawning bindings.

Do not change shared request/response schemas. Do not add UI, user-configurable settings, auth, or overlay error handling in this epic.

## Research Findings

Current `GenerateIdeasService` defines a nominal chain timeout but only applies it to the initial writer generation call. Candidate judge fan-out runs through `JudgeDraftService`, whose standalone timeout is 180 seconds.

Current `ApplyJudgeSuggestionsService` applies a timeout only to the rewrite call. The initial judge and re-judge legs also run through the standalone judge timeout.

`StructuredLlmService` already validates per-call timeout options, and provider/process layers already enforce them. The missing piece is chain ownership: generate/apply must pass remaining budget into every LLM call they orchestrate.

Current `EngineTransport` has 20 methods. The LLM-spawning page binding set is behavioral, not count-based: `judgeDraft`, `applyJudgeSuggestions`, `generateIdeas` when a `format` is present, and potentially `suggestPost`.

`ExposeFunctionTransport` is the right page-boundary guard location because it validates requests before service invocation and sits behind both raw `window.__xbuilder_*` calls and assembled `window.__xbTransport` calls.

## Target Components

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

type LlmBindingMethod =
  | "judgeDraft"
  | "generateIdeas"
  | "suggestPost"
  | "applyJudgeSuggestions";

interface LlmBindingGuardPolicy {
  maxConcurrent: number;
  windowMs: number;
  maxStarts: number;
}

class LlmBindingGuardError extends Error {
  code: "llm_binding_busy" | "llm_binding_rate_limited";
  scope: "llm_binding_guard";
  retryable: true;
  retryAfterMs: number;
  method: LlmBindingMethod;
}
```

## Data Flow

Format generation:

1. Parse `GenerateIdeaRequest`.
2. If no `format`, use existing deterministic idea-only path with no deadline or guard.
3. If `format` exists, create one chain deadline.
4. Resolve provider, guidance, and account profile as today.
5. Run the writer generation call with a bounded timeout from the deadline, capped by the existing per-call provider maximum.
6. Compute one remaining judge timeout before the three-candidate fan-out, capped by the existing per-call provider maximum.
7. Run the three judges with the same remaining timeout.
8. Budget exhaustion and chain-budget/request-timeout judge failures are chain-fatal and map through the existing `generation_failed` route contract.

Apply suggestions:

1. Parse `ApplyJudgeSuggestionsRequest`.
2. Create one chain deadline.
3. Run original judge with remaining timeout capped by the existing per-call provider maximum.
4. Run rewrite with remaining timeout capped by the existing per-call provider maximum.
5. Run re-judge with remaining timeout capped by the existing per-call provider maximum.
6. Apply the existing never-worse guard.
7. Budget exhaustion is chain-fatal and maps through the existing `generation_failed` route contract.

Runner binding:

1. Page script calls raw binding or assembled transport method.
2. `ExposeFunctionTransport` parses the request.
3. Transport evaluates the LLM-spawning predicate for the parsed request.
4. Guard either acquires or rejects with typed guard error.
5. Bound service runs and response is schema-validated.
6. Guard releases in `finally`.

## Ticket Sequence

1. `LCB-001 [FND]` creates the internal deadline and judge timeout override.
2. `LCB-002 [FND]` creates the runner guard and wraps parsed binding handlers.
3. `LCB-003` wires generate format chains to the deadline.
4. `LCB-004` wires apply chains to the deadline.
5. `LCB-005 [INT]` verifies cross-module HTTP, runner, raw binding, and assembled transport behavior.

Docs and E2E tickets are intentionally omitted. This epic changes backend/runner behavior with no user-facing UI, no public schema change, and no docs surface beyond these implementation tickets. The local ticket contract requires at least one `[INT]` or `[E2E]`; `LCB-005` satisfies that requirement.

## Residual Process Risk

The RGB skill references `scripts/gates.py`, but this checkout does not currently contain that script. This run must use repo-native deterministic checks (`pnpm test`, package-level Vitest, `pnpm typecheck`, `pnpm lint`) plus targeted git diff review in place of that gate script.
