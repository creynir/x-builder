---
status: done
---

# EXS-003: Build ExternalXSignalsService

## Implementation Details

Implement `ExternalXSignalsService` over `ExternalXSignalsRepository`. The service owns add/remove/refresh/overview behavior, deterministic pattern aggregation and persistence, and observed timeline ingestion. It consumes only the shared EXS-001 contracts and the EXS-002 repository.

Refresh is observe-only. `refreshSource` records a refresh attempt and reconciles already-observed evidence; it must not navigate, craft X requests, call X APIs, auto-scroll, or infer missing evidence.

Expose a narrow `ingestObservedTimeline` method for the runner observer. Registered sources gate ingestion; unmatched observed batches are skipped fail-closed.

## Data Models

Use shared request/response types from EXS-001. Internal read models may be narrower but must map back to:

```ts
ExternalXSignalSource
ExternalXSignalEvidence
ExternalXSignalRefreshRun
ExternalXSignalPattern
GetExternalXSignalsOverviewResponse
```

Patterns include `patternType`, label, statement, confidence, support count, source ids, evidence ids/previews, generated timestamp, and version. Pattern aggregation uses deterministic evidence only, persists snapshots with evidence links, and returns bounded rows.

## Integration Point

Producer: `ExternalXSignalsService`.

Known consumers: Fastify routes, runner transport bindings, `ExternalXSignalsCaptureObserver`, and integration tests.

User entry point: later tickets expose add/remove/refresh/overview from the overlay settings panel.

Terminal outcome: callers can manage external sources, ingest observed evidence, and read server-derived external patterns without touching own-post corpus.

## Scope Boundaries / Out of Scope

In scope: service methods `addSource`, `removeSource`, `refreshSource`, `getOverview`, `ingestObservedTimeline`, deterministic totals, and deterministic pattern aggregation/persistence.

Out of scope: no Fastify route registration, `EngineTransport`, runner observer attach, overlay UI, vector search, model auto-tuning, cloud sync, active X requests, or writes to own-post tables.

Zero-trace: do not add compatibility wrappers for old names or generic `ExternalSignalsService` aliases.

## Test Strategy & Fixture Ownership

Coverage level: engine service unit tests. Owning suite: engine external signals service tests. Fixture strategy: in-memory repository or temp SQLite repository with deterministic ids/timestamps and small evidence batches. Dependency category: in-process repository. Isolation boundary: no real browser, x.com, network, user settings root, or own post repository.

## Definition of Done

- `addSource` normalizes handles and returns existing source for duplicates.
- `removeSource` soft-removes sources and excludes them from default overview.
- `ingestObservedTimeline` persists only registered-source evidence.
- `refreshSource` returns pending/no-observation/captured states without active X operations.
- `getOverview` returns bounded sources, totals, patterns, recent evidence, and refresh runs.
- Patterns are derived only from external evidence.
- Pattern snapshots are persisted with evidence refs and read back through overview.

## Acceptance Criteria

- Given a new handle / When `addSource` runs / Then overview includes one active source.
- Given an existing handle with different case or leading `@` / When `addSource` runs / Then the existing source is returned and no duplicate is created.
- Given a registered source and observed evidence / When `ingestObservedTimeline` runs / Then evidence and refresh totals are reflected in overview.
- Given an unregistered observed batch / When `ingestObservedTimeline` runs / Then no evidence is persisted.
- Given a source with no observed evidence / When `refreshSource` runs / Then a waiting or no-observation refresh run is recorded rather than fabricated evidence.
- Given enough external evidence / When refresh or ingestion derives patterns / Then persisted patterns include confidence, support count, and capped evidence refs/previews in overview.

## Edge Cases

- Refreshing a removed source fails with a typed external-x-signals error.
- Partial metrics still persist evidence and produce lower-confidence patterns.
- Duplicate observed batches dedupe.
- A single viral outlier cannot become a high-confidence pattern without support count.

## Pipeline Log

- 2026-06-28: Implemented `ExternalXSignalsService`, source-gated observed ingestion, honest refresh runs, and persisted deterministic patterns. Verification: service/repository tests, engine typecheck, and `gates.py all --base b8a9111` passed.
- 2026-06-28: Ticket authored from approved arch recon.
