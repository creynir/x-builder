# Product Patterns — X Builder

Stage: product-design-system / Stage 4 PATTERNS.

Status: approved for Stage 5 composition.

Inputs:

- [Product Design Brief](./product-design-brief.md)
- [Product Foundations](./product-foundations.md)
- [Product Components](./product-components.md)
- [Product Tokens CSS](./product-tokens.css)

## Pattern Principles

X Builder patterns are built for one job: help the writer decide what to post, why, and what evidence supports the choice.

Rules:

- The main work surface stays usable when Codex is unavailable.
- Deterministic scoring and LLM judging are separate channels.
- Memory surfaces are first-class, not admin screens.
- Candidate selection is a user decision and visually outranks advisory states.
- Loading happens per panel.
- Errors include recovery and do not erase completed work.

## App Shell

### Problem

Every route needs stable navigation, runtime status, and a main work surface that can host dense writer, library, and settings workflows.

### Use / Avoid

Use for every product screen.

Avoid landing-page layouts, centered chat layouts, and page sections styled as floating cards.

### Composition

- `TopStatusBar`
- `SidebarNav`
- `main`
- optional `aside` inspector
- route toolbar

### Layout

Desktop:

```txt
top status: 40px
sidebar: 224px
main: fluid
inspector: 340px when present
```

Collapse priority:

1. Inspector becomes drawer.
2. Sidebar becomes icon rail.
3. Status bar compresses to provider + freshness.
4. Main work surface remains visible.

### States

- Default: engine ready, local data current.
- Partial: Codex unavailable, deterministic engine ready.
- Error: engine failed, route remains mounted with retry.
- Stale: imported metrics or known posts need refresh.

### Keyboard

- `Cmd+K`: command palette.
- `G W`: Writer.
- `G V`: Voice.
- `G L`: Post Library.
- `G S`: Settings.

### QA

- Active route is visible by marker and text.
- Status does not rely on color alone.
- Sidebar collapse does not hide route names from screen readers.

## Writer Workbench

### Problem

The writer needs to enter an idea, get one option per format, choose a format, then generate three more options of the chosen format.

### Composition

- Idea textarea.
- Format selector.
- Generate action.
- Candidate comparison board.
- Judge inspector.
- Evidence tab.

### Interaction Flow

1. User writes an idea.
2. User runs generation.
3. System produces three first-pass candidates: one-liner, lesson/framework, debate/question.
4. Deterministic scoring runs for all candidates.
5. Codex judge runs for all candidates if available.
6. User selects a format.
7. System generates three more options in that format.
8. User copies, saves, marks used, or sends to library.

### State Machine

| Current State | Event | Guard | Next State | Feedback |
|---|---|---|---|---|
| Empty | User types idea | Valid text | Draft ready | Generate enabled |
| Draft ready | Generate | Engine available | Generating | Button spinner, candidate skeletons |
| Generating | Deterministic complete | Candidates exist | Candidates ready | Candidate board appears |
| Candidates ready | Codex starts | Codex available | Judging | Judge slots show running |
| Judging | Codex complete | All judged | Judged | Judge notes visible |
| Judging | Codex fails | Deterministic exists | Partial | Persistent judge warning |
| Candidates ready | Select format | One format selected | Format expansion ready | Selected card outline |
| Format expansion ready | Generate variants | Engine available | Variant generation | Board replaces with same-format variants |
| Any populated | Copy candidate | Candidate exists | Copied | Inline success and toast with undo if saved |

### States

- Empty: explain that idea input is required; one primary action is disabled.
- Loading: candidate-shaped skeletons only in candidate board.
- Partial: deterministic results visible, judge panel explains missing Codex.
- Error: route-level banner only when deterministic engine fails.
- Selected: user selection uses outline and persists through judge updates.

### Responsive

- Desktop: idea left/top, candidates center, judge inspector right.
- Tablet: judge below candidates or drawer.
- Mobile: single-column, candidate cards become stacked; judge is a tab.

### Metrics

- Time from idea to first candidates.
- Candidate copied.
- Format chosen.
- Judge unavailable count.
- User overrides judge recommendation.

## Candidate Comparison Board

### Problem

The user needs to compare candidates by text quality, format, deterministic score, risks, and judge feedback without opening three separate detail views.

### Composition

- `CandidateCard`
- `ScoreBar`
- `Badge`
- `PostTextPreview`
- inline reasons and risks

### Layout

Desktop uses three columns for first-pass candidates. Same-format expansion can use three columns or a ranked list when text length grows.

Hierarchy inside each candidate:

1. Format and rank.
2. Post text.
3. Score band and dimensions.
4. Reasons.
5. Risks.
6. Judge state.
7. Actions.

### Compound State Resolution

| State Layer | Channel | Example |
|---|---|---|
| Format category | small badge | `Lesson/framework` |
| Runtime | judge slot icon + text | `Codex running` |
| Validation | inline warning row | `Low novelty` |
| Selection | outline | selected candidate |

Priority:

1. Validation danger.
2. User selection.
3. Runtime state.
4. Format category.

### QA

- Score color has numeric value and label.
- Selected candidate remains selected when judge finishes.
- Long post text wraps without resizing controls unpredictably.

## Codex Judge Inspector

### Problem

Codex critique needs to improve decisions without hiding deterministic output or pretending to be the source of truth.

### Composition

- `JudgePanel`
- candidate tabs or anchored summaries
- key-value metadata
- raw output disclosure

### Interaction Flow

1. Candidate results render from deterministic engine.
2. Judge starts asynchronously.
3. Inspector shows running state with candidate count.
4. Complete state lists recommendation, reasons, risks, and confidence.
5. User can open raw output for debugging.

### State Machine

| Current State | Event | Guard | Next State | Feedback |
|---|---|---|---|---|
| Idle | Candidates generated | Codex enabled | Running | Inspector running state |
| Running | Output parsed | Valid schema | Complete | Recommendation appears |
| Running | Partial parse | Some data valid | Partial | Warning + partial fields |
| Running | Timeout | Deterministic exists | Unavailable | Persistent warning |
| Running | Adapter failure | Error returned | Failed | Error with retry |
| Failed | Retry | Adapter ready | Running | Retry button spinner |

### Copy Rules

Use exact labels:

- `Codex judge`
- `Heuristic rank, not prediction.`
- `Codex judge unavailable. Deterministic scoring still ran.`

### QA

- Judge never uses primary CTA styling.
- Raw output is not shown by default.
- Retry does not regenerate deterministic candidates unless explicitly requested.

## Known Posts Table

### Problem

The app needs memory: posts used for voice, signal, examples, and unused future candidates.

### Composition

- `DataTable`
- toolbar search and filters
- `UsageStateBadge`
- row actions
- bulk action bar

### Interaction Flow

1. User opens Post Library.
2. Table loads persisted posts.
3. User filters to unused, voice, signal, or excluded.
4. User selects rows for bulk tagging.
5. Row changes persist locally and update candidate evidence availability.

### State Machine

| Current State | Event | Guard | Next State | Feedback |
|---|---|---|---|---|
| Loading | Data loaded | Rows exist | Populated | Table rows render |
| Loading | Data loaded | No rows | Empty | Import CTA |
| Populated | Search | Query matches | Filtered | Count updates |
| Populated | Search | No matches | Zero results | Recovery copy |
| Populated | Select row | Row selectable | Selecting | Bulk bar appears |
| Selecting | Bulk action | Valid rows | Saving | Row-local pending |
| Saving | Persist success | All saved | Populated | Inline success |
| Saving | Persist partial | Some failed | Partial | Row errors + retry |

### Keyboard

- `/`: focus table search.
- `Space`: select focused row.
- `Shift+Arrow`: extend selection.
- `E`: exclude focused row.
- `U`: mark unused.

### QA

- Frequent actions are visible.
- Bulk actions do not hide row-level errors.
- Empty state has import action.

## Manual Import Review

### Problem

Day one may not have X API integration. The user still needs to paste exports, inspect parsed rows, and persist valid posts.

### Composition

- paste textarea
- parser status
- `ImportPreviewTable`
- import summary
- error repair controls

### Interaction Flow

1. User pastes exported posts or CSV-like text.
2. Parser extracts candidate rows.
3. Preview table classifies rows: parsed, duplicate, missing metrics, invalid.
4. User repairs or excludes rows.
5. User imports valid rows.

### State Machine

| Current State | Event | Guard | Next State | Feedback |
|---|---|---|---|---|
| Empty | Paste input | Text present | Ready to parse | Parse enabled |
| Ready to parse | Parse | Parser succeeds | Review | Preview table |
| Ready to parse | Parse | Parser partial | Partial review | Warning summary |
| Ready to parse | Parse | Parser fails | Error | Inline error, input preserved |
| Review | Import valid | Valid rows exist | Importing | Row pending states |
| Importing | Save success | All saved | Complete | Success summary |
| Importing | Save partial | Some failed | Partial complete | Failed rows remain |

### QA

- Invalid rows do not block valid rows.
- Duplicate state includes the matching known post reference.
- Input text is never lost after parser failure.

## Voice Profile Editor

### Problem

The product needs to write in the user's voice and make voice extraction inspectable.

### Composition

- trait list
- phrase keep/avoid lists
- example post references
- confidence and freshness status
- manual override controls

### Interaction Flow

1. User loads or imports known posts.
2. Voice extractor proposes traits and phrases.
3. User accepts, edits, or rejects individual claims.
4. Writer uses accepted claims in generation.

### State Machine

| Current State | Event | Guard | Next State | Feedback |
|---|---|---|---|---|
| Empty | Import posts | Enough examples | Extractable | Extract action enabled |
| Extractable | Extract | Engine ready | Extracting | Section skeletons |
| Extracting | Complete | Claims found | Review | Claims grouped by source |
| Extracting | Low evidence | Few claims | Partial | Low-evidence warning |
| Review | User edits claim | Claim valid | Dirty | Save bar appears |
| Dirty | Save | Persist success | Saved | Inline success |

### QA

- Manual edits are clearly user-owned.
- Extraction confidence is not hidden.
- Source references are inspectable.

## Settings Section

### Problem

The product needs simple local configuration for adapter choice, model command, data paths, and feature flags.

### Composition

- settings nav
- grouped form fields
- save bar
- connection test action

### Sections

- Engine.
- Codex adapter.
- Storage.
- Writer defaults.
- Privacy.

### Rules

- Settings that require restart show persistent warning.
- Adapter test is a button-level pending state.
- Secrets are masked by default.
- Save failure preserves inputs.

## Loading And Error Strategy

Loading:

- Writer candidate board: candidate skeletons.
- Judge: inspector running state.
- Known Posts: table skeleton rows.
- Voice: section skeletons.
- Import: row-level pending states.

Error:

- Field errors stay beside fields.
- Row errors stay in rows.
- Judge errors stay in judge panel unless adapter config is broken.
- Deterministic engine failure uses route-level alert.
- Storage failure uses persistent page alert and retry.

Partial:

- Codex unavailable: candidate board remains.
- Import partial: valid rows can be imported.
- Voice low evidence: claims visible with warning.
- Analytics stale: show stale badge and last successful import time.

## Feedback Hierarchy

| Scope | Pattern | Example |
|---|---|---|
| Component | inline state | Copy button shows copied |
| Row | row error | Import row invalid |
| Panel | persistent alert | Judge unavailable |
| Route | banner | Deterministic engine failed |
| System | toast | Saved to library |

Rules:

- Success is quiet.
- Warnings persist until understood or resolved.
- Errors include a retry or repair path.
- Toasts do not replace visible state near the affected object.

## State Encoding

State dimensions use separate channels:

- Format category: badge.
- Runtime: icon and label.
- Validation: inline error or warning.
- Selection: outline.
- Source or usage: badge with text.

State families:

| Family | X Builder States |
|---|---|
| Neutral | queued, unused, skipped |
| Active | generating, judging, importing |
| Success | saved, copied, imported, judge complete |
| Warning | partial, stale, low evidence, missing metrics |
| Danger | invalid, failed, excluded |
| Uncertain | deterministic-only, no metrics, low confidence |

## Command Palette

### Purpose

Fast navigation and actions for a daily internal tool.

Commands:

- `Generate from idea`
- `Open Post Library`
- `Import posts`
- `Extract voice profile`
- `Run Codex judge`
- `Copy selected candidate`
- `Mark selected candidate used`
- `Open Settings`

Rules:

- `Cmd+K` opens palette.
- Results are grouped by route and action.
- Destructive actions require confirmation outside the palette.

## Review Gate 2 Checklist

Approve this stage only if:

- Components are product-specific enough to guide implementation.
- Patterns cover the phase 1 epics.
- Codex unavailable state is clear and non-blocking.
- Deterministic and LLM outputs remain visually distinct.
- Known posts and voice memory are treated as core surfaces.
- The component specimen does not look like a generic AI dashboard.
