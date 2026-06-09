# Screen: Writer Route Shell Integration

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Wrap the existing Writer page in the App Shell so generation remains usable with typed backend calls, route-level loading/error recovery, preserved input, and global readiness visibility.

## Route

`/writer`

## Entry Points

- Default route from `/`.
- Sidebar Nav: Writer.
- Unknown route fallback.
- Back to Writer from Settings repair.
- Direct URL: `/writer`.

## States

### Ideal State

- Writer route renders inside `AppShell` with `TopStatusBar` and `SidebarNav`.
- Existing idea input remains the main task.
- Generate action calls typed `/ideas/generate` through the API client.
- Successful response renders exactly three first-pass candidates from the current backend contract.
- Shell status remains visible while generation runs.

### Empty State

- Idea textarea is empty.
- Generate is disabled or validation prevents submit.
- Empty copy prompts the user to paste a raw idea without becoming a marketing or landing page.
- No backend request is made until valid input exists.

### Loading State

- User-submitted generation shows loading on the Generate button and candidate-shaped `Skeleton` in the result area.
- Idea input remains visible and, if feasible, editable without losing submitted value.
- Top Status Bar may independently show checking/partial states.

### Error State

- Connection or timeout failure shows Route Error Banner with copy that the idea is preserved.
- Validation failure from request schema appears field-local near the idea input.
- Server or schema errors show route banner with Retry.
- Existing typed idea remains intact through failures.

### Partial State

- Deterministic generation can succeed while Codex readiness is partial or unavailable.
- Writer route should still render deterministic candidates and let the user copy/select when available.
- Judge-specific partial states belong to later writer/LLM judge specs; this shell spec only protects the route boundary.

## Layout

```txt
AppShell main
|-- PageHeader: Writer
|-- Route Error Banner slot
|-- WriterPage existing content
|   |-- idea input and generate controls
|   `-- candidate/result area
```

Components referenced: `PageHeader`, `Textarea`, `Button`, `Alert`, `Skeleton`, `Badge`, `Toast`, `CandidateCard` when the writer feature owns it.

## Interactions

### Area: Route Entry

**Open Writer route**

- Given: user opens `/writer`, `/`, or an unknown-route fallback.
- When: App Shell resolves Writer.
- Then: render Writer content inside shell, mark Writer active, and focus the route heading or idea input according to navigation source.
- Error: if Writer component throws, show Route Error Banner while shell remains mounted.

**Back from Settings**

- Given: user opened Settings from Writer recovery.
- When: user activates Back to Writer.
- Then: return to `/writer` and preserve in-memory idea input if the route was kept mounted or restored from route state.
- Error: if state cannot be restored, show empty Writer state without treating it as data loss.

### Area: Generate

**Submit valid idea**

- Given: idea text passes client validation.
- When: user clicks Generate or submits with documented keyboard shortcut if implemented.
- Then: call `POST /ideas/generate` with `generateIdeaRequestSchema`, show loading, and render three candidates on success.
- Error: route banner for backend/server/schema errors; field error for validation errors.

**Retry generation**

- Given: generation failed after a valid idea submission.
- When: user activates Retry in the Route Error Banner.
- Then: resend the same request payload and keep idea text unchanged.
- Error: update the same banner with the latest error.

**Edit after failure**

- Given: generation failed and idea text is preserved.
- When: user edits the idea.
- Then: keep banner until dismissed or until a new successful submit clears it; validation updates field-local errors.
- Error: no backend request is sent solely because of editing.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Empty | User types | Idea has non-whitespace content | Draft ready | Enable Generate when valid |
| Draft ready | Generate | Client validation passes | Generating | Button loading; result skeleton |
| Draft ready | Generate | Client validation fails | Validation error | Field error; no request |
| Generating | Response success | Response matches schema | Candidates ready | Render three candidates |
| Generating | Connection/timeout | Any | Backend error | Banner with Retry and Settings |
| Generating | 4xx validation | Any | Validation error | Field-local error |
| Generating | 5xx or parse failure | Any | Route error | Banner with Retry |
| Backend error | Retry | Payload exists | Generating | Resend same payload |
| Candidates ready | Status changes partial | Codex/storage failed | Partial | Keep candidates visible; status explains degradation |

Impossible states to prevent:

- Generate request clears the idea before success.
- Backend unavailable disables the whole shell.
- Validation error appears only as a route banner.
- Candidate count differs from the schema without an explicit schema error.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Idea input changes | Keep label visible | Character count if implemented | Immediate | Textarea associated with helper/error text |
| Generate click | Preserve form size | Button loading; result skeleton | Until response settles | Busy state on button/form region |
| Generate success | Clear route error for generation | Candidates appear | No decorative motion required | Announce candidate region update politely |
| Generate failure | Preserve idea and prior candidates if any | Banner appears above route content | Instant | Blocking generation error announced assertively if user-triggered |

## Modals and Panels

None owned by shell integration. Candidate detail, judge inspector, evidence drawer, and save dialogs belong to later writer feature specs.

## Forms

### Idea Generation Form

| Field | Type | Required | Validation | Error Message |
|---|---|---|---|---|
| Idea | textarea | Yes | Non-empty text; backend enforces `generateIdeaRequestSchema` | `Enter an idea before generating.` |
| Voice profile id | hidden/select later | No | Must match backend schema when supplied | `Choose a valid voice profile.` |
| Known post ids | hidden/multi-select later | No | Must match backend schema when supplied | `Choose valid known posts.` |

- Validation timing: required idea on submit; optional blur validation for empty input.
- Submit behavior: call `/ideas/generate`, render candidates.
- Submit error: field-local for validation; route banner for backend and schema errors.
- Unsaved changes: typed idea should be preserved in route state where feasible, but no browser-level warning is required for a plain draft idea in this epic.

## Feedback and Recovery

- Immediate: Generate button disabled/loading states.
- Inline/component: idea validation error under textarea.
- Page-level: Route Error Banner for backend/server/schema failure.
- System-level: optional toast for copy/save actions belongs to later writer specs.

Failure handling:

- Local engine unavailable: show banner with Retry and Open Settings; idea remains.
- Timeout: same as unavailable with timeout wording.
- Validation rejected by backend: map to field error if scope is idea; otherwise show route banner.
- Invalid response schema: show route banner and log parse details.

## Content and Localization

- Primary content: idea input and generated candidate text.
- Secondary content: helper text, validation copy, loading copy, recovery copy.
- Tertiary content: idea id, candidate ids, deterministic score metadata in later writer specs.
- Copy inventory: `Writer`, `Generate`, `Enter an idea before generating.`, `Could not reach the local engine. Your idea is still here.`, `Retry`, `Open Settings`.
- Truncation/wrapping: idea text and generated candidate text wrap; long words break safely.
- Localization: textarea and candidate text support multiline content; shortcuts are not the only way to submit.
- Content ownership: shell owns route recovery copy; writer feature owns generation and candidate content copy.

## Accessibility

- Keyboard navigation: route heading, idea textarea, Generate, banner actions, and candidate results follow logical order.
- Focus management: after generate success, focus remains on Generate or moves to results only if explicitly documented; after failure, focus may move to banner for user-triggered blocking errors.
- Screen reader: candidate results announce politely; generation failure announces assertively when user-triggered.
- Landmarks: Writer content sits inside App Shell `main`.
- Reduced motion: skeletons and loading indicators do not rely on animation.

### Accessibility Test Notes

- Verify keyboard-only idea entry, submit, failure retry, and Settings recovery.
- Verify idea validation error is associated with the textarea.
- Verify backend failure preserves input and announces the recovery action.
- Verify generated candidates are announced as a region update.
- Verify Writer route remains reachable while status is partial or failed.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `PageHeader` | Route title | `title="Writer"` |
| `Textarea` | Idea input | `state`, `helperText`, `errorText`, optional `charCount` |
| `Button` | Generate | `primary`, loading |
| `Alert` | Route Error Banner | `warning` or `danger` |
| `Skeleton` | Candidate/result loading | candidate-shaped |
| `Badge` | Partial deterministic/Codex state if needed | `warning`, `uncertain`, `info` |
| `CandidateCard` | Candidate rendering when implemented | owned by writer feature |

## Handoff Notes

- Visual specs: keep Writer as the work surface, not a landing page; shell adds frame and recovery only.
- Interaction specs: generation uses typed API client and preserves idea input on failure.
- Content specs: do not imply Codex judge output exists in this shell integration spec.
- Edge cases: empty idea, backend stopped, timeout, invalid response schema, route error, Settings round trip.
- Implementation dependencies: route registry, `WriterPage` route wrapper, API client, `generateIdeaRequestSchema`, `generateIdeaResponseSchema`, Route Error Banner, status hook.

## Open Questions

- Decision needed: should `/writer` draft idea persist across full page reload in this epic or only in memory.
- Decision needed: should `Cmd+Enter` submit the Writer form in the first shell implementation.
- Decision needed: should previous successful candidates remain visible after a later generation failure.
