# Screen: Deterministic Detail Inspector

Stage: product-flow-spec / Stage 2 SPEC

Status: draft for review

## Purpose

Expose the full deterministic explanation for a selected candidate or draft, including Post Coach checks and Engagement Prediction signals.

## Route

Inspector or drawer within `/writer`.

## Entry Points

- Candidate Deterministic Summary: Details.
- Candidate selection in Writer board.
- Draft scoring result.
- Missing prediction CTA after followers are entered.

## States

### Ideal State

- Inspector shows selected candidate label and format.
- Post Coach card is ready and expanded by default in inspector context.
- Engagement Prediction card shows range, confidence, manual follower source, and signals.
- Analysis metadata shows method `HEURISTIC`, generated/scored timestamp, and no Codex mixing.

### Empty State

- No candidate selected.
- Inspector placeholder says select a candidate to inspect deterministic details.
- No fake scores or sample cards are shown.

### Loading State

- Selected candidate is known, analysis is loading.
- Post Coach and Prediction card skeletons preserve inspector width.
- Header remains available with close action.

### Error State

- Analysis failed: warning with Retry score and candidate text preserved nearby or linked.
- Prediction failed: Post Coach remains visible and Prediction card shows local warning.
- Invalid selected candidate id: empty state with recovery to candidate board.

### Partial State

- Post Coach ready, Engagement Prediction disabled because followers are missing.
- Post Coach ready, prediction null because text is too short.
- Learnings absent or hidden until real imported data exists.
- Codex judge unavailable appears elsewhere, not in this inspector except as a small channel-separation note if needed.

## Layout

```txt
Deterministic Detail Inspector
|-- header: selected candidate + close
|-- method/caveat row: HEURISTIC, not prediction
|-- Post Coach card
|   |-- score badge, engageability alert
|   |-- failed/warned/passed sections
|   `-- learnings/helper/footer
|-- Engagement Prediction card
|   |-- range + confidence
|   |-- manual follower source
|   `-- signal multipliers
`-- metadata/retry row
```

Components referenced: `Drawer`, `Badge`, `Button`, `IconButton`, `Alert`, `ScoreBar`, `KeyValueList`, `Skeleton`, `Tooltip`.

## Interactions

### Area: Inspector Shell

**Open inspector**

- Given: user activates Details from a candidate.
- When: inspector opens.
- Then: selected candidate details render; focus moves to inspector heading in drawer mode.
- Error: if analysis missing, show loading then warning with Retry score.

**Close inspector**

- Given: inspector is open.
- When: user clicks Close or presses Escape in drawer mode.
- Then: inspector closes and focus returns to Details trigger.
- Error: none; if persistent desktop inspector, close can collapse to empty state.

### Area: Post Coach

**Expand/collapse checks**

- Given: Post Coach ready state has checks.
- When: user toggles details.
- Then: sections expand/collapse without losing score summary.
- Error: none.

**Retry score**

- Given: analysis failed or stale.
- When: user clicks Retry score.
- Then: rerun analysis for selected candidate text and update cards.
- Error: warning persists with latest failure.

### Area: Engagement Prediction

**Add followers**

- Given: prediction disabled due to missing followers.
- When: user clicks Add followers.
- Then: focus moves to Manual Scoring Context Panel.
- Error: follower validation occurs in that panel.

**Review signals**

- Given: prediction exists.
- When: user reads signal rows.
- Then: each signal displays label and multiplier.
- Error: no interaction required day one.

## State Machines

| Current State | Event | Guard | Next State | Action / Feedback |
|---|---|---|---|---|
| Empty | Candidate selected | analysis exists | Ready | Render cards |
| Empty | Candidate selected | analysis missing | Loading | Skeleton cards |
| Loading | Analysis success | followers present | Ready complete | Post Coach + Prediction |
| Loading | Analysis success | followers missing | Ready partial | Post Coach + disabled Prediction |
| Loading | Analysis fail | any | Error | Retry score |
| Ready partial | Followers applied | valid | Prediction loading | Prediction skeleton |
| Prediction loading | Prediction success | any | Ready complete | Range and signals |
| Ready | Candidate changed | any | Loading or Ready | Update selected content |

Impossible states to prevent:

- Old candidate details shown under a new selected candidate label.
- Prediction card hides missing follower recovery.
- Drawer traps focus when closed.
- Post Coach helper says real personal data was used if only static/default learnings are available.

## Micro-Interactions

| Trigger | Rules | Feedback | Timing / Motion | Accessibility |
|---|---|---|---|---|
| Open drawer | Keep candidate board context visible where possible | drawer slide/fade | 300ms max | reduced motion: instant |
| Toggle checks | Preserve scroll position | sections expand | 150ms | button has expanded state |
| Retry score | Keep cards sized | skeleton in card body | until complete | polite status |
| Candidate switch | Header updates first | content refresh | immediate | announce selected candidate change politely |

## Modals And Panels

### Inspector Drawer

- Trigger: Details action on candidate card.
- Content: deterministic cards, metadata, recovery actions.
- Actions: Close, Retry score, Add followers.
- Focus management: first focusable element is Close or heading with `tabindex="-1"` followed by Close.
- Keyboard: Escape closes; Tab stays within drawer only when overlaying content.
- Dismiss: Close button and Escape; overlay click optional only if it does not discard dirty edits.
- Focus return: Details trigger.

## Forms

No primary form inside inspector. Add followers routes focus to Manual Scoring Context Panel.

## Feedback And Recovery

- Immediate: close/toggle feedback.
- Inline/component: card loading, prediction disabled, score failed.
- Page-level: use Route Error Banner only for systemic engine failure.
- System-level: none required.

Failure handling:

- Analyzer failure: preserve candidate, Retry score.
- Missing followers: show disabled prediction with Add followers.
- Text too short: show prediction unavailable reason.
- Static learnings: mark as heuristic/static until real imported metrics exist.

## Content And Localization

- Primary content: score, failed checks, prediction range.
- Secondary content: helper copy, signal labels, confidence.
- Tertiary content: method/source/timestamp.
- Copy inventory: `Post Coach`, `Engagement Prediction`, `Predicted, not measured.`, `Heuristic rank, not prediction.`, `Manual followers`, `Signals, not verdicts.`, `Add followers`, `Retry score`.
- Truncation/wrapping: check labels and signal labels wrap; multiplier stays aligned.
- Localization: ranges and follower values use locale number formatting; date/time uses locale-aware formatting.
- Content ownership: deterministic feature owns card copy; future feedback loop owns outcome comparison copy.

## Accessibility

- Keyboard navigation: Close, retry/add followers, Post Coach toggle, signal rows if interactive later.
- Focus management: drawer opens/closes predictably; candidate switches do not steal focus unless user requested.
- Screen reader: cards have headings; score values include label/band; dynamic updates use polite live regions.
- Landmarks: `aside` for persistent inspector or `dialog` for drawer overlay.
- Reduced motion: drawer and score animations disabled.

### Accessibility Test Notes

- Verify Escape closes drawer and focus returns.
- Verify card headings provide structure for screen reader navigation.
- Verify score bars and prediction confidence are text-readable.
- Verify long check labels at 200% zoom do not overlap actions.
- Verify Add followers path identifies the follower input.

## Component References

| Component | Usage | Variant/Props |
|---|---|---|
| `Drawer` | narrow viewport inspector | modal/drawer behavior |
| `Badge` | method, confidence, status | `info`, `warning`, `uncertain`, `success` |
| `Button` | Retry score, Add followers | `secondary`, loading |
| `IconButton` | Close | label + tooltip |
| `Alert` | engageability warning, prediction disabled, analysis failed | `warning`, `danger` |
| `ScoreBar` | Post Coach target/score support | heuristic method |
| `KeyValueList` | metadata and signal source | mono values |
| `Skeleton` | card loading | fixed inspector width |
| `Tooltip` | score badge helper | text-only |

## Handoff Notes

- Visual specs: use reference images as content hierarchy targets but align colors/tokens to X Builder design system.
- Interaction specs: inspector can be persistent desktop aside and drawer on narrower screens.
- Content specs: replace or qualify static "your data" copy until imported data exists.
- Edge cases: missing followers, short text, stale score, score failure, long check lists, no selected candidate.
- Implementation dependencies: Post Coach component, Engagement Prediction component, selected candidate state, analysis retry action.

## Open Questions

- Should Post Coach default expanded in inspector while compact cards use preview mode?
- What exact phrase should replace current static `your data` learning text pre-import?
- Should analysis metadata include analyzer version for future comparison?
