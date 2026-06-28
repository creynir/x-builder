---
status: done
---

# EXS-001: [FND] Define ExternalXSignals shared contracts

## Implementation Details

Add shared `ExternalXSignals` schemas, exported types, and API errors. The canonical transport vocabulary is exactly:

- `getExternalXSignalsOverview(request?)`
- `addExternalXSignalSource(request)`
- `removeExternalXSignalSource(request)`
- `refreshExternalXSignalSource(request)`

Do not add storage, Fastify routes, runner bindings, observers, or UI in this ticket.

## Data Models

Define Zod schemas and exported types for:

```ts
type ExternalXSignalSourceStatus = "active" | "removed" | "waiting_for_observation" | "refresh_failed";
type ExternalXSignalEvidenceSource = "external_x_graphql_observe" | "external_fixture_import";
type ExternalXSignalPatternType = "format" | "hook" | "cadence" | "entity_mix" | "engagement_outlier";
```

Required schema/type pairs:

- `externalXSignalSourceSchema` / `ExternalXSignalSource`
- `externalXSignalEvidenceSchema` / `ExternalXSignalEvidence`
- `externalXSignalMetricSnapshotSchema` / `ExternalXSignalMetricSnapshot`
- `externalXSignalRefreshRunSchema` / `ExternalXSignalRefreshRun`
- `externalXSignalPatternSchema` / `ExternalXSignalPattern`
- `externalXSignalsTotalsSchema` / `ExternalXSignalsTotals`
- `getExternalXSignalsOverviewRequestSchema` / `GetExternalXSignalsOverviewRequest`
- `getExternalXSignalsOverviewResponseSchema` / `GetExternalXSignalsOverviewResponse`
- `addExternalXSignalSourceRequestSchema` / `AddExternalXSignalSourceRequest`
- `addExternalXSignalSourceResponseSchema` / `AddExternalXSignalSourceResponse`
- `removeExternalXSignalSourceRequestSchema` / `RemoveExternalXSignalSourceRequest`
- `removeExternalXSignalSourceResponseSchema` / `RemoveExternalXSignalSourceResponse`
- `refreshExternalXSignalSourceRequestSchema` / `RefreshExternalXSignalSourceRequest`
- `refreshExternalXSignalSourceResponseSchema` / `RefreshExternalXSignalSourceResponse`

`GetExternalXSignalsOverviewResponse` contains `sources`, `totals`, `patterns`, `recentEvidence`, and `refreshRuns`. IDs that come from X remain strings. Metrics are optional and non-negative. Overview request limits are bounded.

Add API error scope `external-x-signals` and error codes for add, remove, refresh, and overview failures.

## Integration Point

Producer: shared external-x-signals schema module and shared barrel exports.

Known consumers: `SqliteExternalXSignalsRepository`, `ExternalXSignalsService`, Fastify routes, `EngineTransport`, runner bindings, `ExternalXSignalsCaptureObserver`, `FakeEngineTransport`, and `ExternalXSignalsSettingsSection`.

User entry point: later tickets expose the contracts through the existing overlay settings panel.

Terminal outcome: every downstream layer uses one schema-first contract and stale generic names cannot compile.

## Scope Boundaries / Out of Scope

In scope: shared schemas, types, exports, API error codes/scope, and schema tests.

Out of scope: no migration, repository, service, route, transport binding, observer, or UI.

Zero-trace: do not add placeholder service methods, unused transport methods, aliases, or generic `ExternalSignals` names.

## Test Strategy & Fixture Ownership

Coverage level: shared schema unit tests. Owning suite: shared schema tests. Fixture strategy: minimal valid source/evidence/pattern/overview/add/remove/refresh fixtures plus invalid variants for bad handles, empty text, negative metrics, bad status names, stale method names, and too-large limits. Dependency category: in-process only. Isolation boundary: no filesystem, SQLite, browser, or network.

## Definition of Done

- All listed schemas parse valid payloads and reject invalid payloads.
- API errors parse with scope `external-x-signals`.
- Overview response includes sources, totals, patterns, recent evidence, and refresh runs.
- Shared barrel exports schemas and types.
- Stale names such as `registerExternalAccount`, `importExternalSignals`, `getExternalSignalsSummary`, and `getExternalSignalPatterns` are absent.

## Acceptance Criteria

- Given a valid `@external_builder` source payload / When add request parsing runs / Then the payload is accepted and the normalized screen name is represented without the leading `@`.
- Given a source payload with whitespace-only screen name / When add request parsing runs / Then parsing rejects it.
- Given an evidence payload with Snowflake-like IDs / When parsing runs / Then IDs remain strings and are not coerced to numbers.
- Given an overview response with `sources`, `totals`, `patterns`, `recentEvidence`, and `refreshRuns` / When parsing runs / Then all sections are preserved.
- Given an external-x-signals API error / When parsing runs / Then scope `external-x-signals` is accepted.

## Edge Cases

- Duplicate handles are allowed at the schema layer only as payloads; repository/service owns dedupe behavior.
- Optional metrics can be absent but cannot be negative.
- Text previews are capped and non-empty.
- Overview request `{}` uses defaults.

## Pipeline Log

- 2026-06-28: Implemented shared ExternalXSignals schemas, API error scope/codes, barrel exports, and schema tests. Verification: `corepack pnpm --dir shared test -- external-x-signals.test.ts`, `corepack pnpm --dir shared typecheck`, and `gates.py all --base 7cef05d` passed.
- 2026-06-28: Ticket authored from approved arch recon.
