---
status: in-progress
---

# EFL-002: [FND] Add pattern-only snapshot reader

## Implementation Details

Add a read-only pattern snapshot boundary over persisted `ExternalXSignalPattern` rows.

`ExternalPatternSnapshotReader` must read only persisted pattern payloads through `ExternalXSignalsRepository` / `SqliteExternalXSignalsRepository`. It must not call `getOverview`, read `recentEvidence`, recompute patterns from evidence, open a separate SQLite database, call transport, or read raw X payloads.

Sorting rules:

1. requested-format matches first;
2. confidence descending;
3. support count descending;
4. generated time descending;
5. id ascending.

## Data Models

```ts
type ExternalPatternSnapshotReader = {
  listGenerationPatterns(request: {
    format?: DetectedPostFormat;
    patternTypes?: ExternalXSignalPattern["patternType"][];
    minConfidence?: number;
    minSupportCount?: number;
    limit?: number;
  }): Promise<ExternalXSignalPattern[]>;
};
```

Defaults: `patternTypes` allowlist starts with `["format"]`, `minConfidence` defaults to `0.5`, `minSupportCount` defaults to `2`, and `limit` defaults to `20` with a bounded maximum.

## Integration Point

Producer: `SqliteExternalXSignalsRepository` persisted pattern rows.

Known consumer: `ExternalPatternGuidanceProvider`.

User entry point: existing External X Signals settings and observe-only runner produce persisted patterns; later generation requests consume them through this reader.

Terminal outcome: generation has a pattern-only read contract that cannot accidentally depend on raw evidence or settings overview payloads.

## Scope Boundaries / Out of Scope

In scope: repository interface addition, SQLite implementation, filtering/sorting/validation, and repository tests.

Out of scope: no pattern derivation changes, no evidence reads, no generation resolver wiring, no service route, no transport method, no UI.

Zero-trace: do not expose `recentEvidence`, source rows, refresh runs, source ids, evidence ids, or overview-shaped payloads through this reader.

## Test Strategy & Fixture Ownership

Coverage level: engine repository tests. Owning suite: external signals repository tests. Fixture strategy: temp SQLite using existing engine DB helpers, seeded persisted patterns plus evidence rows that must not be returned. Dependency category: local-substitutable SQLite only. Isolation boundary: temp DB, no developer-local storage, no live X, no browser, no network.

## Definition of Done

- Reader returns validated `ExternalXSignalPattern[]`.
- Reader filters by pattern type, confidence, support count, and optional format.
- Matching format patterns rank before non-matching patterns.
- Reader does not require evidence rows to return pattern payloads.
- Reader uses prepared SQL and existing repository/database handle.

## Acceptance Criteria

- Given persisted pattern rows and external evidence rows / When `listGenerationPatterns` runs / Then returned values are pattern snapshots only.
- Given a requested format and mixed-format patterns / When `listGenerationPatterns` runs / Then requested-format patterns rank first.
- Given low-confidence or low-support patterns / When `listGenerationPatterns` runs / Then they are excluded by defaults.
- Given malformed pattern payload JSON / When `listGenerationPatterns` reads it / Then the repository follows the existing pattern payload validation behavior and throws instead of returning raw data.
- Given an empty pattern table / When `listGenerationPatterns` runs / Then it returns an empty list.

## Edge Cases

- Removed-source historical evidence may remain in the ledger, but this reader consumes only the persisted active pattern snapshots already produced by External X Signals.
- Future pattern types remain excluded unless explicitly allowlisted.
- Limit values are bounded before hitting SQL.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
- 2026-06-29: RGB pipeline started.
