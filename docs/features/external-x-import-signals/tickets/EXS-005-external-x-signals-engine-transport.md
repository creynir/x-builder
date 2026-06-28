---
status: done
---

# EXS-005: Extend EngineTransport and runner bindings

## Implementation Details

Add exactly four ExternalXSignals methods to the shared transport:

- `getExternalXSignalsOverview(request?)`
- `addExternalXSignalSource(request)`
- `removeExternalXSignalSource(request)`
- `refreshExternalXSignalSource(request)`

The transport surface grows from exactly 20 methods to exactly 24 methods. Update every count-coupled seam together: shared `EngineTransport`, `ENGINE_TRANSPORT_BINDINGS`, binding constants, runner `ExposeFunctionTransport`, runner `BoundEngineServices`, `createBoundEngineServices`, transport assembly, overlay `FakeEngineTransport`, and transport/binding tests.

No alias or fifth method is allowed. `getExternalXSignalsOverview` carries sources, totals, patterns, recent evidence, and refresh runs.

## Data Models

```ts
interface EngineTransport {
  getExternalXSignalsOverview(request?: GetExternalXSignalsOverviewRequest): Promise<GetExternalXSignalsOverviewResponse>;
  addExternalXSignalSource(request: AddExternalXSignalSourceRequest): Promise<AddExternalXSignalSourceResponse>;
  removeExternalXSignalSource(request: RemoveExternalXSignalSourceRequest): Promise<RemoveExternalXSignalSourceResponse>;
  refreshExternalXSignalSource(request: RefreshExternalXSignalSourceRequest): Promise<RefreshExternalXSignalSourceResponse>;
}
```

Bindings:

```ts
__xbuilder_getExternalXSignalsOverview
__xbuilder_addExternalXSignalSource
__xbuilder_removeExternalXSignalSource
__xbuilder_refreshExternalXSignalSource
```

`BoundEngineServices` exposes an `externalXSignalsService` group with handlers that call `ExternalXSignalsService`.

## Integration Point

Producer: shared transport registry and runner exposed functions.

Known consumers: `SettingsAffordance`, `ExternalXSignalsSettingsSection`, overlay tests through `FakeEngineTransport`, and E2E page-exposed transport.

User entry point: overlay settings interactions in EXS-007.

Terminal outcome: overlay code can call all four external-x-signals methods over the existing runner transport and invalid payloads reject before service calls.

## Scope Boundaries / Out of Scope

In scope: shared transport types/bindings, runner exposed handlers, bound service construction, fake transport defaults, transport assembly tests, and exact count tests.

Out of scope: no new UI, no runner observer ingest, no Fastify route changes, no service logic beyond calling EXS-003, no method aliases.

Zero-trace: stale names `registerExternalAccount`, `importExternalSignals`, `getExternalSignalsSummary`, and `getExternalSignalPatterns` must not exist.

## Test Strategy & Fixture Ownership

Coverage level: shared/runner/overlay transport tests. Owning suites: shared schema transport contract tests, runner expose-function tests, runner transport-engine integration tests, overlay fake transport tests. Fixture strategy: minimal schema-valid external-x-signals request/response fixtures. Dependency category: in-process transport fakes. Isolation boundary: no browser/network required for unit transport tests.

## Definition of Done

- `EngineTransport` has exactly 24 methods.
- `ENGINE_TRANSPORT_BINDINGS` has exactly 24 binding names.
- Runner exposes all 24 methods and validates external-x-signals request/response schemas.
- `FakeEngineTransport` implements all 24 methods.
- Tests reject stale method names and a separate `getExternalSignalPatterns` method.

## Acceptance Criteria

- Given the shared binding registry / When method names are enumerated / Then there are exactly 24 names and the four ExternalXSignals methods are present.
- Given a valid `addExternalXSignalSource` payload through runner transport / When the exposed handler runs / Then the bound external service receives the parsed request and the response is schema-validated.
- Given an invalid `refreshExternalXSignalSource` payload / When the exposed handler runs / Then the external service is not called.
- Given `FakeEngineTransport` with ExternalXSignals overrides / When overlay tests call methods detached from the instance / Then overrides run without unbound `this` failures.

## Edge Cases

- Optional `getExternalXSignalsOverview` arg can be absent or `{}`.
- Binding assembly is re-runnable on SPA navigation and still installs all 24 methods.
- No-op transport fallback includes all 24 methods.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented the four canonical ExternalXSignals transport methods, 24-name binding registry, runner schema-validated handlers, real bound service adapter, overlay fake/no-op coverage, and stale-alias negative assertions. Verification: shared schema tests; shared typecheck; shared build; engine build; runner transport unit/integration tests; runner typecheck; overlay `use-transport` Vitest; `git diff --check`; RGB gates from `2b5c27e`. Full overlay typecheck remains blocked by unrelated existing provenance/judge/generate-category fixture errors outside EXS scope.
