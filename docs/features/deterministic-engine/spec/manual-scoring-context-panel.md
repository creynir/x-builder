# Screen: Manual Scoring Context Panel

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Collect the minimum manual account context needed to make deterministic engagement ranges honest before X integration exists.

## Route

Panel within `/writer`.

## Entry Points

- Visible in Writer controls when no follower count is stored for the current run.
- Recovery CTA from disabled Engagement Prediction card.
- Future Settings default can prefill this panel.

## States

### Ideal State

- Follower count is present, valid, and labeled as manual.
- Panel shows the applied value, source (`Manual`), and last applied time for this route session if available.
- Prediction cards for visible candidates use this value.
- Optional advanced AI rating is hidden or collapsed.

### Empty State

- Follower count field is empty.
- Panel explains that Post Coach can run without it, but impression range needs account size.
- Primary action: Apply followers.
- Secondary action: Continue without prediction.

### Loading State

- If follower count is persisted, Apply button shows loading.
- If route-local only, applying is instant and no spinner is needed.
- Candidate predictions can show small skeletons while recomputing.

### Error State

- Invalid follower value shows field error.
- Persistence failure shows panel-level warning but keeps the route-local value available for current scoring if safe.
- Settings read failure does not block manual entry.

### Partial State

- Route has follower count but no persisted default.
- A Settings default exists but differs from current run value.
- AI rating is available from a later judge, but manual field is not exposed.

## Layout

```txt
Manual Scoring Context Panel
|-- header: Manual account context + badge Manual
|-- helper copy: prediction needs follower count
|-- input row: followers input + Apply
|-- secondary row: Continue without prediction / use Settings default
`-- optional advanced disclosure: AI rating (deferred)
```

Components referenced: `Input`, `Button`, `Badge`, `Alert`, `Tooltip`, `KeyValueList`.

## Interactions

### Area: Follower Count

**Enter followers**

- Given: panel is empty or editing.
- When: user types digits into the follower count field.
- Then: field accepts positive integers and formats display outside editing.
- Error: non-numeric, zero, negative, or unsafe values show inline error.

**Apply followers**

- Given: follower count is valid.
- When: user clicks Apply or presses Enter from the field.
- Then: save/apply route context and recompute prediction ranges for visible candidates.
- Error: persistence failure shows warning; route-local apply can still proceed if architecture allows.

**Continue without prediction**

- Given: no follower count is supplied.
- When: user activates Continue without prediction.
- Then: panel collapses to missing-context badge; Post Coach remains available and prediction stays disabled.
- Error: none.

### Area: Settings Default

**Use default**

- Given: Settings has a stored follower default and current run differs.
- When: user activates Use default.
- Then: update current run context and recompute predictions.
- Error: if Settings cannot load, show panel warning and keep manual input.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Empty | Type followers | invalid | Editing invalid | Inline error |
| Empty | Type followers | valid | Editing valid | Apply enabled |
| Editing valid | Apply | route-local | Applied | Predictions recompute |
| Editing valid | Apply | persist requested | Saving | Button loading |
| Saving | Persist success | any | Applied | Manual badge, timestamp |
| Saving | Persist fail | route value usable | Applied partial | Warning, predictions recompute |
| Empty | Continue without prediction | any | Skipped | Prediction disabled badge |

Impossible states to prevent:

- Prediction shown with no visible follower source.
- Invalid follower value saved as default.
- Continue without prediction disables Post Coach.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Field focus | Select existing numeric text only if user entered edit mode | focus ring | immediate | visible label stays present |
| Apply success | Keep panel size stable | small success text or badge | quiet, no toast needed | polite status |
| Invalid value | Do not clear input | red border + text | immediate on submit/blur | error associated by `aria-describedby` |
| Prediction recompute | No page jump | prediction card updates range | 150ms max | polite announcement |

## Modals And Panels

No child modal required day one. Advanced AI rating can be a disclosure within this panel, not a dialog.

## Forms

### Manual Account Context Form

| Field | Type | Required | Validation | Error Message |
|---|---|---|---|---|
| Followers | number/text input | Required for prediction only | Positive integer, recommended max validated by architecture | `Enter your current follower count to estimate impressions.` |
| AI rating | number/slider | No, deferred | 1-10 if exposed | `Use a rating from 1 to 10.` |

- Validation timing: on blur and submit.
- Submit behavior: apply context and recompute predictions.
- Submit error: field-local for validation; panel warning for persistence.
- Unsaved changes: leaving the panel with typed but unapplied value should either apply on Enter/click or show a small dirty state.

## Feedback And Recovery

- Immediate: input validation and Apply enabled/disabled.
- Inline/component: missing followers badge, invalid value error.
- Panel-level: persistence warning or Settings default mismatch.
- System-level: none required.

Failure handling:

- Settings unavailable: allow route-local manual entry.
- Invalid followers: keep Post Coach available, block prediction only.
- Recompute failure: show prediction card warning, do not clear context.

## Content And Localization

- Primary content: follower count.
- Secondary content: manual source, helper copy, skipped state.
- Tertiary content: last applied timestamp, future settings source.
- Copy inventory: `Manual account context`, `Followers`, `Apply`, `Continue without prediction`, `Prediction needs follower count.`, `Manual`.
- Truncation/wrapping: helper copy wraps; controls keep fixed height.
- Localization: display follower count with locale separators; input accepts plain digits.
- Content ownership: deterministic feature owns this copy; Settings owns default configuration copy later.

## Accessibility

- Keyboard navigation: panel header, input, Apply, Continue without prediction, optional disclosure.
- Focus management: invalid submit keeps focus on followers input.
- Screen reader: missing-context state and apply success announced politely.
- Landmarks: panel can be `section` with visible heading.
- Reduced motion: prediction update does not rely on animated number changes.

### Accessibility Test Notes

- Validate field error association.
- Confirm Continue without prediction is reachable and not hidden behind hover.
- Confirm prediction disabled state names the recovery field.
- Confirm number formatting does not change focused input unexpectedly.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `Input` | follower count | numeric text input, helper/error |
| `Button` | Apply, continue | `primary` for Apply, `ghost` or `secondary` for skip |
| `Badge` | manual/source/skipped state | `info`, `uncertain` |
| `Alert` | persistence warning | `warning` |
| `Tooltip` | explain manual source if compact | text-only |
| `KeyValueList` | applied context summary | followers, source, updated |

## Handoff Notes

- Visual specs: small dense panel, not a settings page.
- Interaction specs: route-local apply must be possible even if Settings persistence is not ready.
- Content specs: never imply X is connected.
- Edge cases: zero followers, huge values, changed Settings default, skipped prediction.
- Implementation dependencies: manual context state, optional settings field, prediction recompute hook.

## Open Questions

- Should follower default be added to `appSettingsSchema` in this feature?
- What max follower value should validation allow before warning?
- Is "Continue without prediction" sticky for the session or per run?
