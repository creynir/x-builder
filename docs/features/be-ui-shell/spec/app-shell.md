# Screen: App Shell

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Provide the persistent product frame that renders phase 1 routes, global readiness, navigation, route errors, and local shell preferences without blocking feature work.

## Route

All routes: `/`, `/writer`, `/voice`, `/library`, `/settings`, and unknown routes before redirect.

## Entry Points

- Browser opens `/` or a saved route.
- User opens a direct phase 1 URL.
- Unknown URL redirects to `/writer`.
- Sidebar navigation changes the route.
- Route Error Banner and Top Status Bar open `/settings`.

## States

### Ideal State

- `AppShell` renders immediately with `TopStatusBar`, `SidebarNav`, `main`, and the selected route outlet.
- Known routes resolve from a client route registry.
- `/` resolves to `/writer`; unknown routes redirect to `/writer` without a blocking error.
- Last route, sidebar collapsed state, and density preference are read from the local preference boundary when available.
- `GET /status` is in progress or complete independently of route rendering.
- The active route is reflected in the URL, the sidebar active marker, document title, and main heading.

### Empty State

- First launch has no stored shell preferences.
- App uses defaults: `/writer`, expanded sidebar on desktop, default density, status checking.
- No empty landing page appears.
- If local preference read fails, the app continues with defaults and logs a non-blocking development warning.

### Loading State

- The shell frame renders before backend readiness completes.
- Only route content that is actually loading shows route-level `Skeleton` UI.
- `TopStatusBar` shows checking states for engine, Codex, storage, and last run.
- The whole app must not show a full-screen spinner.

### Error State

- If a route component throws, the shell remains mounted and renders the Route Error Banner in the route outlet.
- If `/status` fails, `TopStatusBar` shows `Engine unavailable` and the current route remains interactive.
- If route registry lookup fails or a route is unknown, the app redirects to `/writer`.
- If local preference persistence fails, navigation still succeeds.

### Partial State

- Shell is usable while engine, Codex, or storage are partial or unavailable.
- Sidebar remains navigable even when backend requests fail.
- Backend-dependent route panels show their own recovery states; the shell does not hide unaffected routes.
- Deferred or placeholder routes render their placeholder content rather than blank space.

## Layout

```txt
AppShell
|-- TopStatusBar: compact readiness and last run
|-- Body grid
|   |-- SidebarNav: persistent route navigation
|   |-- main: route header, route error slot, route outlet
|   `-- optional aside/drawer owned by route
```

Desktop dimensions follow the design-system pattern:

- Top status: 40px maximum height.
- Sidebar expanded: 224px.
- Sidebar collapsed: 48px.
- Main content is fluid and remains the priority surface.
- Inspector, when a route owns one later, collapses before the sidebar.

Components referenced: `AppShell`, `TopStatusBar`, `SidebarNav`, `Badge`, `Button`, `IconButton`, `Tooltip`, `Skeleton`, `Alert`, `Toast`.

## Interactions

### Area: Route Resolution

**Open default route**

- Given: the user opens `/`.
- When: the app bootstraps.
- Then: render `/writer` as the selected route and update the URL according to the implementation decision.
- Error: if Writer route fails, keep shell mounted and show the Route Error Banner in `main`.

**Open known route directly**

- Given: the user opens `/settings`, `/voice`, `/library`, or `/writer`.
- When: the route registry resolves the path.
- Then: render that route and mark it active in `SidebarNav`.
- Error: if the route component fails, show the route-local error banner and preserve navigation.

**Open unknown route**

- Given: the user opens an unregistered path.
- When: route registry lookup fails.
- Then: redirect to `/writer` and record `unknown_route_redirected` for diagnostics.
- Error: no user-facing scary copy is shown unless redirect itself fails.

### Area: Shell Preferences

**Persist last route**

- Given: a user navigates to an enabled route.
- When: route rendering succeeds.
- Then: persist the route id as the last route.
- Error: persistence failure is non-blocking and does not roll back navigation.

**Toggle sidebar collapse**

- Given: sidebar is visible on desktop or tablet.
- When: the user activates the collapse `IconButton`.
- Then: switch between expanded sidebar and icon rail, persist the preference, and keep accessible route labels.
- Error: if persistence fails, the visible collapse state can remain for the current session.

### Area: Global Recovery

**Open Settings from shell-owned recovery**

- Given: `TopStatusBar` or Route Error Banner exposes a Settings action.
- When: the user activates the action.
- Then: navigate to `/settings` and preserve the previous route for an explicit `Back to Writer` or `Back to previous route` action.
- Error: if Settings route fails, show route error in `main` and keep sidebar navigation usable.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Booting | Route registry loaded | Path is known | Route resolving | Render shell and target route |
| Booting | Route registry loaded | Path is unknown | Redirecting | Navigate to `/writer` |
| Route resolving | Route module ready | Route enabled | Route ready | Render route outlet |
| Route resolving | Route module loading | Route enabled | Route loading | Show route-level `Skeleton` |
| Route resolving | Route throws | Any | Route error | Show Route Error Banner in main |
| Route ready | Navigate | Target enabled | Route resolving | Update URL and active nav |
| Any | Status request failed | Backend unavailable | Shell partial | Keep route mounted; status shows failed |

Impossible states to prevent:

- Whole-app loading while only `/status` is pending.
- Sidebar active route differs from the URL after navigation settles.
- Route error unmounts `TopStatusBar` or `SidebarNav`.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Route change | Preserve shell; replace route outlet only | Active marker moves; document title updates | No decorative transition required | Focus moves to route heading unless navigation came from within a form with validation |
| Sidebar collapse | Keep icons stable | Tooltip available for each icon-only route | Instant or short functional transition | Route links keep accessible names |
| Preference save | Non-blocking | No success toast for routine saves | Background | Failure logged; no user interruption |
| Status change | Global readiness changes only status region | Badge text changes | No motion dependency | Polite live region in Top Status Bar |

## Modals and Panels

None owned by App Shell in Stage 2. Future route inspectors should be owned by the route and mounted in the optional shell aside or drawer slot.

## Forms

None.

## Feedback and Recovery

- Immediate: route links and collapse controls show active/focus/pressed states.
- Inline/component: route failures appear through the Route Error Banner inside `main`.
- Page-level: unknown route silently recovers to Writer.
- System-level: no success toast for normal route or preference changes.

Failure handling:

- Backend unavailable: detected by API client or status check; show status failed and route-local recovery where applicable.
- Route render failure: detected by route error boundary; preserve shell and offer retry/navigate elsewhere.
- Preference persistence failure: detected by storage boundary; continue current session with defaults or in-memory state.

## Content and Localization

- Primary content: route labels and current route title.
- Secondary content: status labels, navigation tooltips, recovery action labels.
- Tertiary content: route ids, diagnostic logs, last route preference key.
- Copy inventory: `Writer`, `Voice`, `Post Library`, `Settings`, `Retry`, `Open Settings`, `Back to Writer`.
- Truncation/wrapping: route labels do not truncate in expanded sidebar; icon rail uses tooltips and accessible labels.
- Localization: route labels can expand by 30 percent without overlapping; RTL should mirror sidebar position only if the broader app opts into RTL.
- Content ownership: shell owns route labels, route fallback copy, and preference labels.

## Accessibility

- Keyboard navigation: skip link targets `main`; route links are reachable before route content; global shortcuts can route to Writer, Voice, Library, and Settings.
- Focus management: on route navigation from sidebar, focus moves to the route heading; route error retry returns focus to the banner action area after completion.
- Screen reader: `TopStatusBar` uses polite announcements; route errors use assertive announcements only for blocking route failures.
- Landmarks: `header` or status region, `nav`, and `main` are present exactly once.
- Reduced motion: no required animation; any collapse or route transition can be disabled.

### Accessibility Test Notes

- Verify keyboard-only navigation from skip link to main route task.
- Verify `aria-current` follows URL changes.
- Verify a route error does not trap focus or hide sidebar navigation.
- Verify 200 percent and 400 percent zoom preserve access to nav, status, and main.
- Verify icon-only collapsed navigation has accessible names and tooltips on focus.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `AppShell` | Outer grid and route outlet | `sidebarState`, `routeId`, `statusState` |
| `TopStatusBar` | Global readiness region | engine, Codex, storage, last run |
| `SidebarNav` | Persistent route navigation | expanded/collapsed, active route |
| `Alert` | Route-local failure slot | `warning` or `danger` |
| `Skeleton` | Route-level loading only | dimensions match route content |
| `IconButton` | Sidebar collapse and compact controls | required `label` and `tooltip` |
| `Toast` | Rare background completion or undo | not used for routine nav |

## Handoff Notes

- Visual specs: use design tokens for 40px top status, 224px expanded sidebar, 48px collapsed sidebar, 16px page padding, and dense 32px controls.
- Interaction specs: no whole-app blocker for `/status`; route outlet errors stay local.
- Content specs: shell owns route labels and unknown-route fallback behavior.
- Edge cases: unknown route, disabled route, preference write failure, status timeout, route throw.
- Implementation dependencies: client router, route registry, shell preference storage, route error boundary, API client status hook.

## Open Questions

- Decision needed: should `/` redirect to `/writer` or render Writer while preserving `/`?
- Decision needed: should sidebar collapsed state persist from day one?
- Decision needed: should global keyboard shortcuts ship in the first implementation or remain documented for later?
