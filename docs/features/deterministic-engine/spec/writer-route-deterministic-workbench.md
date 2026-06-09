# Screen: Writer Route Deterministic Workbench

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Extend the Writer route so the user can generate, score, compare, and revise post candidates with deterministic feedback before Codex judge or X integration exists.

## Route

`/writer`

## Entry Points

- Sidebar Nav: Writer.
- Default app route.
- Back to Writer from Settings repair.
- Retry after generation or scoring failure.

## States

### Ideal State

- The route shows idea input, manual scoring context, candidate comparison board, and optional detail inspector.
- User has supplied follower count or intentionally disabled prediction.
- Generate creates three candidates and attaches deterministic analysis to each.
- Candidate cards show text, format, heuristic score, check counts, and prediction state.
- Selected candidate opens the Deterministic Detail Inspector.

### Empty State

- Idea textarea is empty.
- Generate is disabled or submit validates with field-local copy.
- Manual Scoring Context Panel invites the user to add follower count, but Post Coach can still run later without it.
- Candidate board uses `EmptyState` with one recovery action: focus idea input.

### Loading State

- Generate button shows loading while `/ideas/generate` runs.
- Candidate board shows three candidate-shaped `Skeleton` blocks.
- If generation completes before scoring, candidate text appears with score skeletons.
- Manual context panel stays interactive unless a follower value is currently being saved.

### Error State

- Empty/invalid idea shows field error under the textarea.
- Generation failure shows Route Error Banner and preserves idea text.
- Scoring failure keeps candidate text visible and shows score retry warning in the board.
- Invalid response/schema failure shows Route Error Banner and logs parse details.

### Partial State

- Codex unavailable: deterministic candidates remain visible.
- Followers missing: Post Coach and score checks render; Engagement Prediction shows disabled/missing-context state.
- Some candidate scores fail: candidates remain visible, failed cards show retry affordance.
- Stale score: editing idea/draft after scoring marks results as stale until regeneration/rescore.

## Layout

```txt
AppShell main
|-- PageHeader: Writer
|-- Route Error Banner slot
|-- Writer deterministic workbench
|   |-- left/control column
|   |   |-- Idea textarea + Generate
|   |   `-- Manual Scoring Context Panel
|   |-- main candidate board
|   |   |-- Candidate Deterministic Summary x3
|   |   `-- empty/loading/error states
|   `-- right inspector
|       `-- Deterministic Detail Inspector
```

Components referenced: `PageHeader`, `Textarea`, `Button`, `Alert`, `EmptyState`, `Skeleton`, `CandidateCard`, `ScoreBar`, `Badge`, `Drawer`, `Toast`.

## Interactions

### Area: Idea Input

**Type idea**

- Given: the Writer route is open.
- When: user types into the idea textarea.
- Then: Generate becomes available once text is non-empty and under schema limits.
- Error: if text exceeds the limit, show field-local error and keep Generate disabled.

**Generate candidates**

- Given: idea passes client validation.
- When: user clicks `Generate`.
- Then: call generation, show loading, render candidates, then render deterministic summaries.
- Error: show route banner for generation failure; show score-level warning for scoring failure.

**Retry generation**

- Given: generation failed and a valid payload exists.
- When: user clicks Retry in Route Error Banner.
- Then: resend the same payload and preserve the idea.
- Error: update the same banner.

### Area: Candidate Board

**Select candidate**

- Given: one or more candidates are rendered.
- When: user clicks a candidate or its Details action.
- Then: mark candidate selected and open/update the Deterministic Detail Inspector.
- Error: if analysis is missing, inspector opens in retryable warning state.

**Retry score**

- Given: candidate text exists but deterministic analysis failed.
- When: user clicks `Retry score`.
- Then: rerun score composition for that candidate without regenerating text.
- Error: keep candidate text and update warning.

### Area: Manual Context

**Apply followers**

- Given: follower count field contains a valid positive integer.
- When: user clicks Apply.
- Then: update route context and recompute prediction ranges for visible scored candidates.
- Error: invalid input remains field-local; candidate text and Post Coach are unaffected.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Empty | Type idea | valid text | Draft ready | Enable Generate |
| Draft ready | Generate | generation request starts | Generating | Button loading, skeleton candidates |
| Generating | Candidates returned | scoring starts | Scoring | Candidate text visible, score skeleton |
| Scoring | All scores succeed | followers present | Scored with prediction | Render summaries and prediction |
| Scoring | All scores succeed | followers absent | Scored without prediction | Missing-context badge |
| Scoring | Some scores fail | candidate text exists | Partial scored | Per-card retry |
| Any | Engine failure | retryable | Route error | Route Error Banner |
| Scored | Idea edited | text differs from run payload | Stale | Stale badge; Generate again |

Impossible states to prevent:

- Candidate text disappears because scoring failed.
- Prediction range appears without visible follower source.
- Codex judge unavailable blocks deterministic score display.
- Generate and score retries are conflated.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Generate click | Keep layout dimensions stable | button spinner and candidate skeletons | until request settles | `aria-busy` on form and results |
| Score success | Do not animate large layout shifts | score bar fills or appears | 150-200ms max | polite announcement for scored candidates |
| Follower apply | Recompute prediction only | prediction badge changes to manual context | immediate | field remains focused or Apply button returns focus |
| Candidate select | Selection outranks judge/advisory states | selected outline | 150ms | `aria-selected` or equivalent label |

## Modals And Panels

### Deterministic Detail Inspector

- Trigger: Details action or candidate selection.
- Content: Post Coach card, Engagement Prediction card, analysis metadata.
- Actions: Close, Retry score when needed, Enter followers when prediction disabled.
- Focus management: focus moves to inspector heading on drawer open; desktop persistent inspector may leave focus on trigger if content updates inline.
- Keyboard: Escape closes drawer mode; Tab order remains within drawer when modal/drawer overlays content.
- Dismiss: Close button, Escape in drawer mode.
- Focus return: details trigger for the selected candidate.

## Forms

### Idea Generation Form

| Field | Type | Required | Validation | Error Message |
|---|---|---|---|---|
| Idea | textarea | Yes | 1-4000 chars after trim | `Enter an idea before generating.` |

- Validation timing: on submit; clear error on edit.
- Submit behavior: call generation and score composition.
- Submit error: field-local for validation, route banner for request/response failure.
- Unsaved changes: no browser unload warning; preserve in route state where feasible.

## Feedback And Recovery

- Immediate: button loading, field validation, candidate selected outline.
- Inline/component: score retry warning, missing-context badge, stale score badge.
- Page-level: Route Error Banner for generation/API failure.
- System-level: copy/save toasts belong to writer actions after this feature.

Failure handling:

- Missing followers: do not block score; disable only prediction.
- Score API failure: retry score without regenerating.
- Generation failure: retry generation with same payload.
- Status unavailable: use existing shell recovery path.

## Content And Localization

- Primary content: idea text, candidate text, deterministic score.
- Secondary content: helper copy, score labels, context labels.
- Tertiary content: format, prediction confidence, analysis timestamp.
- Copy inventory: `Writer`, `Generate`, `Heuristic rank, not prediction.`, `Manual account context`, `Prediction needs follower count.`, `Retry score`, `Score stale`.
- Truncation/wrapping: candidate text preserves line breaks and long words wrap.
- Localization: follower numbers use locale formatting in display, raw numeric input accepts plain digits.
- Content ownership: deterministic feature owns score/prediction copy; shell owns route recovery copy.

## Accessibility

- Keyboard navigation: route header, idea input, Generate, manual context, candidates, details action, inspector.
- Focus management: user-triggered errors move focus to banner/field only when needed; candidate detail drawer returns focus to trigger.
- Screen reader: candidate board uses polite live region for generated/scored results.
- Landmarks: content lives inside App Shell `main`; inspector uses `aside` or drawer dialog semantics.
- Reduced motion: score bar transitions disabled or reduced.

### Accessibility Test Notes

- Generate and retry with keyboard only.
- Confirm score updates are announced once per completion, not every numeric change.
- Verify missing follower error is associated with input.
- Verify selected candidate state is not color-only.
- Verify 200% zoom keeps controls visible.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `PageHeader` | route title | `title="Writer"` |
| `Textarea` | idea input | helper/error text, min/max rows |
| `Button` | Generate, retry | `primary`, `secondary`, loading |
| `Alert` | route and score warnings | `warning`, `danger` |
| `EmptyState` | empty candidate board | action focuses idea |
| `Skeleton` | generation/scoring loading | candidate-shaped |
| `CandidateCard` | candidate surface | selected, deterministic-only |
| `ScoreBar` | heuristic score | method `heuristic` |
| `Badge` | format, missing context, confidence | `info`, `warning`, `uncertain` |
| `Drawer` | detail inspector on narrow viewports | focus trap |
| `Toast` | later copy/save success | success/undo |

## Handoff Notes

- Visual specs: dense ops-console layout, no landing page or decorative score dashboard.
- Interaction specs: score retry and generation retry are separate actions.
- Content specs: always show heuristic/prediction caveat near scores.
- Edge cases: missing followers, short text, stale scores, partial scores, Codex unavailable, schema mismatch.
- Implementation dependencies: score schema/API, candidate analysis attachment, manual context state, Post Coach and Prediction components.

## Open Questions

- Endpoint shape: one scored generation response or separate analyze endpoint?
- Does follower count persist globally, per route, or per run?
- Should same-route draft scoring share the idea textarea or use a selected candidate editor?
