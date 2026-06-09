# Screen: Sidebar Nav

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Provide persistent URL-backed navigation across Writer, Voice, Post Library, and Settings while preserving global readiness and accessible route labels.

## Route

Persistent navigation region on all routes.

## Entry Points

- App Shell renders after boot.
- User navigates by sidebar link.
- User lands on a direct URL and active state resolves from the route registry.
- Top Status Bar or Route Error Banner sends the user to Settings.

## States

### Ideal State

- Sidebar shows enabled route links: Writer, Voice, Post Library, Settings.
- Active route has text, icon, active marker, and `aria-current`.
- Expanded desktop width is 224px.
- Collapsed state shows icon rail with tooltips and accessible labels.
- Navigation does not depend on backend availability.

### Empty State

- If no route is active yet during initial route resolution, no item is incorrectly marked active.
- If route registry fails to load, App Shell falls back to Writer route and enabled default nav.

### Loading State

- Sidebar itself should not show a blocking loader.
- Route target may show route-level loading after a link is activated.
- Active state updates only after the URL/route settles, or uses a pending marker if implementation supports it.

### Error State

- Disabled or deferred route selection shows a concise explanation and leaves focus on the route item.
- Unknown direct URL is handled by App Shell redirect to Writer.
- Preference persistence failure for collapsed state does not break navigation.

### Partial State

- Backend unavailable does not disable route links.
- Voice and Post Library can render placeholder pages while their full feature routes are deferred.
- Route-specific backend warnings appear in the route outlet, not on every nav item.

## Layout

```txt
SidebarNav
|-- product mark / app label
|-- route list
|   |-- Writer
|   |-- Voice
|   |-- Post Library
|   `-- Settings
|-- spacer
`-- collapse control
```

Components referenced: `SidebarNav`, `IconButton`, `Tooltip`, `Badge`, `Divider`.

## Interactions

### Area: Route Links

**Navigate to enabled route**

- Given: the route is enabled in the route registry.
- When: the user clicks the link or activates it with keyboard.
- Then: update the URL, render the route outlet, move active marker, persist last route, and keep Top Status Bar mounted.
- Error: if route render fails, show Route Error Banner in `main`.

**Open placeholder route**

- Given: Voice or Post Library is shell-owned placeholder in this epic.
- When: the user opens the route.
- Then: render the placeholder page state and mark the route active.
- Error: backend status does not prevent placeholder rendering.

**Select disabled route**

- Given: a route exists in registry but is disabled or deferred.
- When: the user activates it.
- Then: prevent navigation and show disabled explanation near the item or in the route outlet according to implementation.
- Error: do not leave the URL on a path that cannot render.

### Area: Collapse

**Collapse sidebar**

- Given: sidebar is expanded.
- When: user activates collapse control.
- Then: switch to icon rail, keep accessible route names, show tooltips on hover/focus, and persist the preference.
- Error: persistence failure keeps current visual state for session only.

**Expand sidebar**

- Given: sidebar is collapsed.
- When: user activates expand control.
- Then: show text labels and persist expanded preference.
- Error: no route navigation changes.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Expanded | Collapse clicked | Width supports rail | Collapsed | Persist collapsed state |
| Collapsed | Expand clicked | Any | Expanded | Persist expanded state |
| Any | Route clicked | Route enabled | Pending route | Update URL |
| Pending route | Route renders | Any | Active route | Set `aria-current` |
| Pending route | Route throws | Any | Active with error | Route outlet shows banner |
| Any | Route clicked | Route disabled | Same route | Show explanation |

Impossible states to prevent:

- Collapsed icon-only link without accessible label.
- Active marker on more than one route.
- Backend unavailable disables Settings navigation.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Hover/focus route | Do not resize layout | Highlight row | Instant | Focus ring visible |
| Active route changes | Marker and text state update | Active marker plus `aria-current` | Instant | Screen reader reads current page |
| Collapse/expand | Keep route icons aligned | Width changes; labels hide/show | Reduced-motion fallback instant | Focus remains on collapse control |
| Disabled route activation | Do not navigate | Explanation visible | Instant | Announcement through polite region or inline text |

## Modals and Panels

None.

## Forms

None.

## Feedback and Recovery

- Immediate: route hover/focus/active states and collapse pressed state.
- Inline/component: disabled route explanation.
- Page-level: route render errors appear through Route Error Banner.
- System-level: no toasts for normal navigation.

Failure handling:

- Route render failure: preserve shell and nav; route outlet shows retry.
- Unknown URL: App Shell redirects to Writer.
- Preference write failure: current session continues.

## Content and Localization

- Primary content: route labels `Writer`, `Voice`, `Post Library`, `Settings`.
- Secondary content: collapsed tooltips and disabled explanations.
- Tertiary content: optional route state badges such as partial or later.
- Copy inventory: `Collapse sidebar`, `Expand sidebar`, `Writer`, `Voice`, `Post Library`, `Settings`, `Coming later`.
- Truncation/wrapping: route labels remain single-line in expanded state; `Post Library` must fit at 224px.
- Localization: labels can expand by 30 percent; collapsed state avoids visual text overflow.
- Content ownership: shell owns route labels until feature teams replace placeholders.

## Accessibility

- Keyboard navigation: route links are tab stops in visual order; arrow-key roving is optional but not required.
- Focus management: navigation from sidebar moves focus to the destination route heading after render.
- Screen reader: `nav` landmark has an accessible name; active link uses `aria-current="page"`.
- Landmarks: one `nav` element for primary app navigation.
- Reduced motion: collapse transition is disabled or shortened.

### Accessibility Test Notes

- Verify all routes are reachable by keyboard.
- Verify active route is announced as current page.
- Verify collapsed icon rail retains route labels for screen readers.
- Verify tooltips appear on hover and focus for icon-only items.
- Verify navigation works while the engine is stopped.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `SidebarNav` | Persistent route list | `expanded`, `collapsed`, `activeRouteId` |
| `IconButton` | Collapse/expand | required `label` and `tooltip` |
| `Tooltip` | Collapsed route labels | hover/focus only |
| `Badge` | Optional route status | `warning`, `uncertain`, `info` |
| `Divider` | Separate route groups if needed | border separator |

## Handoff Notes

- Visual specs: expanded 224px and collapsed 48px are design-system dimensions.
- Interaction specs: URL-backed route changes, active state from route registry, preference persistence non-blocking.
- Content specs: route labels are shell-owned for Stage 2; placeholders remain honest about feature readiness.
- Edge cases: collapsed labels, disabled route, direct URL active state, backend unavailable, persistence failure.
- Implementation dependencies: route registry, router/link component, local preference storage, route heading focus target.

## Open Questions

- Decision needed: should Voice and Post Library placeholders be enabled by default in this epic.
- Decision needed: should disabled future routes appear in the nav before their feature epics begin.
- Decision needed: should `G W`, `G V`, `G L`, and `G S` shortcuts ship with the first shell build.
