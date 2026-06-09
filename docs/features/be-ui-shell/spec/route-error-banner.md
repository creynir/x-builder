# Screen: Route Error Banner

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Provide route-local, recoverable error feedback that preserves user work and keeps the shell navigable when a backend request, route render, or readiness-dependent action fails.

## Route

Route-local banner within `main`, above the affected route content or panel.

## Entry Points

- App boot `/status` fails and the current route needs visible recovery.
- Writer generation fails because the local engine is unavailable.
- Route component throws.
- Settings save or readiness test fails.
- API client classifies a server, timeout, connection, validation, or schema error.

## States

### Ideal State

- No banner is visible.
- Prior errors are cleared after successful retry or navigation to an unaffected route.
- Route content remains the primary surface.

### Empty State

- No error exists, so the banner is absent.
- Layout reserves no permanent empty banner area.

### Loading State

- When retrying an operation, the banner remains visible with the Retry button in loading state.
- Existing route input and partial results remain visible.
- If a route component is reloading, route-level `Skeleton` may appear below the banner.

### Error State

- Banner uses `Alert` with `warning` or `danger` depending on severity.
- Copy names the failed operation and recovery path.
- Actions include Retry when retryable and Open Settings when configuration/readiness is relevant.
- Non-retryable validation errors should be shown next to fields instead of only in the banner.

### Partial State

- If partial data remains usable, the banner explains what failed while leaving completed work visible.
- Example: deterministic candidates are visible while Codex judge failed.
- Partial route errors should not escalate to a global shell blocker.

## Layout

```txt
main
|-- route header
|-- Route Error Banner (only when needed)
|   |-- icon/state
|   |-- title and message
|   |-- optional code/details disclosure
|   `-- actions: Retry, Open Settings, Dismiss where allowed
`-- route content preserved below
```

Components referenced: `Alert`, `Button`, `IconButton`, `Badge`, `Tooltip`, `Skeleton`, `Toast`.

## Interactions

### Area: Retry

**Retry failed operation**

- Given: an error has `retryable=true` or an operation-specific retry function.
- When: the user activates Retry.
- Then: call the same failed operation with the current route input preserved and show button loading.
- Error: if retry fails, update the same banner with the latest classification and keep focus in the banner action area.

**Retry route render**

- Given: a route component failed inside the route error boundary.
- When: the user activates Retry.
- Then: reset the route error boundary for the current route and attempt render again.
- Error: if render fails again, keep the banner and offer navigation elsewhere through the sidebar.

### Area: Settings Recovery

**Open Settings**

- Given: the error is caused by engine unavailable, storage unavailable, Codex unavailable, or settings invalid.
- When: the user activates Open Settings.
- Then: navigate to `/settings`, preserve the previous route, and pass recovery context if available.
- Error: if Settings fails to render, show its own route error banner.

### Area: Dismiss

**Dismiss non-blocking banner**

- Given: the error is non-blocking and route content remains usable.
- When: the user activates Dismiss.
- Then: hide the banner for the current error instance without clearing the underlying status.
- Error: blocking failures cannot be dismissed without retry, navigation, or repair.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Hidden | API failure | Retryable route error | Visible retryable | Show `Alert` with Retry |
| Hidden | Validation failure | Field-specific | Field error | Do not show route banner unless multiple fields or form-level issue |
| Visible retryable | Retry clicked | Operation still mounted | Retrying | Retry button loading; preserve content |
| Retrying | Retry success | Any | Hidden | Remove banner; optional success toast only for user-initiated repair |
| Retrying | Retry failed | Any | Visible retryable | Update message/details |
| Visible non-blocking | Dismiss clicked | Dismissible | Dismissed | Hide current banner |
| Any | Navigate route | Target route differs | Hidden or route-specific | Do not carry unrelated error to new route |

Impossible states to prevent:

- Banner retry clears the user's Writer idea.
- A field validation error appears only as a global banner.
- Multiple duplicate banners for the same failed request stack at the top of the route.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Banner appears for blocking route failure | Do not steal focus unless action was user-triggered and content is blocked | Error title, message, actions | Instant | Assertive announcement |
| Banner appears for non-blocking warning | Preserve focus | Warning title and recovery | Instant | Polite announcement |
| Retry succeeds | Remove banner | Route content remains | Instant | Announce recovery if prior state was blocking |
| Details disclosure opens | Show code/scope/details | Inline expanded row | No animation required | Disclosure has expanded state |

## Modals and Panels

None. Use inline details disclosure for diagnostics; repair lives in Settings Route.

## Forms

No standalone form. Field-level errors are owned by the route form that triggered them.

## Feedback and Recovery

- Immediate: Retry button loading; Dismiss `IconButton` active/focus states.
- Inline/component: field validation remains field-local.
- Page-level: route banner handles request, route render, and readiness-dependent failures.
- System-level: optional success toast after a manual retry recovers a previously blocking failure.

Failure handling:

- Connection refused or timeout: `Could not reach the local engine. Your work is still here.`
- Server error: show concise message plus code when available.
- Schema parse failure: show invalid response copy; log raw response for development.
- Route component throw: show route failed copy; offer Retry and navigation through sidebar.
- Settings-related error: include Open Settings action.

## Content and Localization

- Primary content: title naming what failed.
- Secondary content: recovery sentence and action labels.
- Tertiary content: error code, scope, retryable flag, raw details disclosure.
- Copy inventory: `Retry`, `Open Settings`, `Dismiss`, `Could not reach the local engine. Your work is still here.`, `Status response invalid.`, `This route could not render.`
- Truncation/wrapping: long error details wrap in a disclosure and do not push actions off-screen.
- Localization: error messages should be short; action labels should remain verbs.
- Content ownership: shell owns generic API and route recovery copy; route forms own field validation copy.

## Accessibility

- Keyboard navigation: banner actions are reachable in source order after the route heading.
- Focus management: after user-triggered failure, focus may move to the banner title for blocking errors; after retry, focus returns to the triggering control or first useful route control.
- Screen reader: blocking route errors use assertive announcement; non-blocking partial errors use polite.
- Landmarks: banner is inside `main` and associated with the affected route.
- Reduced motion: no required motion.

### Accessibility Test Notes

- Verify Retry is reachable and announces loading state.
- Verify screen readers hear the error title and recovery action.
- Verify dismissible warnings can be dismissed by keyboard.
- Verify 400 percent zoom keeps actions visible and text readable.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `Alert` | Banner body | `warning`, `danger`, or `info` for partial |
| `Button` | Retry and Open Settings | `secondary`, loading on retry |
| `IconButton` | Dismiss and details controls | required label and tooltip |
| `Badge` | Error scope or state | `warning`, `danger`, `uncertain` |
| `Toast` | Optional recovery confirmation | success can auto-dismiss |

## Handoff Notes

- Visual specs: banner is not a floating card; it is an inline route band using `Alert`.
- Interaction specs: retry reuses the failed operation and preserves route state.
- Content specs: copy must be specific enough for local dev repair without dumping raw stack traces.
- Edge cases: repeated failures, stale error after navigation, non-retryable validation, invalid API error shape, Settings route failure.
- Implementation dependencies: `apiErrorSchema`, API client error classification, route error boundary, retry callbacks, Settings navigation context.

## Open Questions

- Decision needed: how much raw error detail should be visible in this internal tool by default.
- Decision needed: should recovered errors show a success toast or simply remove the banner.
- Decision needed: should route component errors expose a `Report` action later, or only log to dev tooling for now.
