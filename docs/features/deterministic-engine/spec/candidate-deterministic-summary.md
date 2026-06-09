# Screen: Candidate Deterministic Summary

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Show each candidate's deterministic score and explanation summary directly on the comparison board so the writer can compare without opening every detail view.

## Route

Component region within `/writer`.

## Entry Points

- Generated candidate card after `/ideas/generate`.
- Score retry result for a candidate.
- Selection state updates from the detail inspector.

## States

### Ideal State

- Candidate text is the primary read.
- Format badge and heuristic score are visible.
- `ScoreBar` shows numeric value, band, and `Heuristic rank, not prediction.`
- Summary shows failed/warned/passed counts and top one or two reasons/risks.
- Prediction status shows range if followers exist or missing-context badge if not.
- Details action opens Deterministic Detail Inspector.

### Empty State

- No candidate card exists until generation succeeds.
- Candidate board handles empty state; this component does not render an empty shell.

### Loading State

- Candidate text can render before score; score region shows compact skeleton.
- Details action is disabled or opens loading inspector until analysis is available.
- If only prediction is recomputing, score remains visible and prediction subrow skeletons.

### Error State

- Score failed: show candidate text, warning badge, and `Retry score`.
- Invalid analysis: show route/component warning and preserve card.
- Prediction error: show prediction unavailable row, not full card error.

### Partial State

- Post Coach score exists but prediction is disabled due to missing followers or short text.
- Score exists but learnings are absent.
- Codex judge is unavailable; deterministic summary remains primary.
- Candidate score is stale after source text edit.

## Layout

```txt
CandidateCard
|-- header: format badge, rank/score, selected marker
|-- post text preview
|-- score area
|   |-- ScoreBar
|   |-- heuristic label
|-- summary rows: failed/warned/passed counts
|-- prediction row: range/confidence or missing context
|-- top nudges/reasons
`-- actions: Details, Copy, Save later
```

Components referenced: `CandidateCard`, `PostTextPreview`, `ScoreBar`, `Badge`, `Button`, `IconButton`, `Skeleton`, `Alert`.

## Interactions

### Area: Candidate Selection

**Select candidate**

- Given: candidate card is rendered.
- When: user clicks the card body or selection control.
- Then: selected outline appears and detail inspector updates to this candidate.
- Error: if analysis is missing, inspector shows retryable score warning.

**Open details**

- Given: candidate has text.
- When: user clicks Details.
- Then: open Deterministic Detail Inspector with current analysis or loading/error state.
- Error: if score failed, Details opens the warning state with Retry score.

### Area: Score Retry

**Retry score**

- Given: deterministic score failed for this candidate.
- When: user clicks Retry score.
- Then: score region shows loading and analyzer reruns for this candidate text.
- Error: warning persists with updated error message.

### Area: Prediction Context

**Add followers from missing-context row**

- Given: score exists but prediction is disabled for missing followers.
- When: user activates Add followers.
- Then: focus moves to Manual Scoring Context Panel.
- Error: invalid follower handling belongs to panel.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Text only | Score starts | any | Score loading | score skeleton |
| Score loading | Score success | followers present | Complete | Score + prediction |
| Score loading | Score success | followers missing | Missing prediction | Score + missing badge |
| Score loading | Score fail | candidate text exists | Score failed | Warning + retry |
| Complete | Followers changed | valid | Prediction loading | Update prediction only |
| Complete | Candidate edited | text changed | Stale | Stale badge |
| Score failed | Retry | any | Score loading | Retry button loading |

Impossible states to prevent:

- ScoreBar without numeric label.
- Prediction range without manual/source label.
- Score failure replacing candidate text.
- Selected style hidden by warning or judge state.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Card hover/focus | Only interactive regions show pointer/focus | border/outline | 150ms | focus-visible on controls |
| ScoreBar appears | Preserve row height | fill/value appears | 150ms, reduced motion fallback | numeric value exposed as text |
| Missing followers action | Do not hide explanation | focus context panel | immediate | announce focus move if needed |
| Selected | Selection outranks advisory colors | outline + text label | immediate | not color-only |

## Modals And Panels

Opens Deterministic Detail Inspector.

- Trigger: Details action or card selection.
- Focus return: Details button or selected card.
- Keyboard: Details is a real button; Enter/Space activates.

## Forms

No form inside the summary. Missing-context action routes to Manual Scoring Context Panel.

## Feedback And Recovery

- Immediate: selected state, action hover/focus.
- Inline/component: score loading, score failed, prediction missing.
- Page-level: route banner only for generation/system failure.
- System-level: later copy/save toasts.

Failure handling:

- Scoring failed: retry score.
- Prediction unavailable: add followers or accept no prediction.
- Stale score: regenerate or rescore after edit.

## Content And Localization

- Primary content: candidate post text.
- Secondary content: score, format, counts, top nudges.
- Tertiary content: confidence, source, multipliers in details.
- Copy inventory: `Heuristic rank, not prediction.`, `Details`, `Retry score`, `Prediction needs followers`, `Score stale`, `Manual`.
- Truncation/wrapping: full candidate board should avoid clamping main post text; table/list variants can clamp with accessible full text.
- Localization: score bands are text labels; numbers use locale formatting.
- Content ownership: deterministic feature owns score labels; writer owns candidate actions.

## Accessibility

- Keyboard navigation: card action order is Details, Copy, Save later where implemented.
- Focus management: selected candidate state announced through accessible name or status text.
- Screen reader: ScoreBar includes numeric value, band, and method.
- Landmarks: candidate board can be list/listitem.
- Reduced motion: score bar changes do not require animation.

### Accessibility Test Notes

- Verify each candidate is reachable and distinguishable by format/text.
- Verify score value and band are read without relying on color.
- Verify Retry score works with keyboard.
- Verify missing followers action moves to or identifies the follower input.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `CandidateCard` | candidate container | selected, deterministic-only, score-failed |
| `PostTextPreview` | candidate text | preserve line breaks |
| `ScoreBar` | score display | method `heuristic`, band by score |
| `Badge` | format, confidence, missing context | `info`, `warning`, `uncertain` |
| `Button` | Details, Retry score | `secondary`, `ghost` |
| `IconButton` | copy/later compact actions | accessible label + tooltip |
| `Skeleton` | score loading | fixed height |
| `Alert` | score failure row | `warning` |

## Handoff Notes

- Visual specs: candidate text remains first-read; score supports comparison.
- Interaction specs: retry score cannot regenerate text.
- Content specs: show heuristic label on every aggregate score.
- Edge cases: missing followers, short text prediction null, score failure, stale score, long post text.
- Implementation dependencies: score schema, candidate card component, score band utility, selected candidate state.

## Open Questions

- Should score counts use failed/warned/passed labels or more product-y labels (`flagged`, `nudges`, `on point`) from Post Coach?
- Are Copy/Save in this component's first implementation slice or later Writer Logic?
- What score band thresholds should `ScoreBar` use: Post Coach badges or design-system bands?
