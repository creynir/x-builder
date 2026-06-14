---
status: todo
---

# RMU-021: Compact candidate summary should use the chip, not the full ReachRegimeBlock

> Follow-up from the RMU epic-close triage (Concern **C4**, raised by Yellow on RMU-011). Cosmetic; not a merge blocker. Tracked here for backlog.

## Problem

RMU-011's Green mounted the full `ReachRegimeBlock` inside the compact `CandidateDeterministicSummary` (`client/src/features/writer/deterministic/components.tsx`, ~`:496`). The ticket scoped that component to render the prediction **chip** via `predictionSummary` (e.g. `"800–2,400 typical · 12% escape"`), not the full five-row regime block. The result: the compact candidate-list item shows the full block AND the chip (redundant).

This is test-driven: RMU-011's writer-page assertions pin the spaced `"800 – 2,400"` (the block's format) in that render, so reverting to chip-only requires adjusting those assertions + removing the `:496` block mount. No AC currently fails; tests are green.

## Scope

- Revert the compact `CandidateDeterministicSummary` to render the `predictionSummary` chip only (drop the full `ReachRegimeBlock` mount in the compact path).
- Update the RMU-011 writer-page/deterministic-components assertions that pin the block's spaced-range format in the compact render to assert the chip format instead.
- The full `ReachRegimeBlock` remains in the non-compact prediction call sites (`DraftDeterministicEvaluation`, `DeterministicDetailInspector`) — unchanged.

## Acceptance Criteria

- The compact candidate summary renders the `predictionSummary` chip (typical range + escape %), not the five-row `ReachRegimeBlock`.
- The full `ReachRegimeBlock` still renders in the detail/evaluation call sites.
- `pnpm --filter @x-builder/client test` + `typecheck` green.
