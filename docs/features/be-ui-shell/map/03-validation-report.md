# BE + Simple UI Shell Flow Map Validation Report

Stage: product-flow-map / Stage 3 VALIDATE

Status: draft for review

Scope:

- 14 features from inventory.
- 4 mapped flows.
- 7 canonical screens/regions.
- Existing code checked in `client`, `engine`, `shared`, and `e2e-tests`.

Inputs:

- [Feature Inventory](./01-feature-inventory.md)
- [Flow Index](./02-flow-index.md)
- [App Boot And Readiness Check](./02-flows/app-boot-readiness.md)
- [Route Navigation](./02-flows/route-navigation.md)
- [Backend Unavailable Recovery](./02-flows/backend-unavailable-recovery.md)
- [Settings Readiness Repair](./02-flows/settings-readiness-repair.md)
- [Design System](../../../design-system/README.md)

## Summary

- Features covered: 12/14.
- Flows complete: 4/4.
- Screen naming issues: 0.
- Dead ends: 0.
- Orphan screens: 1 existing code screen is only partially mapped.
- Cross-flow issues: 1 important decision unresolved.
- Strategic coverage gaps: 4.
- Open questions: 9 total, 4 must answer before building.

Validation result:

The flow map is good enough to feed `product-flow-spec` after the open decisions below are resolved or accepted as assumptions.

## Feature Coverage

### Covered

| Feature | Covered By Flow | Notes |
|---|---|---|
| App shell layout | all flows | Central dependency for the epic. |
| Client routing | route-navigation.md | URL-backed route assumption included. |
| Route placeholders | route-navigation.md | Covered as route loading/deferred/placeholder behavior. |
| Top runtime status bar | app-boot-readiness.md, backend-unavailable-recovery.md, settings-readiness-repair.md | Detailed status contract still missing in code. |
| Health/readiness endpoint | app-boot-readiness.md, backend-unavailable-recovery.md | Flow expects `/status`; code only has `/health`. |
| API client boundary | backend-unavailable-recovery.md | Error classification and retry are mapped. |
| Shared app status schema | app-boot-readiness.md, settings-readiness-repair.md | Required by mapped status behavior. |
| Error boundary and retry UX | backend-unavailable-recovery.md | Route error banner and retry paths covered. |
| Per-panel loading conventions | app-boot-readiness.md, route-navigation.md | Covered at shell/route level. |
| Local UI preferences | route-navigation.md | Last route/sidebar persistence covered. |
| Settings shell section | settings-readiness-repair.md | Editable readiness repair flow covered. |
| E2E smoke coverage | route-navigation.md, app-boot-readiness.md | Flow implies shell smoke tests. |

### Not Covered

| Feature | Status | Why Missing |
|---|---|---|
| Storage readiness boundary | Mentioned | Flow references storage state, but there is no separate flow for initializing/testing storage. Include in Settings spec unless storage becomes its own epic. |
| Dev server workflow | Partial | Product UI flows do not map developer process startup. Capture in architecture or tooling tickets. |

## Flow Completeness

| Flow | Entry Points | Happy Path | Decisions Complete | Errors Documented | Edge Cases | Result |
|---|---|---|---|---|---|---|
| App boot and readiness check | Yes | Yes | Yes | Yes | Yes | Pass |
| Navigate between phase 1 routes | Yes | Yes | Yes | Yes | Yes | Pass |
| Backend unavailable recovery | Yes | Yes | Yes | Yes | Yes | Pass |
| Settings readiness repair | Yes | Yes | Yes | Yes | Yes | Pass |

Notes:

- All flows have a start, terminal state, decisions, error paths, and recovery.
- The Settings flow needs a final product decision about which settings are shell-owned before spec work begins.

## Screen Naming Consistency

Status: pass.

Canonical names used consistently:

- App Shell.
- Top Status Bar.
- Sidebar Nav.
- Writer Route.
- Voice Route.
- Post Library Route.
- Settings Route.
- Route Error Banner.

No naming conflicts found.

## Dead Ends And Orphans

### Dead Ends

None found.

Every failure state has at least one recovery:

- retry
- open Settings
- navigate elsewhere
- fix inline input
- use defaults

### Orphan Screens / Existing UI

| Screen / Code Surface | In Flow Map | In Code | Gap |
|---|---|---|---|
| Writer Route | Yes | Partial | Current code renders only a basic `WriterPage`; shell wrapper and route integration are missing. |

No additional route screens were found in code.

## Cross-Flow Integrity

| From Flow | Exit Step | To Flow | Context Preserved? | Gap |
|---|---|---|---|---|
| App boot and readiness check | `/status` fails | Backend unavailable recovery | Yes | None. |
| Backend unavailable recovery | Open Settings | Settings readiness repair | Partial | Need previous-route return behavior. |
| Settings readiness repair | Repair done | Route navigation / previous route | Partial | Must decide whether successful repair auto-returns or stays in Settings. |
| Route navigation | Settings selected | Settings readiness repair | Yes | None. |

Important issue:

- Previous-route return from Settings is not fully defined. The spec should either require a visible "Back to Writer" action when entered from recovery, or keep the user in Settings after repair and rely on sidebar navigation.

## Strategic Coverage

### Metrics

| Metric / Event | Flow Step | Instrumentable? | Gap |
|---|---|---|---|
| `app_boot_started` | Client boot | Yes | Needs analytics/event boundary. |
| `app_shell_rendered` | Shell render | Yes | None. |
| `status_check_completed` | Status response | Yes | Needs `/status`. |
| `status_check_failed` | Status error | Yes | Needs API error schema. |
| `route_navigation_clicked` | Sidebar route click | Yes | Needs route registry. |
| `route_render_failed` | Route component error | Yes | Needs route error boundary. |
| `backend_retry_clicked` | Retry from banner/status | Yes | None. |
| `settings_save_clicked` | Settings save | Yes | Needs settings persistence boundary. |

### Information Architecture

| Screen / Section | Entry Path | Return Path | Label Risk | Gap |
|---|---|---|---|---|
| Writer | default route, sidebar | sidebar | Low | None. |
| Voice | sidebar | sidebar | Low | Placeholder ownership undecided. |
| Post Library | sidebar | sidebar | Low | Placeholder ownership undecided. |
| Settings | sidebar, status, error banner | sidebar or previous-route action | Low | Previous-route return needs decision. |

### Content

| Copy Need | Screen / State | Owner | Gap |
|---|---|---|---|
| Engine unavailable message | Top Status Bar, Route Error Banner | BE + UI shell | Needs final copy in spec. |
| Partial Codex readiness | Top Status Bar, Settings | BE + UI shell / Codex adapter | Needs exact status labels. |
| Route placeholder copy | Voice, Post Library | Shell or feature teams | Ownership undecided. |
| Settings validation errors | Settings Route | BE + UI shell | Needs field-level validation rules. |

### Service Dependencies

| Dependency | Affected Flow | Visible Wait/Error State | Owner | Gap |
|---|---|---|---|---|
| `/status` endpoint | boot, recovery, settings | checking, ready, partial, failed | engine/shared | Not implemented. |
| Shared API error schema | recovery, settings | inline/banner errors | shared/engine/client | Not implemented. |
| Settings persistence | settings repair | loading, dirty, saved, failed | engine/client | Not implemented. |
| Route registry | navigation | active, disabled, unknown | client | Not implemented. |
| Storage readiness | boot, settings | ready, stale, failed | engine/storage | Not implemented. |

### Accessibility-Critical Moments

| Flow / State | Risk | Later Test Needed | Gap |
|---|---|---|---|
| Status updates after boot | User may miss readiness changes | screen reader live region | Spec must define live-region behavior. |
| Backend failure banner | Error may not be announced | assertive announcement and focus order | Spec must define focus behavior after retry. |
| Sidebar navigation | Collapsed labels may become inaccessible | keyboard and screen reader nav | Spec must require accessible labels. |
| Settings validation | Field errors may be detached from fields | field association tests | Spec must define `aria-describedby` behavior. |

## Implementation Gaps

| Screen / Capability | In Flow Map | In Code | In Design System | Gap |
|---|---|---|---|---|
| App Shell | Yes | No | Yes | Build shell layout in client. |
| Top Status Bar | Yes | No | Yes | Build UI and `/status` contract. |
| Sidebar Nav | Yes | No | Yes | Build route registry and URL-backed nav. |
| Writer Route | Yes | Partial | Yes | Wrap current route in shell; feature logic remains later. |
| Voice Route | Yes | No | Yes | Add placeholder or feature-owned route. |
| Post Library Route | Yes | No | Yes | Add placeholder or feature-owned route. |
| Settings Route | Yes | No | Yes | Build shell-owned settings surface. |
| Route Error Banner | Yes | No | Alert/InlineError available | Build wrapper pattern. |
| `/status` endpoint | Yes | No | N/A | Add endpoint and shared schema. |
| `apiErrorSchema` | Yes | No | N/A | Add shared schema and use in API client. |
| E2E shell smoke | Yes | Partial | N/A | Extend writer smoke to shell/nav/status. |

## Consolidated Open Questions

### Must Answer Before Product Flow Spec Stage 2

1. Should Settings include editable shell fields in this epic?
   - Recommended answer: yes, but only shell-owned fields: engine URL, storage path, command labels/status toggles.
2. Should successful Settings repair return to the previous route automatically?
   - Recommended answer: no auto-return; show an explicit "Back to Writer" action when Settings was opened from a route error.
3. Should Voice and Post Library placeholders be owned by shell or by their feature folders?
   - Recommended answer: shell owns route-level placeholders until feature pages replace them.
4. Should detailed readiness live at `/status` while `/health` remains liveness-only?
   - Recommended answer: yes.

### Should Answer Before Architecture

5. Should route state be browser history only, or also persisted as last route?
6. What should the first storage readiness target be: SQLite, JSON file, or in-memory placeholder?
7. Should dev startup be two processes or a single tool command?

### Can Answer During Implementation

8. Exact timeout threshold for local `/status`.
9. Exact wording for non-critical dev-console-only persistence warnings.

## Recommended Next Actions

1. Approve the flow map as validated with the recommended answers above.
2. Delete or regenerate any flow-spec artifacts created before this validation so spec work consumes the validated flow map.
3. Run `product-flow-spec` Stage 1 again from this validated map.
4. Run `product-flow-spec` Stage 2 for P0 screens:
   - App Shell.
   - Top Status Bar.
   - Route Error Banner.
   - Sidebar Nav.
   - Settings Route.
5. Run `product-flow-spec` Stage 4 checklist before `arch-recon`.

## Validation Decision

Approved for flow-spec input once the user accepts the recommended answers or overrides them.

