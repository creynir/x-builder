---
status: done
---

# EXS-002: [FND] Append migration 3 and SqliteExternalXSignalsRepository

## Implementation Details

Append migration version 3 to `migrations[]`. Do not edit migrations 1 or 2. Add a separate external-signal ledger and implement `ExternalXSignalsRepository` plus `SqliteExternalXSignalsRepository` against the same SQLite handle used by the engine store.

The repository owns source add/read/remove, evidence upsert, refresh-run persistence, and overview read models. It must not call `PostLibraryRepository.upsertPosts` and must not write `post`, `metric_obs`, `source_ref`, `profile_snapshot`, `import_run`, `derived_insight`, `active_context`, `feedback_prediction`, or `feedback_prediction_link`.

## Data Models

Migration 3 creates at least these tables:

```sql
external_x_signal_source
external_x_signal_evidence
external_x_signal_refresh_run
```

`external_x_signal_source` stores durable source identity: local id, platform `x`, screen name, normalized screen name, optional platform user id, status, created timestamp, updated timestamp, and optional last observed timestamp. It has a unique key on the normalized handle.

`external_x_signal_evidence` stores external post evidence: local evidence id, source id, platform post id, text, created timestamp, optional kind/language/reply refs/entity flags, optional metrics, evidence source, observed/imported timestamp, content hash, raw id/source hash/capture session id, and updated timestamp. It has a unique source/post/evidence-source identity so duplicate observed batches dedupe.

`external_x_signal_refresh_run` stores refresh attempts: run id, source id, status, started/completed timestamps, counts JSON, warnings JSON, and source type.

`external_x_signal_pattern` stores persisted evidence-backed pattern snapshots: pattern id, pattern type, label, statement, confidence, support count, generated timestamp, version, optional source/format scope, and compact metric summary JSON.

`external_x_signal_pattern_evidence` links patterns to evidence ids with role `supporting`, `counterexample`, or `example`.

Repository methods expose `addSource`, `removeSource`, `upsertObservedEvidence`, `saveRefreshRun`, `replacePatterns`, `getOverview`, and any narrow read helper required by `ExternalXSignalsService`.

## Integration Point

Producer: `SqliteExternalXSignalsRepository` and migration 3.

Known consumers: `ExternalXSignalsService` and integration tests.

User entry point: later tickets call the repository through service, route, transport, and settings UI.

Terminal outcome: external sources and evidence survive database reopen while own-post corpus tables remain unchanged.

## Scope Boundaries / Out of Scope

In scope: migration 3, repository interface, SQLite implementation, row mapping, persisted pattern/evidence-link writes, repository tests, and engine exports if needed.

Out of scope: no service aggregation, pattern ranking beyond data read helpers, Fastify routes, transport bindings, runner observer, or overlay UI.

Zero-trace: no placeholder methods for future vector search, no adapters into `PostLibraryRepository`, no source aliases using `archive_tweets_js` or `x_live_capture`.

## Test Strategy & Fixture Ownership

Coverage level: engine storage unit tests. Owning suite: engine SQLite repository tests. Fixture strategy: `openEngineDatabase(":memory:")`, deterministic ids/timestamps, small external source/evidence fixtures, and direct own-post table count assertions. Dependency category: in-process SQLite. Isolation boundary: no user settings root, customer database, browser, or network.

## Definition of Done

- New database opens with `user_version = 3`.
- Existing migration-2 database upgrades to version 3 without losing feedback or own-post tables.
- Source add is idempotent by normalized handle.
- Source remove is soft and preserves evidence.
- Duplicate evidence batches dedupe.
- Pattern snapshots persist with evidence links and can be replaced deterministically by source/window/version.
- Own-post tables stay untouched by repository writes.

## Acceptance Criteria

- Given a fresh engine database / When `openEngineDatabase` runs / Then migration 3 tables exist and `PRAGMA user_version` is 3.
- Given a migration-2 database / When the database reopens / Then migration 3 is appended without editing or replaying migrations 1 and 2.
- Given the same source handle twice / When `addSource` runs twice / Then one source row exists and the second call returns the existing source.
- Given external evidence rows / When they are upserted / Then `external_x_signal_evidence` changes and `post` and `metric_obs` row counts remain unchanged.
- Given derived pattern snapshots with evidence refs / When they are saved / Then `external_x_signal_pattern` and `external_x_signal_pattern_evidence` round-trip through overview reads.
- Given a removed source / When overview is read with default filters / Then removed source evidence is preserved but excluded from active source rows.

## Edge Cases

- Handles normalize case and optional leading `@` consistently.
- Missing platform user id does not block source creation.
- Duplicate platform post ids under the same source dedupe.
- Reopening the database preserves sources, evidence, and refresh runs.

## Pipeline Log

- 2026-06-28: Implemented migration 3, `SqliteExternalXSignalsRepository`, persisted pattern/evidence-link rows, and storage tests. Verification: engine storage tests, engine typecheck, shared typecheck, runner host storage test, and `gates.py all --base 5fb92d8` passed.
- 2026-06-28: Ticket authored from approved arch recon.
