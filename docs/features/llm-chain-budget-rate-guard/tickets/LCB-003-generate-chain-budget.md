---
status: todo
---

# LCB-003: Enforce generate chain budget

## Implementation Details

Wire the engine deadline from LCB-001 into `GenerateIdeasService`.

On the by-format generation path, create a single chain deadline. Use remaining budget for the writer generation call, capped by the existing per-call provider maximum accepted by `StructuredLlmService`. Then compute one remaining judge timeout before launching the three candidate judges, also capped by that same per-call maximum. Pass the same capped remaining timeout to all three judge calls in the fan-out.

The idea-only path must stay deterministic and must not create a deadline, touch the LLM, or invoke the judge.

Budget exhaustion in the format path is chain-fatal and must map through the existing `generation_failed` contract for the HTTP route. A judge timeout caused by the chain budget is also chain-fatal. Other individual judge failures remain candidate-local and only omit verdict/approved for that candidate.

Do not change candidate response schema, candidate count, guidance resolution, or derive-approved behavior.

## Data Models

No public schema changes.

Internal contracts consumed:

```ts
type GenerateIdeaRequest = {
  idea?: string;
  format?: DetectedPostFormat;
  voiceProfileId?: string;
  useKnownPostIds?: string[];
};

type JudgeDraftOptions = {
  timeoutMs?: number;
};
```

Generated response shape remains unchanged.

## Integration Point

Producer: `GenerateIdeasService`.

Known consumers: `POST /ideas/generate`, runner `generateIdeas` binding, and overlay compose generate rail.

User entry point: clicking a format generate action in the overlay, or calling the existing generate HTTP endpoint.

Terminal outcome: format generation either returns exactly three candidates with best-effort judge verdicts inside the chain budget, or fails through the existing `generation_failed` error contract.

## Scope Boundaries / Out of Scope

In scope: format-path chain deadline creation, writer timeout from remaining budget, judge fan-out timeout propagation, budget-exhaustion mapping to the existing generate error path, and tests for idea-only non-regression.

Out of scope: no shared schema changes, no overlay UI changes, no new guidance behavior, no candidate count changes, no response-field changes, no deterministic idea-only rewrite, no standalone judge route behavior changes.

Zero-trace: do not add placeholder retries, fallbacks, or partial budget metrics for future observability.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests plus route-level coverage for the public error contract.

Owning suites: engine LLM tests and existing generate route tests.

Fixture strategy: reuse spy-backed structured LLM fakes, fake judge outcomes, and Fastify `inject` route harness patterns. Tests should inspect request options passed to fakes rather than use real timers or real LLM providers.

Dependency category: in-process and local-substitutable fakes only.

Isolation boundary: no real provider, child process, browser, live x.com, runtime settings, customer files, or network.

## Definition of Done

- Format generation writer call receives a timeout from the chain deadline capped at the existing `StructuredLlmService` per-call maximum.
- All three fan-out judge calls receive the same remaining timeout value capped at the existing `StructuredLlmService` per-call maximum.
- Chain budget exhaustion in format generation is fatal and maps to `generation_failed` through the existing route contract.
- Chain-budget/request-timeout judge outcomes during fan-out are fatal for the whole format-generation request.
- Non-timeout judge failures still omit verdict/approved for only the failed candidate when budget remains.
- Idea-only generation remains deterministic and does not invoke guidance, LLM, judge, or deadline behavior.

## Acceptance Criteria

- Given a format generation request / When the writer LLM call is made / Then its timeout is bounded by the chain deadline.
- Given remaining chain budget exceeds the provider per-call maximum / When writer or judge calls are made / Then each per-call timeout is capped to the provider maximum instead of exceeding it.
- Given the writer call succeeds and budget remains / When candidate judges launch / Then all three judge calls receive the same capped remaining timeout.
- Given the chain budget is exhausted before judge fan-out / When generation continues / Then generation fails through `generation_failed`.
- Given a candidate judge returns a chain-budget/request-timeout failure / When generation handles fan-out results / Then the full format-generation request fails through `generation_failed`.
- Given one candidate judge returns a non-budget failure while budget remains / When generation returns / Then the response still has three candidates and only successful judge verdicts are attached.
- Given an idea-only request without `format` / When generation runs / Then no LLM, judge, guidance, or deadline path is used.

## Edge Cases

- A very small chain budget may fail before any judge call; this is correct.
- Profile resolver failures still collapse to profile-less judging as today.
- Guidance resolver failures still collapse to base prompt as today.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: RGB audit fix: specified provider per-call timeout cap and chain-timeout fan-out failure behavior.
