# Screen: Post Library Route Placeholder

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Provide a shell-owned `/library` route placeholder that keeps phase 1 navigation complete while making clear that known-post import, storage-backed tables, and memory workflows belong to later Post Library feature specs.

## Route

`/library`

## Entry Points

- Sidebar Nav: Post Library.
- Direct browser URL: `/library`.
- Voice placeholder action if source posts are needed later.
- Future Writer save/import flows.

## States

### Ideal State

- Post Library route renders inside `AppShell` with global status and navigation visible.
- Page heading is `Post Library`.
- Main content uses `EmptyState` or a simple placeholder section.
- Copy explains that post memory/import workflows are not implemented in the shell epic.
- Primary action returns to Writer or opens Settings if storage readiness is the immediate blocker.

### Empty State

- This is the normal shell-owned placeholder state.
- No post rows, metrics, import controls, filters, or usage badges are shown.
- The route proves navigation and future URL shape without pretending persistence exists.

### Loading State

- If the route chunk is lazy-loaded, show route-level `Skeleton`.
- There is no storage-backed table load in this placeholder.
- `TopStatusBar` can independently show storage checking, stale, or failed.

### Error State

- If the route component throws, App Shell shows Route Error Banner.
- If storage readiness fails globally, `TopStatusBar` shows the failure while this placeholder still renders.
- Do not show table-level storage errors until the Post Library feature owns storage-backed content.

### Partial State

- If storage is partial or unavailable, the placeholder can show a neutral note that storage-backed library features are deferred.
- Navigation remains usable.
- No cached rows are implied.

## Layout

```txt
AppShell main
|-- PageHeader: Post Library
|-- Route Error Banner slot
`-- EmptyState / placeholder section
    |-- concise explanation
    |-- action: Back to Writer
    |-- optional action: Open Settings when storage readiness is relevant
    `-- optional future capability note
```

Components referenced: `PageHeader`, `EmptyState`, `Button`, `Badge`, `Alert`, `Skeleton`.

## Interactions

### Area: Route Entry

**Open Post Library route**

- Given: route registry includes `/library` as enabled placeholder.
- When: user selects Post Library or opens `/library` directly.
- Then: render placeholder, mark Post Library active in `SidebarNav`, and persist last route.
- Error: if render fails, show Route Error Banner while shell remains mounted.

**Navigate back to Writer**

- Given: placeholder is visible.
- When: user activates Back to Writer.
- Then: navigate to `/writer` and update active nav.
- Error: if Writer route fails, show Writer route error banner.

**Open Settings for storage readiness**

- Given: storage status is partial, failed, stale, or unavailable.
- When: user activates Open Settings.
- Then: navigate to `/settings` and preserve previous route context.
- Error: if Settings route fails, show Settings route error banner.

### Area: Deferred Capability

**Read deferred note**

- Given: user expects imported posts or memory.
- When: placeholder renders.
- Then: copy says the route is reserved for post memory and import workflows, not that no posts exist.
- Error: avoid an empty-table treatment that implies storage has been queried.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Route requested | Route module ready | Route enabled | Placeholder ready | Render `EmptyState` |
| Route requested | Route module loading | Lazy route | Loading | Show route-level `Skeleton` |
| Route requested | Route throws | Any | Route error | Show Route Error Banner |
| Placeholder ready | Navigate Writer | `/writer` enabled | Leaving route | Update URL |
| Placeholder ready | Open Settings | `/settings` enabled | Leaving route | Preserve previous route context |

Impossible states to prevent:

- Placeholder shows fake post rows or metrics.
- Placeholder claims storage queried successfully.
- Backend/storage unavailable blocks navigation to the route.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Route renders | Keep shell stable | Post Library active marker appears | Instant | Focus moves to route heading |
| Back to Writer | Route action only | URL and active nav update | Instant | Link/action has clear name |
| Open Settings | Preserve return context | Settings route opens | Instant | Focus moves to Settings heading |
| Storage status changes | Do not create table errors | TopStatusBar updates; optional placeholder note remains neutral | Instant | Polite status announcement |

## Modals and Panels

None. Import review drawers, known-post detail drawers, and bulk action panels belong to Post Library feature specs.

## Forms

None. Import forms, filters, search, and table bulk actions belong to the Post Library feature specs.

## Feedback and Recovery

- Immediate: route actions show focus/active states.
- Inline/component: no field or row errors.
- Page-level: Route Error Banner only for route render failure.
- System-level: no toasts.

Failure handling:

- Route render failure: show Route Error Banner with Retry.
- Storage unavailable: TopStatusBar and Settings handle readiness repair; placeholder does not imply storage query failure.
- Future route disabled decision: Sidebar Nav owns disabled route explanation.

## Content and Localization

- Primary content: `Post Library` heading and placeholder explanation.
- Secondary content: action labels and future capability note.
- Tertiary content: none.
- Copy inventory: `Post Library`, `Post memory is reserved for the library feature pass.`, `Back to Writer`, `Open Settings`.
- Truncation/wrapping: placeholder copy wraps without overlapping route actions.
- Localization: `Post Library` must fit sidebar and route heading; action labels remain verbs.
- Content ownership: shell owns placeholder copy until Post Library feature replaces the page.

## Accessibility

- Keyboard navigation: route heading, primary action, optional Settings action.
- Focus management: on navigation to `/library`, focus moves to page heading; on route action, focus moves to destination heading after render.
- Screen reader: placeholder should be announced as normal route content, not empty table or error content.
- Landmarks: content sits inside App Shell `main`.
- Reduced motion: no required motion.

### Accessibility Test Notes

- Verify `/library` is reachable from sidebar by keyboard.
- Verify active route uses `aria-current`.
- Verify placeholder is not announced as a failed table or empty data query.
- Verify Back to Writer and Open Settings navigate correctly.
- Verify 400 percent zoom keeps actions visible.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `PageHeader` | Route title | `title="Post Library"` |
| `EmptyState` | Placeholder body | no table or illustration required |
| `Button` | Back to Writer and optional Settings action | `secondary` or link-styled route action |
| `Badge` | Optional `Placeholder` or `Coming later` state | `info` or `uncertain` |
| `Alert` | Route Error Banner composition if route fails | `warning` or `danger` |
| `Skeleton` | Lazy route loading | route-level only |

## Handoff Notes

- Visual specs: do not build a decorative coming-soon card or fake table.
- Interaction specs: route is URL-backed and independent of storage readiness for placeholder rendering.
- Content specs: do not claim import, usage tagging, metrics, filters, cached rows, or persistence exists in this epic.
- Edge cases: direct URL, storage unavailable, route render failure, route disabled decision.
- Implementation dependencies: route registry, Sidebar Nav active state, App Shell route outlet, optional lazy-route skeleton, Settings navigation context.

## Open Questions

- Decision needed: should `/library` be enabled as a placeholder from day one or hidden until the Post Library feature starts.
- Decision needed: should storage failures surface as an optional placeholder note or only in Top Status Bar.
- Decision needed: should the primary placeholder action go to Writer or Settings when storage is unavailable.
