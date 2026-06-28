---
status: todo
---

# LLM Chain Budget / Rate Guard

## Architecture Context

This epic promotes the X Overlay Browser F1 follow-up into a dedicated local build. It closes two related risks:

- multi-call generate/apply chains currently have nominal `chainTimeoutMs` values but do not enforce a real wall-clock budget across every LLM call; and
- page-exposed LLM-spawning bindings are reachable from the x.com page context without a runner-side concurrency or rate guard.

The implementation is backend/runner only. It does not add UI, user-facing settings, shared transport schema changes, database migrations, hosted auth, or overlay error surfaces.

Current transport truth is the 20-method `EngineTransport`. Older X Overlay Browser docs mention 17 methods, but feedback-loop methods have since been added. This epic targets methods by behavior, not by binding count.

The engine change is a local LLM-layer deadline model. `GenerateIdeasService` and `ApplyJudgeSuggestionsService` remain the owners of chain ordering because they know which calls run sequentially and which run in fan-out. `JudgeDraftService` gains an additive internal options parameter so chain callers can bound judge calls while standalone judge behavior keeps its default timeout. The per-call enforcement path remains `StructuredLlmService` and the configured provider/process runner.

The runner change is a transport-boundary guard. `ExposeFunctionTransport` parses the request, decides whether a method is LLM-spawning for that invocation, acquires the in-memory guard, calls the bound service, validates the response, and releases the guard in `finally`. This protects both raw `window.__xbuilder_*` calls and the assembled `window.__xbTransport` methods because the assembled transport delegates to the raw bindings.

Guarded methods:

- `judgeDraft` - always guarded.
- `applyJudgeSuggestions` - always guarded.
- `generateIdeas` - guarded only when the parsed request has `format`; idea-only generation remains deterministic and unguarded.
- `suggestPost` - guarded because it is potentially LLM-spawning; exact insufficient-corpus fallback knowledge lives inside the service.

Explicitly unguarded examples:

- `getGenerateCategories`
- feedback-loop transport methods
- capture, settings, archive, cooldown, and deterministic analyze methods

## API Endpoints

- `POST /ideas/generate` - unchanged request/response. Format generation enforces a real chain budget and still maps chain failures to `generation_failed`.
- `POST /drafts/apply-suggestions` - unchanged request/response. Initial judge, rewrite, and re-judge all run under the same chain budget and still map chain failures to `generation_failed`.
- `POST /drafts/judge` - unchanged public behavior. Standalone judge keeps the default 180 second timeout and existing `judge_failed` behavior.
- Page bindings - unchanged method names and payload schemas. Guarded calls may reject with a runner-local binding guard error before service invocation.

## Component Breakdown

- `ChainDeadline` - engine-local LLM helper that owns wall-clock budget math.
- `ChainBudgetExceededError` - engine-local typed error for exhausted chain budget.
- `JudgeDraftOptions` - additive internal judge options, currently `timeoutMs`.
- `JudgeDraftService` - keeps standalone default timeout while accepting caller-provided per-call timeout for chain callers.
- `GenerateIdeasService` - uses one deadline over writer generation plus candidate judge fan-out, with per-call timeouts capped to the provider maximum.
- `ApplyJudgeSuggestionsService` - uses one deadline over initial judge, rewrite, and re-judge, with per-call timeouts capped to the provider maximum.
- `LlmBindingRateGuard` - runner-local guard with in-flight and rolling-start limits.
- `ExposeFunctionTransport` - owns parsed binding guard application for LLM-spawning methods.
- `RunnerApp` - uses the guarded transport wiring through the default binding path.

## Dependencies

- Existing `StructuredLlmService` timeout validation and provider/process timeout enforcement.
- Existing `JudgeDraftService`, `GenerateIdeasService`, and `ApplyJudgeSuggestionsService`.
- Existing `ExposeFunctionTransport`, `ENGINE_TRANSPORT_BINDINGS`, `RunnerApp`, and transport assembly.
- Existing Vitest service fakes, Fastify inject route tests, and runner mock-page binding tests.

No new runtime dependency is required.

## Sub-Tickets Overview

1. `LCB-001: [FND] Add chain deadline and judge timeout override`
2. `LCB-002: [FND] Add runner LLM binding guard`
3. `LCB-003: Enforce generate chain budget`
4. `LCB-004: Enforce apply chain budget`
5. `LCB-005: [INT] Verify budget and guard wiring`

## Validation Notes

- 2026-06-28: Arch recon research found the current issue in generate/apply chains and the current 20-method transport seam.
- 2026-06-28: System architecture selected engine-local deadlines plus runner-local binding guard.
- 2026-06-28: Architecture validator approved the sequence with no blockers.
