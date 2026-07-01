# Flow Spec Checklist: Reply Assistant

**Date:** 2026-07-01
**Screens specced:** 1 primary panel plus 4 embedded/native sections
**Screens mocked up:** 1
**Overall completeness:** 95%

## Summary

- Screens fully complete: 5/5 for MVP behavior
- Missing states: 0
- Undocumented interactions: 0 blocking
- Forms without validation: n/a
- Modals without focus management: n/a
- Missing design system components: 0 blocking
- Spec/mockup mismatches: 0
- Content/localization/responsive gaps: 1 non-blocking copy polish item
- Handoff readiness gaps: 0 blocking

## State Coverage

| Screen | Ideal | Empty | Loading | Error | Partial | Complete? |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Reply Assistant Pin | Yes | Yes | Yes | Yes | Yes | Yes |
| Parent/Thread Context Summary | Yes | Yes | n/a | Yes | Yes | Yes |
| Variant Chooser | Yes | Yes | Yes | Yes | Yes | Yes |
| Ledger Status | Yes | Yes | n/a | Yes | Yes | Yes |
| Native X Composer | Yes | Yes | n/a | n/a | Yes | Yes |

## Interaction Gaps

- None blocking. Final exact button copy can be tuned during implementation.

## Accessibility Gaps

- None blocking. Implementation must verify focus return to the native composer and `aria-live` announcements in overlay tests.

## Missing Components

| Component | Referenced | Exists? | Notes |
|---|---|---:|---|
| `Button` | Generate/retry/use | Yes | Use existing v2 primitive. |
| `Alert` | Errors/warnings | Yes | Use existing v2 primitive. |
| `Badge` | Status | Yes | Use existing v2 primitive. |
| `Skeleton` | Loading rows | Yes | Use existing v2 primitive. |
| `KeyValueList` | Context details | Yes | Use existing v2 primitive. |

## Heuristic / Design QA Issues

| Issue | Location | Severity | Recommended Fix |
|---|---|---|---|
| Copy polish | Context warning | Low | Keep observed/missing wording and avoid blame. |

## Handoff Readiness

- Product boundaries are explicit.
- Variant choice and ledger recording are observable.
- Reply plan and response need shared schemas before UI implementation.
- RGB/TDD tickets must start with split/merge characterization.
