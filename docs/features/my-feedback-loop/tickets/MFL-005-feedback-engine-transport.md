---
status: done
---

# MFL-005: Extend EngineTransport and runner bindings

## Implementation Details

Add exactly three feedback methods to the shared transport:

- `recordFeedbackPrediction(request)`
- `linkFeedbackPrediction(request)`
- `getFeedbackLoopSummary(request?)`

The transport surface grows from exactly 17 methods to exactly 20 methods. Update every count-coupled binding seam together: shared `EngineTransport`, `ENGINE_TRANSPORT_BINDINGS`, runner `ExposeFunctionTransport`, runner `BoundEngineServices`, `createBoundEngineServices`, transport assembly, overlay `FakeEngineTransport`, and transport/binding tests.

Do not use stale names `getFeedbackLoop` or `recordPrediction`.

## Data Models

```ts
interface EngineTransport {
  recordFeedbackPrediction(request: RecordFeedbackPredictionRequest): Promise<RecordFeedbackPredictionResponse>;
  linkFeedbackPrediction(request: LinkFeedbackPredictionRequest): Promise<LinkFeedbackPredictionResponse>;
  getFeedbackLoopSummary(request?: GetFeedbackLoopSummaryRequest): Promise<GetFeedbackLoopSummaryResponse>;
}
```

`BoundEngineServices` must expose a feedback service group with matching handlers that call `FeedbackLoopService`.

## Integration Point

Producer: shared transport registry and runner exposed functions.

Known consumers: `ComposeCockpit`, `SettingsAffordance`, `SettingsPanel`, and overlay tests through `FakeEngineTransport`.

User entry point: overlay compose/settings interactions in later tickets.

Terminal outcome: overlay code can call all feedback methods over the existing runner transport and bad request payloads reject before service calls.

## Scope Boundaries / Out of Scope

In scope: shared transport types/bindings, runner exposed handlers, bound service construction, fake transport defaults, transport assembly tests, exact count tests.

Out of scope: no new UI, no service logic beyond calling MFL-003, no route logic beyond consuming MFL-004, no method aliases.

Zero-trace: remove any temporary or stale method names and do not leave compatibility wrappers.

## Test Strategy & Fixture Ownership

Coverage level: shared/runner/overlay transport tests. Owning suites: shared schema transport contract tests, runner expose-function tests, runner transport-engine integration tests, overlay fake transport tests. Fixture strategy: minimal schema-valid feedback request/response fixtures. Dependency category: in-process transport fakes. Isolation boundary: no browser/network required for unit transport tests.

## Definition of Done

- `EngineTransport` has exactly 20 methods.
- `ENGINE_TRANSPORT_BINDINGS` has exactly 20 binding names.
- Runner exposes all 20 methods and validates feedback request/response schemas.
- `FakeEngineTransport` implements all 20 methods.
- Tests reject stale `getFeedbackLoop` and `recordPrediction` names.

## Acceptance Criteria

- Given the shared binding registry / When method names are enumerated / Then there are exactly 20 names and the three feedback methods are present.
- Given a valid `recordFeedbackPrediction` payload through runner transport / When the exposed handler runs / Then the bound feedback service receives the parsed request and the response is schema-validated.
- Given an invalid `linkFeedbackPrediction` payload / When the exposed handler runs / Then the feedback service is not called.
- Given `FakeEngineTransport` with feedback overrides / When overlay tests call feedback methods detached from the instance / Then overrides run without unbound `this` failures.

## Edge Cases

- Optional `getFeedbackLoopSummary` arg can be absent or `{}`.
- Binding assembly is re-runnable on SPA navigation and still installs all 20 methods.
- No-op transport fallback includes all 20 methods.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented the three feedback transport methods across shared contracts, runner bindings, overlay transport, fake transport, and binding tests.
