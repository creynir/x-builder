# Product Components — X Builder

Stage: product-design-system / Stage 3 COMPONENTS.

Status: approved for Stage 5 composition.

Companion preview:

- [Product Component Specimen](./product-components.html)

## Component Standard

Every reusable component must define:

- Purpose and owner.
- When to use and when to avoid.
- Props or data contract.
- Slots and content rules.
- States: default, hover, active, focus, disabled, loading, selected, empty, error, partial.
- Accessibility: role, label, focus behavior, keyboard interaction, live region if dynamic.
- Density behavior for default 32px controls.
- Localization and overflow rules.

Components must use [Product Tokens CSS](./product-tokens.css). New hardcoded colors, shadows, gradients, and decorative backgrounds are not allowed.

## Tier 1: Primitives

### Button

Owner: client UI foundation.

Use for explicit commands. Do not use for navigation when a link or tab is semantically correct.

Props:

- `variant`: `primary | secondary | ghost | danger`
- `size`: `sm | md`
- `leadingIcon`
- `trailingIcon`
- `loading`
- `disabled`

Content rules:

- Primary labels are verbs: `Generate`, `Copy`, `Save`, `Import`, `Mark used`.
- No vague labels like `Submit` or `Continue` when the action can be named.
- Loading replaces the leading icon with a spinner and keeps the label visible.

Accessibility:

- Native `button`.
- Loading state sets `aria-busy="true"`.
- Disabled state uses native `disabled`.
- `Cmd+Enter` can submit writer and dialog forms where documented by the flow spec.

### IconButton

Owner: client UI foundation.

Use only for familiar compact toolbar actions: copy, refresh, dismiss, open inspector, filter, sort, more actions.

Props:

- `label`: required accessible name.
- `icon`: required.
- `variant`: `ghost | secondary | danger`
- `tooltip`: required unless adjacent visible text names the action.

Rules:

- Do not put unclear product actions behind icon-only controls.
- Critical actions need visible text.

### Badge

Owner: client UI foundation.

Use for compact state, category, source, and usage labels.

Variants:

- `neutral`
- `accent`
- `success`
- `warning`
- `danger`
- `info`
- `uncertain`
- `usage-unused`
- `usage-voice`
- `usage-signal`
- `usage-generation`
- `usage-excluded`

Rules:

- A badge must contain text. Color alone is not enough.
- Source badges use mono text: `MANUAL`, `X API`, `CODEX`, `HEURISTIC`.
- Usage badges include a stable icon or text prefix in implementation.

### Status Dot

Owner: client UI foundation.

Use only when paired with text or tooltip.

States:

- `ready`
- `running`
- `partial`
- `failed`
- `stale`
- `unavailable`

Accessibility:

- In tables, pair the dot with visible text.
- In status bars, expose full state through tooltip and accessible label.

### Divider

Owner: client UI foundation.

Use to separate dense toolbars, metadata groups, and inspector sections.

Rules:

- Prefer border separators on tables and panels.
- Avoid decorative dividers in page content.

### Spinner And Skeleton

Owner: client UI foundation.

Use per component, never as a whole-app blocker.

Rules:

- Button actions use a small spinner.
- Tables use skeleton rows that match real columns.
- Judge and import panels can show partial data while their own async work continues.
- Skeletons must preserve layout dimensions.

## Tier 2: Form Controls

### Textarea

Owner: writer feature.

Use for idea input, post draft editing, voice sample notes, and import paste areas.

Props:

- `value`
- `placeholder`
- `minRows`
- `maxRows`
- `charCount`
- `state`: `default | error | disabled | loading`
- `helperText`
- `errorText`

Rules:

- Labels stay visible.
- Placeholder text cannot replace instructions needed after typing starts.
- Character count uses mono text and does not change layout width.

### Input

Owner: client UI foundation.

Use for search, filters, titles, API keys, and numeric/manual metric entry.

Props:

- `type`
- `value`
- `prefixIcon`
- `suffixAction`
- `state`
- `helperText`
- `errorText`

Rules:

- Search input labels must describe scope: `Search known posts`.
- API key fields use reveal/copy controls with visible labels in Settings.

### Select

Owner: client UI foundation.

Use for bounded option sets: format, source, freshness, provider, model, sort.

Keyboard:

- `Enter` or `Space`: open.
- `ArrowUp` and `ArrowDown`: move.
- `Escape`: close.
- Typeahead when options exceed seven.

### Switch

Owner: settings feature.

Use for immediate binary settings. Do not use for choices that require Save before taking effect.

Examples:

- `Run Codex judge after generation`
- `Include unused signal posts`
- `Show deterministic details`

### Slider

Owner: scoring and writer features.

Use for numeric tuning where approximate value is enough.

Day-one examples:

- Voice strictness.
- Debate intensity.
- Novelty tolerance.

Rules:

- Always show the exact numeric value in mono text.
- Provide reset to default when tuning affects scoring.

## Tier 3: Data Display

### DataTable

Owner: post library and analytics features.

Use for known posts, imports, metrics, and signal evidence.

Required parts:

- Toolbar with search, filters, primary action, and bulk action area.
- Header row with sort affordances.
- Row selection.
- Empty, loading, error, partial, and stale states.
- Pagination or virtualized scrolling once rows exceed the local threshold chosen by implementation.

Known Posts columns:

- `Post`
- `Format`
- `Usage`
- `Source`
- `Metrics`
- `Freshness`
- `Actions`

Rules:

- Frequent actions stay visible: copy, mark used, exclude.
- More menu is for secondary actions only.
- Row height defaults to 36px but can expand for wrapped post text.

### ScoreBar

Owner: deterministic engine and judge features.

Use for heuristic score dimensions and candidate rank.

Props:

- `value`: 0-100 or `unknown`.
- `label`: required.
- `band`: `strong | good | usable | needs-rewrite | unknown`.
- `method`: `heuristic | codex-judge | imported-metric`.

Rules:

- Always display numeric value and band text.
- Add copy near the aggregate score: `Heuristic rank, not prediction.`
- Do not compare candidate scores without showing the score dimensions.

### KeyValueList

Owner: inspector and settings features.

Use for evidence, provider, timing, source, and metadata details.

Rules:

- Labels are concise.
- Values that are IDs, provider names, timestamps, or score values use mono.
- Long values wrap; IDs can truncate with copy action.

### EmptyState

Owner: all feature teams.

Use when a screen has no data.

Rules:

- Show one primary recovery action.
- Explain why the state exists.
- Do not use decorative illustration for day one.

### Alert

Owner: client UI foundation.

Use for persistent feedback inside a panel or page.

Types:

- `info`
- `warning`
- `danger`
- `success`

Rules:

- Errors and warnings include recovery.
- Do not auto-dismiss errors.

## Tier 4: Navigation

### AppShell

Owner: BE + simple UI epic.

Defines the outer grid:

- `TopBar`
- `SidebarNav`
- `Main`
- optional `Inspector`
- `TopStatusBar` or bottom status strip depending on implementation.

Rules:

- Main work surface is the center of the product.
- Inspector collapses before sidebar.
- Status never blocks candidate work.

### SidebarNav

Owner: BE + simple UI epic.

Routes:

- `Writer`
- `Voice`
- `Post Library`
- `Settings`

Later routes:

- `My Analytics`
- `Signals`

Accessibility:

- Use `nav`.
- Active route has text, icon, and active marker.

### TopStatusBar

Owner: BE + simple UI epic.

Shows runtime status:

- Engine ready.
- Codex adapter ready, running, unavailable, failed.
- Local data freshness.
- Last run timestamp.

Rules:

- Uses compact state encoding.
- Does not replace inline errors near affected components.

### Tabs

Owner: client UI foundation.

Use for local view switching inside a route.

Writer route tabs:

- `Candidates`
- `Judge`
- `Evidence`

Post Library tabs:

- `Known Posts`
- `Unused Signal`
- `Imports`

## Tier 5: Overlays

### Dialog

Owner: client UI foundation.

Use for destructive confirmation or small focused creation tasks.

Rules:

- Do not use a dialog for settings that need comparison or sustained editing.
- Focus is trapped while open.
- Escape closes unless the form is dirty; dirty forms require confirmation.

### Drawer

Owner: inspector and import features.

Use for side inspection or multi-field edit while preserving main context.

Examples:

- Candidate detail.
- Known post metadata.
- Import review.

### Tooltip

Owner: client UI foundation.

Use for icon-only buttons and short term explanations.

Rules:

- Text only.
- Not interactive.
- Show on hover and focus.

### Toast

Owner: client UI foundation.

Use for transient success, undo, or background completion.

Rules:

- Success can auto-dismiss.
- Warning and error persist.
- Toasts with actions are keyboard reachable.

## Product-Specific Components

### CandidateCard

Owner: writer logic feature.

Purpose: compare one generated post candidate against deterministic and judge signals.

Props:

- `id`
- `format`: `one_liner | lesson_framework | debate_question`
- `rank`
- `postText`
- `scores`
- `deterministicReasons`
- `risks`
- `judgeState`
- `selected`
- `usageStatus`

States:

- Default: candidate is available.
- Selected: border and outline channel.
- Judge pending: compact running state in judge slot.
- Judge failed: judge slot danger state, candidate remains usable.
- Deterministic only: uncertain badge.
- Copied: brief inline success.

Rules:

- Candidate text is the primary read.
- Rank and score are secondary.
- Reasons and risks are visible without opening another screen for the top three candidates.
- Selection must overpower judge recommendation visually.

### JudgePanel

Owner: LLM judge feature.

Purpose: show Codex critique without turning the app into chat.

Props:

- `state`: `idle | running | complete | unavailable | failed | partial`
- `modelLabel`
- `confidence`
- `recommendation`
- `reasons`
- `risks`
- `rawOutput`

Rules:

- Label as `Codex judge`.
- Unavailable copy: `Codex judge unavailable. Deterministic scoring still ran.`
- Raw output is collapsed by default.
- Failure never blocks deterministic results.

### PostTextPreview

Owner: writer and post library features.

Purpose: display post text with readable wrapping and optional line count.

Rules:

- Preserve intentional line breaks.
- Clamp only in tables; full candidate text is never hidden in the main candidate board.
- Long words wrap.

### KnownPostsTable

Owner: post library feature.

Purpose: make product memory visible and reusable.

Rules:

- Shows used/unused/excluded state.
- Shows whether a post feeds voice extraction, signal collection, or generation examples.
- Supports bulk tag, exclude, and mark used.

### VoiceProfileEditor

Owner: voice profile feature.

Purpose: inspect and edit voice extraction rules.

Required sections:

- Voice traits.
- Phrases to keep.
- Phrases to avoid.
- Example posts.
- Confidence and freshness.

Rules:

- Extracted claims show source references.
- Manual edits are marked as user-owned and survive extraction reruns.

### ImportPreviewTable

Owner: import features.

Purpose: review pasted or API-imported rows before persistence.

States:

- Parsed.
- Duplicate.
- Missing metrics.
- Partial.
- Invalid.

Rules:

- Errors are row-local where possible.
- User can import valid rows while invalid rows remain visible for repair.

## Ownership And Governance

New components are allowed only when an existing component cannot represent the state, data shape, or interaction without ambiguity.

Required before implementation:

- Add component to this file.
- Add visual specimen when the component has non-trivial states.
- Reference the component from a feature spec.
- Include tests near the code that owns the component.
