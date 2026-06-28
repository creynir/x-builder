---
status: done
---

# EXS-004: Add ExternalXSignals Fastify routes

## Implementation Details

Add Fastify routes over `ExternalXSignalsService` using shared request/response schemas. Route handlers parse inputs at the boundary, call only the service, parse responses before returning, and map service/storage failures to external-x-signals API errors.

Canonical routes:

- `GET /external-x/signals/overview`
- `POST /external-x/signals/sources`
- `DELETE /external-x/signals/sources/:sourceId`
- `POST /external-x/signals/sources/:sourceId/refresh`

## Data Models

Route request and response bodies use EXS-001 shared schemas:

```ts
GetExternalXSignalsOverviewRequest
GetExternalXSignalsOverviewResponse
AddExternalXSignalSourceRequest
AddExternalXSignalSourceResponse
RemoveExternalXSignalSourceRequest
RemoveExternalXSignalSourceResponse
RefreshExternalXSignalSourceRequest
RefreshExternalXSignalSourceResponse
```

`DELETE /external-x/signals/sources/:sourceId` maps the path param into `RemoveExternalXSignalSourceRequest`. `POST /external-x/signals/sources/:sourceId/refresh` maps the path param into `RefreshExternalXSignalSourceRequest` and accepts any optional body fields the shared schema defines.

## Integration Point

Producer: Fastify external-x-signals route handlers.

Known consumers: local HTTP tests and future callers; `EngineTransport` in EXS-005 uses the same service directly through runner bindings.

User entry point: the overlay reaches the behavior through transport; HTTP routes provide local API parity.

Terminal outcome: local API callers receive schema-valid external-x-signals responses and typed errors.

## Scope Boundaries / Out of Scope

In scope: route registration, service injection/construction, request/response parsing, error mapping, and route tests.

Out of scope: no transport binding, runner observer, overlay UI, repository schema changes, or client-side behavior.

Zero-trace: no duplicate route names, no stale `/external/accounts/*` or `/external/signals/*` paths, no route aliases.

## Test Strategy & Fixture Ownership

Coverage level: engine route tests. Owning suite: Fastify server tests. Fixture strategy: fake or temp `ExternalXSignalsService` with schema-valid responses and rejection cases. Dependency category: in-process Fastify inject. Isolation boundary: no network port, browser, real x.com, user settings root, or customer database.

## Definition of Done

- All four canonical routes are registered.
- Routes validate request and response schemas.
- Validation failures reject before service calls.
- Service/storage failures map to external-x-signals API errors.
- Stale route paths are absent from tests and implementation.

## Acceptance Criteria

- Given a valid add-source body / When `POST /external-x/signals/sources` is injected / Then `ExternalXSignalsService.addSource` receives the parsed request and the response is schema-valid.
- Given invalid add-source input / When the route is injected / Then the service is not called.
- Given a valid source id / When `DELETE /external-x/signals/sources/:sourceId` is injected / Then the remove response is schema-valid.
- Given a valid source id / When `POST /external-x/signals/sources/:sourceId/refresh` is injected / Then a refresh run response is returned.
- Given an overview query / When `GET /external-x/signals/overview` is injected / Then bounded overview data is returned.

## Edge Cases

- Missing `sourceId` rejects.
- Removed source refresh returns a typed error.
- Storage failure does not expose stack traces in the user-facing response.
- Empty overview returns empty arrays and zero totals.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented canonical Fastify routes with storage-backed default service wiring and route-level query coercion. Verification: `./node_modules/.bin/vitest run src/server/tests/external-x-signals-routes.test.ts`; `./node_modules/.bin/tsc -p tsconfig.json --noEmit`; `git diff --check`; `python3 /Users/michael/.codex/skills/rgb-tdd/scripts/gates.py all --base 5842e0e`.
