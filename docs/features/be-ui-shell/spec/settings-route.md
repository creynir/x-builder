# Screen: Settings Route

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Expose shell-owned readiness and persistence settings so the user can inspect, edit, save, and test the local engine, Codex adapter labels/toggles, and storage boundary.

## Route

`/settings`

## Entry Points

- Sidebar Nav: Settings.
- Top Status Bar: Settings action from any partial or failed status.
- Route Error Banner: Open Settings after backend, storage, or Codex failure.
- Direct URL: `/settings`.

## States

### Ideal State

- Page shows current saved settings and readiness summary.
- Editable fields include engine URL, storage path, and readiness-related Codex command labels or toggles.
- Save button is disabled until settings are dirty and valid.
- Test readiness action calls the status boundary and updates Top Status Bar.
- If opened from a route error, show an explicit `Back to Writer` or `Back to previous route` action.

### Empty State

- No persisted settings exist.
- Form loads documented defaults and labels them as defaults.
- Primary action is `Save settings`.
- Readiness summary can still show checking or unavailable states.

### Loading State

- Settings load shows section-shaped `Skeleton` rows; the shell and nav remain interactive.
- Save action uses button loading and keeps form values visible.
- Readiness test uses button loading and updates only status/test result areas.

### Error State

- Settings load failure shows an `Alert` with Retry and Use defaults.
- Field validation errors appear next to fields with explicit labels.
- Save failure keeps dirty values visible and leaves the save bar active.
- Readiness test failure appears in the readiness section and updates `TopStatusBar` if applicable.

### Partial State

- Saved settings can be valid while readiness remains partial.
- Codex unavailable with deterministic engine ready is partial, not total failure.
- Storage path invalid or not writable highlights the storage field while leaving other settings editable.

## Layout

```txt
Settings Route
|-- PageHeader: Settings, optional Back to Writer
|-- Route Error Banner slot
|-- Readiness summary section
|-- Local engine section
|-- Codex adapter section
|-- Storage section
|-- Writer defaults / feature toggles section if shell-owned
`-- sticky or inline save actions
```

Components referenced: `PageHeader`, `Alert`, `Input`, `Switch`, `Button`, `IconButton`, `Badge`, `KeyValueList`, `Skeleton`, `Toast`.

## Interactions

### Area: Load Settings

**Load saved settings**

- Given: Settings route renders.
- When: settings boundary is available.
- Then: populate fields from persisted settings or defaults.
- Error: show load error with Retry and Use defaults.

**Use defaults**

- Given: persisted settings cannot load or do not exist.
- When: user activates Use defaults.
- Then: populate default engine URL, default storage path, and default Codex readiness toggles; mark form dirty if these need saving.
- Error: if defaults are unavailable, show development error copy and keep route usable.

### Area: Edit And Save

**Edit field**

- Given: settings loaded.
- When: user changes an input or switch.
- Then: mark form dirty, enable Save when validation passes, and keep Top Status Bar unchanged until save/test.
- Error: invalid fields show inline errors on blur and submit.

**Save settings**

- Given: form is dirty and validation passes.
- When: user activates Save settings.
- Then: persist through settings boundary, clear dirty state, and optionally trigger readiness refresh.
- Error: keep values, show save failure near actions, and keep Save enabled.

**Navigate away with unsaved changes**

- Given: form is dirty.
- When: user attempts sidebar navigation or browser navigation.
- Then: warn about unsaved changes according to router/browser capabilities.
- Error: if the user confirms leave, discard unsaved settings for that session.

### Area: Test Readiness

**Test readiness**

- Given: settings are saved or the implementation supports testing current draft values.
- When: user activates Test readiness.
- Then: call readiness/status boundary, update readiness summary and Top Status Bar.
- Error: show specific repair copy for engine timeout, Codex timeout, storage not writable, or invalid status schema.

**Back to Writer**

- Given: Settings was opened from a Writer route error or status repair flow.
- When: user activates Back to Writer.
- Then: navigate to `/writer` without auto-returning after save.
- Error: if Writer route fails, show route error banner in Writer outlet.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Route mounted | Settings load starts | Any | Loading | Section skeletons |
| Loading | Load success | Persisted config exists | Clean | Populate fields |
| Loading | No persisted config | Defaults available | Empty defaults | Populate defaults |
| Loading | Load failure | Any | Load error | Show Alert with Retry |
| Clean | Field changed | Any | Dirty | Enable validation/save logic |
| Dirty | Submit | Invalid | Dirty invalid | Show field errors |
| Dirty | Submit | Valid | Saving | Save button loading |
| Saving | Save success | Any | Clean | Clear dirty; refresh status |
| Saving | Save failure | Any | Dirty save error | Keep values and show Alert |
| Clean or Dirty | Test clicked | Any | Testing | Test button loading |
| Testing | Test partial | Any | Partial | Update summary and status |
| Testing | Test failed | Any | Readiness error | Highlight affected section |

Impossible states to prevent:

- Save success clears user values but persistence actually failed.
- Dirty form navigates away silently.
- Readiness partial is shown as all failed when deterministic engine is usable.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Field blur | Validate shape-sensitive fields | Inline helper or error text | Immediate after blur | Error associated with field |
| Save click | Preserve form dimensions | Button loading, actions disabled as needed | Until save settles | Busy state announced |
| Save success | Clear dirty bar | Optional `Toast`: `Settings saved` | Auto-dismiss success | Toast reachable if action exists |
| Test readiness | Do not clear fields | Readiness row updates | Until request settles | Status change announced politely |

## Modals and Panels

No modal required for the main flow. If unsaved changes use a custom dialog instead of browser prompt, it must:

- Trigger on attempted navigation.
- Content: name that settings are unsaved.
- Actions: Leave without saving, Stay on Settings.
- Focus management: focus first safe action on open.
- Keyboard: Escape closes and keeps user on Settings.
- Dismiss: overlay or Escape equals Stay.
- Focus return: return to the navigation item or control that initiated navigation.

## Forms

### Shell Settings Form

| Field | Type | Required | Validation | Error Message |
|---|---|---|---|---|
| Engine URL | url/text input | Yes | Valid local HTTP URL or approved dev URL | `Enter a valid local engine URL.` |
| Storage path | text input | Yes | Non-empty path; writable check during readiness test | `Enter a storage path the app can use.` |
| Codex command label | text input | No | 1-80 chars when provided | `Keep the label under 80 characters.` |
| Run Codex judge after generation | switch | No | Boolean | Not applicable |
| Show deterministic details | switch | No | Boolean | Not applicable |

- Validation timing: URL/path shape on blur and submit; writability during readiness test.
- Submit behavior: save settings, clear dirty state, refresh status.
- Submit error: keep inline values and show save error near actions.
- Unsaved changes: warn before route changes and browser unload where supported.

## Feedback and Recovery

- Immediate: inputs, switches, and buttons respond directly.
- Inline/component: validation errors sit under fields.
- Page-level: load/save/readiness failures use `Alert`.
- System-level: success toast after manual save.

Failure handling:

- Load failure: Retry and Use defaults.
- Invalid engine URL: field error prevents save.
- Save failure: keep dirty values and retry action.
- Codex timeout: show partial readiness and explain deterministic engine remains available.
- Storage not writable: highlight storage path and offer Test again after edit.

## Content and Localization

- Primary content: settings fields and current readiness summary.
- Secondary content: helper text explaining local engine, Codex judge, storage path.
- Tertiary content: version, last status check, provider labels, error codes in details.
- Copy inventory: `Settings`, `Save settings`, `Test readiness`, `Use defaults`, `Back to Writer`, `Engine URL`, `Storage path`, `Run Codex judge after generation`, `Show deterministic details`.
- Truncation/wrapping: paths wrap or truncate with tooltip/copy action; labels remain visible.
- Localization: field labels allow expansion; path and URL values remain LTR/mono within RTL contexts.
- Content ownership: shell owns settings labels and validation copy for shell-owned fields.

## Accessibility

- Keyboard navigation: PageHeader actions, form fields, switches, Save, Test readiness, and Back action are reachable in order.
- Focus management: route load focuses page heading; validation failure moves focus to first invalid field summary or field.
- Screen reader: errors are associated through `aria-describedby`; save/test results announce through polite region.
- Landmarks: form is inside `main` with section headings.
- Reduced motion: no required motion.

### Accessibility Test Notes

- Verify keyboard-only edit, save, test readiness, and back flow.
- Verify invalid fields are announced with label and error text.
- Verify dirty navigation warning is reachable and understandable.
- Verify 400 percent zoom preserves field labels, values, and save actions.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `PageHeader` | Route title and back action | `title="Settings"` |
| `Input` | Engine URL, storage path, Codex label | `state`, `helperText`, `errorText` |
| `Switch` | Shell-owned toggles | Boolean settings |
| `Button` | Save, Test readiness, Use defaults, Back | `primary`, `secondary`, `ghost` |
| `Alert` | Load, save, readiness errors | `warning`, `danger`, `info` |
| `KeyValueList` | Readiness metadata | provider/status/version |
| `Badge` | Readiness states | semantic variants |
| `Skeleton` | Load settings | section skeletons |
| `Toast` | Settings saved | success |

## Handoff Notes

- Visual specs: use functional settings sections, not nested cards; keep density aligned with product screens.
- Interaction specs: save is explicit; successful Settings repair does not auto-return.
- Content specs: Settings must not imply ChatGPT subscription routing is available.
- Edge cases: no persisted settings, load failure, invalid URL, unwritable storage, Codex timeout, dirty navigation.
- Implementation dependencies: `appSettingsSchema`, settings persistence boundary, `/status`, `appStatusSchema`, API client, previous-route context.

## Open Questions

- Decision needed: should engine URL be configurable if the app always runs on a fixed local engine URL.
- Decision needed: should settings persistence start in local storage or a backend/file boundary.
- Decision needed: should Test readiness use unsaved draft values or require Save first.
