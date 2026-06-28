---
status: in-progress
---

# LCB-002: [FND] Add runner LLM binding guard

## Implementation Details

Add a runner-local guard around page-exposed LLM-spawning bindings.

Introduce `LlmBindingRateGuard`, `LlmBindingGuardPolicy`, `LlmBindingGuardError`, and guard predicates near the runner transport binding code. Wrap handlers inside `ExposeFunctionTransport` after request parsing and before service invocation.

Guarded methods:

- `judgeDraft`
- `applyJudgeSuggestions`
- `generateIdeas` only when the parsed request has `format`
- `suggestPost`

Unguarded methods include `getGenerateCategories`, feedback-loop methods, settings, archive, capture, cooldown, and deterministic analyze methods.

Default policy:

- `maxConcurrent: 1`
- `windowMs: 60_000`
- `maxStarts: 6`

The guard must release in a `finally` block after guarded service invocation.

## Data Models

```ts
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

The guard state is process-local and in-memory.

## Integration Point

Producer: `ExposeFunctionTransport` binding handlers.

Known consumers: raw `window.__xbuilder_*` calls, assembled `window.__xbTransport` calls, and `RunnerApp` default transport binding.

User entry point: the overlay or any page script invoking an exposed binding while the local runner is active.

Terminal outcome: guarded LLM-spawning calls either run normally or reject before service invocation with a typed guard error. Non-LLM bindings remain unaffected.

## Scope Boundaries / Out of Scope

In scope: runner-local guard, default policy, request-aware method predicate, handler wrapping, unit tests for guard acquisition/release, and registration count preservation.

Out of scope: no auth, no overlay UI error copy, no shared transport schema changes, no public settings, no persistence, no distributed throttling, no guard around deterministic-only bindings.

Zero-trace: do not add no-op policy hooks or future configuration placeholders that no caller uses.

## Test Strategy & Fixture Ownership

Coverage level: runner unit tests.

Owning suite: runner transport tests.

Fixture strategy: reuse the existing mock page and mock `BoundEngineServices`. Use never-resolving or manually controlled promises to hold one guarded call in flight. Use fake timers only if needed for the rolling window.

Dependency category: in-process only.

Isolation boundary: no real browser, live x.com page, real engine services, LLM provider, runtime settings, or network.

## Definition of Done

- Binding registration still registers all 20 current `ENGINE_TRANSPORT_BINDINGS`.
- Guarded calls reject when another guarded call is already in flight.
- Guarded calls reject when the rolling start limit is exceeded.
- Invalid request payloads fail schema parsing before consuming guard capacity.
- Service failures release guard capacity.
- `generateIdeas` idea-only requests bypass the guard.
- `getGenerateCategories` and feedback-loop bindings bypass the guard.

## Acceptance Criteria

- Given a `judgeDraft` binding call is in flight / When another guarded LLM binding is invoked / Then the second call rejects with `llm_binding_busy` and its service is not called.
- Given the rolling start limit is reached / When another guarded call starts within the same window / Then it rejects with `llm_binding_rate_limited` and includes a positive `retryAfterMs`.
- Given an invalid guarded request payload / When the exposed handler runs / Then schema parsing rejects and guard capacity is not consumed.
- Given a guarded service throws / When the handler settles / Then a later guarded call can acquire the guard.
- Given `generateIdeas` is called without `format` / When the handler runs / Then it bypasses the guard and calls the service.
- Given `getGenerateCategories` is called / When the handler runs / Then it bypasses the guard.

## Edge Cases

- `suggestPost` is guarded even though some corpus states return deterministic fallback, because the method is potentially LLM-spawning and the branch is internal to the service.
- Guard errors should not be parsed through a response schema; they are thrown before service output exists.
- Multiple raw binding names share one guard instance for the page binding set.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: RGB pipeline started; ticket moved to in-progress.
