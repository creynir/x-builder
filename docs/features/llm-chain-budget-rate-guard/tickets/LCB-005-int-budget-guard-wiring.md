---
status: todo
---

# LCB-005: [INT] Verify budget and guard wiring

## User Flows to Verify

- Given the runner default transport wiring is used / When the page bindings are registered / Then all 20 current `ENGINE_TRANSPORT_BINDINGS` are still exposed.
- Given a guarded raw binding call is in flight / When an assembled `window.__xbTransport` LLM call reaches the same exposed handler set / Then both surfaces share the same guard state.
- Given `generateIdeas` is called with `format` through the runner binding / When budget or guard behavior rejects before LLM completion / Then fake LLM calls prove no unguarded extra work starts.
- Given `generateIdeas` or `applyJudgeSuggestions` exhausts its chain budget through the HTTP route / When the route responds / Then the public error code remains `generation_failed`.
- Given a format-generation candidate judge returns a chain-budget/request-timeout failure / When the route responds / Then the full request fails through `generation_failed`; given a non-timeout judge failure / When generation returns / Then only that candidate omits verdict/approved.
- Given non-LLM bindings are invoked under guard pressure / When they run / Then they still reach their services normally.

## Architectural Invariants

- The transport method count stays derived from the current `ENGINE_TRANSPORT_BINDINGS`; no older 17-method assumption is reintroduced.
- Raw `window.__xbuilder_*` and assembled `window.__xbTransport` calls cannot bypass the LLM binding guard.
- The guard is applied after request parsing and before service invocation.
- Generate/apply budget failures use the existing public route error contract instead of adding new public response shapes.
- Idea-only generation remains deterministic and unguarded.
- Generate fan-out treats chain-budget/request-timeout judge failures as chain-fatal while preserving candidate-local behavior for other judge failures.
- No shared transport schema changes are required for the guard or chain budget.

## Modules Under Test

- `GenerateIdeasService`
- `ApplyJudgeSuggestionsService`
- `JudgeDraftService`
- `buildServer`
- `ExposeFunctionTransport`
- `RunnerApp`
- `createBoundEngineServices`
- transport assembly helpers

## Test Strategy & Fixture Ownership

Coverage level: engine/runner integration tests.

Owning suites: engine server tests, engine LLM tests where cross-service behavior is already owned there, and runner transport integration tests.

Fixture strategy: temp settings roots, fake structured LLM prompt/timeout capture, fake judge outcomes, mock page binding registry, and existing runner fake service bundle helpers. Use explicit fake services and temp roots only.

Dependency category: in-process fakes and local-substitutable temp roots.

Isolation boundary: no real LLM provider, browser, live x.com, user settings directory, customer files, runtime database, network, or external services.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: RGB audit fix: mirrored generate fan-out timeout-vs-non-timeout invariant.
