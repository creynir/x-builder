# Flow Map Validation Report

**Date:** 2026-07-01
**Scope:** 2 flows, 5 screens, 9 features

## Summary

- Features covered: 9/9
- Flows complete: 2/2 for MVP intent
- Screen naming issues: 0
- Dead ends: 0
- Orphan screens: 0 for this feature
- Cross-flow issues: 0
- Strategic coverage gaps: 0 blocking
- Open questions: 0 blocking

## Feature Coverage

| Feature | Covered by Flow | Steps |
|---|---|---|
| Split/merge regression pin | Choose/edit variant | Edge cases and ticket sequence |
| Reply-specific assistant shell | Choose/edit variant | Steps 1-3 |
| Parent/thread context summary | Choose/edit variant | Step 2 |
| Reply variant generation contract | Choose/edit variant | Steps 3-4 |
| Variant chooser | Choose/edit variant | Steps 4-5 |
| Native composer write | Choose/edit variant | Steps 5-6 |
| Generated reply ledger | Choose/edit variant, Generated exclusion | Step 7 |
| Generated reply exclusion | Generated exclusion | Ledger/corpus handoff |
| Integration coverage | Both flows | End-to-end invariants |

## Flow Completeness

| Flow | Entry Points | Happy Path | Decisions Complete | Errors Documented | Edge Cases |
|---|---|---|---|---|---|
| Choose/edit generated reply variant | Yes | Yes | Yes | Yes | Yes |
| Generated reply exclusion | Yes | Yes | Yes | Yes | Yes |

## Screen Consistency

- Screen names are consistent across inventory, flow index, and screen spec.

## Dead Ends & Orphans

- No dead ends in the MVP reply assistant flow.
- No new route or standalone page is introduced.

## Cross-Flow Integrity

| From Flow | Exit Step | To Flow | Entry Point | Context Preserved? |
|---|---|---|---|---|
| Choose/edit variant | Record chosen generated reply | Generated exclusion | Ledger entry by normalized text hash | Yes, generated body and reply context metadata are retained. |

## Strategic Coverage

| Metric | Flow Step / Event | Instrumentable? | Gap |
|---|---|---:|---|
| Variant selection | Choose variant | Yes | None |
| No auto-posting | Flow terminal outcome | Yes via absence of X reply click | None |
| Generated exclusion | Ledger insert and corpus lookup | Yes | None |
| Post mode unaffected | Integration test | Yes | None |

## Implementation Gaps

| Screen / Contract | In Flow Map | In Code | Gap |
|---|---:|---:|---|
| Reply Assistant Pin | Yes | No | New overlay component path needed. |
| Variant Chooser | Yes | No | New reply UI; current code auto-writes best candidate. |
| Reply generation response | Yes | No | Current `GenerateIdeaResponse` is fixed at 3 judged post candidates. |
| Generated reply ledger | Yes | No | New storage table/repository/service needed. |
| Split/merge behavior | Yes | Yes | Needs regression pin before refactor. |

## Consolidated Open Questions

### Must answer before building

- None.

### Can answer during building

- Final microcopy for non-blocking ledger failure.
- Exact reply move labels returned by the generator.

## Recommended Next Actions

1. Write a reply assistant screen spec and architecture contract.
2. Author local tickets beginning with an `[RFR]` split/merge characterization ticket.
3. Run RGB/TDD audit over tickets before implementation.
