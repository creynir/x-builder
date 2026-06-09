# Screen: Voice Route Placeholder

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Provide a shell-owned `/voice` route placeholder that keeps navigation complete and accurately signals that full voice profile extraction and editing belong to the later Voice Profile feature.

## Route

`/voice`

## Entry Points

- Sidebar Nav: Voice.
- Direct browser URL: `/voice`.
- Future links from Writer or Post Library that need voice setup.
- Unknown route fallback does not target Voice; fallback remains Writer.

## States

### Ideal State

- Voice route renders inside `AppShell` with `TopStatusBar` and `SidebarNav` still visible.
- Page heading is `Voice`.
- Main content uses `EmptyState` or a simple placeholder section that explains voice setup is not implemented in this shell epic.
- Primary useful action links to Post Library if source posts are needed later, or back to Writer if the user wants to continue drafting.
- No extraction, trait editing, source post mutation, or save behavior is implied.

### Empty State

- This is the normal Stage 2 shell state.
- Show that no voice profile workflow is available yet.
- Avoid blank route content and avoid fake progress such as mock confidence scores.
- The route is enabled only to prove URL-backed navigation and shell layout.

### Loading State

- If the route chunk is lazy-loaded, show route-level `Skeleton` under the page heading.
- There is no backend data loading owned by this placeholder.
- `TopStatusBar` may continue checking readiness independently.

### Error State

- If the route component throws, App Shell shows the Route Error Banner.
- If global backend status is unavailable, the Voice placeholder still renders because it does not depend on backend data.
- No field-level errors exist.

### Partial State

- If `TopStatusBar` reports partial readiness, the Voice placeholder remains available.
- If the future `voice-extractor` backend capability is known but not surfaced, the placeholder can show a neutral note that the detailed flow is deferred.
- Do not show extracted voice traits until the Voice Profile feature owns the route.

## Layout

```txt
AppShell main
|-- PageHeader: Voice
|-- Route Error Banner slot
`-- EmptyState / placeholder section
    |-- concise explanation
    |-- action: Back to Writer or Open Post Library
    `-- optional future capability note
```

Components referenced: `PageHeader`, `EmptyState`, `Button`, `Badge`, `Alert`, `Skeleton`.

## Interactions

### Area: Route Entry

**Open Voice route**

- Given: the route registry includes `/voice` as enabled placeholder.
- When: the user selects Voice or opens `/voice` directly.
- Then: render the placeholder, mark Voice active in `SidebarNav`, and persist last route.
- Error: if render fails, show Route Error Banner while shell remains mounted.

**Navigate back to Writer**

- Given: the placeholder is visible.
- When: user activates Back to Writer.
- Then: navigate to `/writer` and update active nav.
- Error: if Writer route fails, show Writer route error banner.

**Open Post Library**

- Given: placeholder offers a source-post path.
- When: user activates Open Post Library.
- Then: navigate to `/library` placeholder and update active nav.
- Error: if Library route fails, show route error banner.

### Area: Deferred Capability

**Read deferred note**

- Given: user lands on Voice during the shell epic.
- When: the placeholder renders.
- Then: copy must make clear this route is a placeholder and not a broken feature.
- Error: no disabled controls should appear that look like actionable extraction.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Route requested | Route module ready | Route enabled | Placeholder ready | Render `EmptyState` |
| Route requested | Route module loading | Lazy route | Loading | Show route-level `Skeleton` |
| Route requested | Route throws | Any | Route error | Show Route Error Banner |
| Placeholder ready | Navigate Writer | `/writer` enabled | Leaving route | Update URL |
| Placeholder ready | Navigate Library | `/library` enabled | Leaving route | Update URL |

Impossible states to prevent:

- Placeholder shows editable voice traits.
- Placeholder starts voice extraction.
- Backend unavailable prevents the route from rendering.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Route renders | Keep layout stable | Voice active marker appears | Instant | Focus moves to route heading |
| Action click | Use route links, not buttons pretending to save | URL and active nav update | Instant | Link has clear accessible name |
| Status changes | Do not rewrite placeholder content | TopStatusBar updates only | Instant | Polite status announcement |

## Modals and Panels

None.

## Forms

None. Voice extraction forms belong to the Voice Profile feature spec.

## Feedback and Recovery

- Immediate: route actions show focus/active states.
- Inline/component: no field errors.
- Page-level: Route Error Banner only for route render failure.
- System-level: no toasts.

Failure handling:

- Route render failure: show Route Error Banner with Retry.
- Backend unavailable: status bar reports it; placeholder remains usable.
- Future route disabled decision: if `/voice` is disabled instead of enabled, Sidebar Nav owns the disabled explanation.

## Content and Localization

- Primary content: `Voice` heading and placeholder explanation.
- Secondary content: action labels and future capability note.
- Tertiary content: none.
- Copy inventory: `Voice`, `Voice profile setup is not part of this shell pass.`, `Back to Writer`, `Open Post Library`.
- Truncation/wrapping: placeholder copy wraps within main content and does not exceed the shell width.
- Localization: no text is embedded in icons only; labels allow expansion.
- Content ownership: shell owns placeholder copy until Voice Profile feature replaces the page.

## Accessibility

- Keyboard navigation: route heading, primary action, secondary action.
- Focus management: on navigation to `/voice`, focus moves to page heading; on route action, focus moves to destination heading after render.
- Screen reader: placeholder should be announced as normal route content, not as an error.
- Landmarks: content sits inside App Shell `main`.
- Reduced motion: no required motion.

### Accessibility Test Notes

- Verify `/voice` is reachable from sidebar by keyboard.
- Verify active route uses `aria-current`.
- Verify placeholder copy is not announced as an error.
- Verify actions are reachable and navigate correctly.
- Verify 400 percent zoom keeps actions visible.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `PageHeader` | Route title | `title="Voice"` |
| `EmptyState` | Placeholder body | no illustration required |
| `Button` | Back to Writer or Open Post Library action | `secondary` or link-styled route action |
| `Badge` | Optional `Placeholder` or `Coming later` state | `info` or `uncertain` |
| `Alert` | Route Error Banner composition if route fails | `warning` or `danger` |
| `Skeleton` | Lazy route loading | route-level only |

## Handoff Notes

- Visual specs: keep the route simple and utilitarian; do not create a decorative coming-soon page.
- Interaction specs: route is URL-backed and navigable even without backend readiness.
- Content specs: do not claim voice extraction, confidence, traits, source examples, or manual overrides exist in this epic.
- Edge cases: direct URL, backend unavailable, route render failure, route disabled decision.
- Implementation dependencies: route registry, Sidebar Nav active state, App Shell route outlet, optional lazy-route skeleton.

## Open Questions

- Decision needed: should `/voice` be enabled as a placeholder from day one or hidden until the Voice Profile feature starts.
- Decision needed: should the primary placeholder action go to Writer or Post Library.
- Decision needed: should the placeholder include a short future-capability note or only a route title and action.
