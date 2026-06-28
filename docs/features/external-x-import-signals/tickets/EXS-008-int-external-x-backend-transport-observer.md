---
status: done
---

# EXS-008: [INT] Cover external X backend, transport, storage, and observer

## User Flows to Verify

- Given a temp engine database and a new external source / When the source is added, observed evidence is ingested, and overview is read through transport / Then the same source, totals, recent evidence, refresh runs, and patterns are visible through storage, service, route, and transport seams.
- Given registered external-source fixture responses and both runner capture observers attached / When the responses are emitted / Then external evidence is written only to the external ledger and the own-post repository is not called or written.
- Given duplicate observed evidence / When it is ingested twice through the observer path / Then overview counts dedupe and refresh/evidence records remain consistent.
- Given a removed source / When overview is read through transport / Then removed source evidence is preserved but excluded from active source rows by default.

## Architectural Invariants

- External evidence never writes to `PostLibraryRepository.upsertPosts`, `post`, `metric_obs`, or own-post source refs.
- Transport exposes exactly 24 methods and the four ExternalXSignals names are the only external-signal transport methods.
- Route, transport, and service responses use the same shared schemas.
- Observer ingestion is observe-only and source-gated.
- Pattern rows are server-derived from external evidence, persisted with evidence links, and not client-computed fixtures.

## Modules Under Test

- `openEngineDatabase`
- `SqliteExternalXSignalsRepository`
- persisted external pattern/evidence-link rows
- `ExternalXSignalsService`
- ExternalXSignals Fastify routes
- `ENGINE_TRANSPORT_BINDINGS`
- `ExposeFunctionTransport`
- `createBoundEngineServices`
- `ExternalXSignalsCaptureObserver`
- existing own-post `GraphQlCaptureObserver` control path
- runner transport assembly

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon. Validator concern included: integration tests must prove external observations cannot leak through the existing own-post live-capture path.
- 2026-06-28: RGB ticket audit update: persisted pattern snapshots and evidence links are explicit integration invariants.
- 2026-06-28: Added backend integration coverage for Fastify route -> ExternalXSignalsService -> SQLite storage, dedupe/no-new-evidence behavior, removed-source defaults, own-post table isolation, and persisted pattern evidence links.
- 2026-06-28: Added runner integration coverage for exact transport method set, bound transport add/overview/remove, observer source gating, duplicate observer response stability, and own-post capture isolation.
- 2026-06-28: Verification: engine external-X suites (17 passed), runner external-X/transport suites (28 passed), engine typecheck, runner typecheck.
