# Screen: Top Status Bar

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Show local runtime readiness for the engine, deterministic scorer, Codex adapter, storage, and last run so the writer understands what is usable without leaving the current route.

## Route

Persistent region on all routes.

## Entry Points

- App Shell boot starts a readiness check.
- User clicks Retry from status or a route error.
- Settings save or readiness test triggers a status refresh.
- Backend recovery changes engine availability in the background.

## States

### Ideal State

- `TopStatusBar` displays compact readiness groups with visible text labels: engine ready, deterministic ready, Codex ready, storage ready, and last run freshness.
- Each group uses `Status Dot` plus `Badge` or compact text; color is never the only signal.
- Last run timestamp uses mono text and local formatting.
- Settings action is available for readiness details or repair.

### Empty State

- Before the first status response, all groups show `Checking`.
- If no last run exists, last run shows `No runs yet`.
- Empty does not block route content.

### Loading State

- While `GET /status` is pending, status groups show stable checking placeholders.
- Refresh action, if visible, uses `IconButton` with loading feedback and accessible label `Refresh status`.
- Loading is scoped to the status bar; route content remains interactive.

### Error State

- If `GET /status` times out or connection fails, engine shows `Engine unavailable`.
- If response parsing fails against `appStatusSchema`, show `Status invalid`.
- Retry and Settings actions are available.
- Error details can be logged for development but should not dominate the writer surface.

### Partial State

- Deterministic engine can be ready while Codex or storage is partial, unavailable, stale, or failed.
- Partial copy makes the usable path explicit: deterministic scoring and basic Writer generation may still work.
- Route-specific failures still appear inline in the route; status is summary, not replacement.

## Layout

```txt
TopStatusBar
|-- runtime group: Engine / Deterministic
|-- provider group: Codex
|-- storage group: Storage
|-- freshness group: Last run
|-- actions: Refresh, Settings
```

Components referenced: `TopStatusBar`, `Status Dot`, `Badge`, `Tooltip`, `IconButton`, `Button`, `Skeleton`.

## Interactions

### Area: Readiness Refresh

**Initial status check**

- Given: App Shell has mounted.
- When: the status hook starts.
- Then: call `GET /status` and show `Checking` labels.
- Error: classify timeout, connection refusal, server error, and invalid schema separately.

**Refresh status**

- Given: the status bar is visible.
- When: the user activates `Refresh status`.
- Then: retry `GET /status`, keep previous known status visible with a checking affordance, and update groups when the request resolves.
- Error: keep prior non-stale values when available and mark the failed group with recovery copy.

**Open Settings**

- Given: any status group is partial, failed, stale, or the user wants details.
- When: the user activates Settings.
- Then: navigate to `/settings` and preserve previous route context.
- Error: if Settings route fails, show route error while status bar remains mounted.

### Area: Status Details

**Show tooltip**

- Given: a compact status group has a tooltip.
- When: the user hovers or focuses the group.
- Then: show concise text with state, freshness, or next step.
- Error: no interactive content is placed inside the tooltip.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Idle | App shell mounted | Any | Checking | Call `GET /status` |
| Checking | Status success | All required subsystems ready | Ready | Update groups; polite announcement |
| Checking | Status success | Some subsystems degraded | Partial | Update groups; show Settings action |
| Checking | Request timeout | Any | Unavailable | Engine unavailable; Retry available |
| Checking | Parse failure | Any | Invalid | Status invalid; Retry available |
| Ready | Refresh | Any | Refreshing | Keep previous values; show refresh pending |
| Partial | Settings save triggers refresh | Any | Checking | Recheck readiness |

Impossible states to prevent:

- A group shown as both `Ready` and `Failed`.
- Status refresh clearing route-local user input.
- Error announcement repeating on every render with unchanged error state.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Status becomes ready | Update label and dot | `Engine ready` or equivalent visible text | Instant | Polite live announcement |
| Status becomes partial | Preserve usable-route messaging | Warning badge with text | Instant | Polite live announcement |
| Status becomes unavailable | Do not steal focus | Failed label and recovery actions | Instant | Assertive only if current route is blocked; otherwise polite |
| Refresh click | Prevent double-submit | Refresh icon loading, label unchanged | Until request settles | Button exposes busy state |

## Modals and Panels

None owned by the status bar. Detailed repair lives in Settings Route.

## Forms

None.

## Feedback and Recovery

- Immediate: Refresh button shows loading.
- Inline/component: each status group has text state.
- Page-level: none; route errors stay route-local.
- System-level: optional toast only when background recovery changes a previously failed status to ready.

Failure handling:

- Timeout or connection refused: message says local engine is not reachable; offer Retry and Settings.
- Invalid schema: message says status response is invalid; offer Retry; log parse details.
- Codex unavailable: message says deterministic engine remains available when true.
- Storage failed: status marks storage failed or stale and Settings can highlight storage path.

## Content and Localization

- Primary content: readiness labels for engine, deterministic scorer, Codex, storage.
- Secondary content: last run timestamp and freshness.
- Tertiary content: version, raw provider names, diagnostic details in tooltip or Settings.
- Copy inventory: `Checking`, `Ready`, `Partial`, `Unavailable`, `Failed`, `Stale`, `No runs yet`, `Refresh status`, `Open Settings`.
- Truncation/wrapping: compact groups can collapse to provider plus state on narrow screens; never hide all text and leave color alone.
- Localization: timestamps use local date/time formatting; labels allow text expansion without overlapping actions.
- Content ownership: shell owns status state labels; subsystem-specific repair guidance belongs to Settings copy.

## Accessibility

- Keyboard navigation: Refresh and Settings are reachable after the status summaries.
- Focus management: status updates do not move focus.
- Screen reader: status region exposes `aria-live="polite"` for non-blocking changes.
- Landmarks: status region is associated with the app header/status area, not nested inside route `main`.
- Reduced motion: no required animation; loading spinner can be replaced by static busy text.

### Accessibility Test Notes

- Verify status changes announce once per meaningful state transition.
- Verify color-blind and high-contrast users can identify ready, partial, failed, stale, and unavailable states from text.
- Verify keyboard users can refresh status and open Settings.
- Verify 400 percent zoom does not overlap status groups and actions.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `TopStatusBar` | Persistent readiness region | compact responsive layout |
| `Status Dot` | State indicator paired with text | `ready`, `running`, `partial`, `failed`, `stale`, `unavailable` |
| `Badge` | Compact state labels | `success`, `warning`, `danger`, `info`, `uncertain` |
| `IconButton` | Refresh action | `label="Refresh status"`, `tooltip` |
| `Button` | Settings action when space allows | `variant="ghost"` |
| `Tooltip` | Short status details | hover/focus text only |

## Handoff Notes

- Visual specs: status height should fit the shell header contract and compress before the main surface does.
- Interaction specs: `GET /status` must support retry, timeout classification, and schema validation.
- Content specs: state copy must describe usable partial states, not only failure.
- Edge cases: engine down, Codex down, storage stale, no last run, invalid status response, slow status response.
- Implementation dependencies: `GET /status`, `appStatusSchema`, API client timeout and parse handling, status hook, Settings route link.

## Open Questions

- Decision needed: exact timeout for classifying `/status` as unavailable in local development.
- Decision needed: whether status refresh should also run on an interval or only on boot/manual repair.
- Decision needed: whether to show the local engine URL directly in compact status copy or only in Settings.
