---
status: todo
---

# XOB-029: ComposeCockpit — orchestrator assembly + responsive collapse

## Implementation Details

**Component:** `ComposeCockpit`

**Props:**
```ts
{
  compose: ComposeMachineState;         // full state machine (§H / §5.1)
  categories: GenerateCategory[];       // from getGenerateCategories() (L1)
  provenance: ProvenanceState;          // from ProvenanceController (L5 derived)
  applyState: ApplyState;               // owned here (L4)
  onGenerate: (category: GenerateCategory) => void;
  onApplyAll: () => void;
  onRetryJudge: () => void;
  onRetryStatic: () => void;
  explainer: ExplainerSource;
}
```

**`ComposeMachineState`** (complete §H / §5.1 machine, owned in `ComposeCockpit`):
```ts
type ComposeMachineState =
  | { phase: "idle" }
  | { phase: "typing" }
  | { phase: "static_ready"; analyzeResult: ScoredPostItem; followers?: number }
  | { phase: "judging"; analyzeResult: ScoredPostItem }
  | { phase: "judged"; analyzeResult: ScoredPostItem; verdict: JudgeVerdict }
  | { phase: "judge_failed"; analyzeResult: ScoredPostItem; error: string }
  | { phase: "generating"; categoryId: string }
  | { phase: "apply_failed"; analyzeResult?: ScoredPostItem; verdict?: JudgeVerdict; error: string };
```

**Zone assembly:** `ComposeCockpit` is the orchestrator. It mounts three `AnchorLayer` pins when `ComposeContext` is active:

| Zone | Component | Pin anchor |
|---|---|---|
| LEFT | `ComposeGenerateRail` | Modal left edge |
| RIGHT | `StaticEngineColumn` | Modal right edge |
| UNDER | `JudgeStrip` | Modal bottom rect + `--space-5` (~20px) gap |

Pin positions tracked via the shared rAF rect tracker; each pin scrolls internally on overflow; no pin pushes X's modal or surrounding UI.

**State machine ownership:**
- `ComposeCockpit` owns the `ComposeMachineState` reducer (L4).
- On `ComposeContext` open → calls `getGenerateCategories()` → populates `categories`.
- Debounced composer `.textContent` (350 ms) → triggers `analyzePosts` → `static_ready` / `judge_failed`.
- `static_ready` → auto-kicks `judgeDraft` → `judging` → `judged` (if `judgeReady`).
- `onGenerate(category)` → `generating` → `generateIdeas({ format: category.format })` → candidate applied → provenance anchor set (XOB-023) → back to `judged` (pre-approved) or `typing` (fallback).
- `onApplyAll()` → `applying` (in `ApplyState`) → `applyJudgeSuggestions` → result processed.
- `ProvenanceController` (XOB-023) is a logic component composed inside `ComposeCockpit`; it reads composer text (L4) and the pinned anchor (L3) and derives `ProvenanceState` (L5).

**Responsive collapse:**
- At viewport width < ~1180px: `data-cockpit="stacked"` set on the cockpit root element.
- Stacked layout: single column, order = rail → static/coach → judge.
- Stacked layout uses CSS `flex-direction: column` (no JavaScript layout switch); triggered by a CSS media query on the cockpit root.
- Channel captions remain visible in stacked mode (static⟂judge firewall).

**Static⟂judge firewall:**
- "◆ Static engine" caption on `StaticEngineColumn`.
- "✦ AI judge" caption on `JudgeStrip`.
- Both visible in all layouts; never collapsed/hidden.
- `ChannelDivider` (labelled neon hairline) separates the zones where co-located (in stacked mode this becomes a horizontal rule between sections).

**Transport calls owned by `ComposeCockpit`:**
- `getGenerateCategories()` — on context open.
- `getCaptureSummary()` — on context open (followers).
- `analyzePosts(request)` — on debounced text change.
- `judgeDraft(request)` — auto after `static_ready`.
- `generateIdeas({ format })` — on generate click.
- `applyJudgeSuggestions({ text })` — on Apply-all click.

**State levels:**
- `compose` machine = L4.
- `categories` = L1.
- `provenance` = L5 derived.
- `applyState` = L4.
- `followers` = L1 (from `getCaptureSummary`, passed into machine).

**Primitives:** no direct primitive use in `ComposeCockpit` itself — delegates to children. Owns `AnchorLayer` pins and the machine.

## Data Models

All data models owned by children (XOB-024–027). `ComposeCockpit` maps `ComposeMachineState` fields to child props.

Key derived prop mappings:
- `analyzeState` for `StaticEngineColumn` ← derived from `compose.phase` + `compose.analyzeResult`.
- `judge: JudgeState` for `JudgeStrip` ← derived from `compose.phase` + `compose.verdict`.
- `pending?: string` for `ComposeGenerateRail` ← `compose.phase === "generating" ? compose.categoryId : undefined`.

## Integration Point

- **Parent mount:** `OverlayRuntime` (or `AnchorLayer`) mounts `ComposeCockpit` when `ComposeContext` is active (URL `/compose/post` OR `[role="dialog"]` containing `tweetTextarea_0`).
- **User entry:** X's composer opens → `ComposeCockpit` mounts → fetches categories + capture summary → renders three pinned zones.
- **Terminal outcome:** user edits in X's own composer and manually posts. `ComposeCockpit` unmounts when compose dialog closes / route changes.

## Scope Boundaries / Out of Scope

**In scope:**
- Mounting all three zone components as `AnchorLayer` pins.
- Owning the `ComposeMachineState` reducer.
- Orchestrating all transport calls (categories, capture summary, analyze, judge, generate, apply).
- `ProvenanceController` composition.
- Responsive collapse at < ~1180px via `data-cockpit="stacked"`.
- Channel captions + `ChannelDivider`.
- No-horizontal-scroll guarantee.

**Out of scope (zero-trace):**
- Individual zone rendering (delegated to XOB-024/025/026/027).
- `CompositionHighlightLayer` (XOB-022, already built).
- `SuggestAffordance` (XOB-028, separate affordance).
- Cockpit visible on non-compose routes.

## Test Strategy & Fixture Ownership

**Framework:** Vitest + RTL, shadow-DOM-aware. Integration assertions use fixture DOM resembling X's composer modal (X-shaped fixture HTML owned by overlay package).

**Fixtures (owned by overlay package):**
```ts
// fixtures/compose-cockpit.ts — X-shaped fixture DOM
export const xComposerFixture = `
  <div role="dialog" aria-label="Compose post">
    <div data-testid="tweetTextarea_0" contenteditable="true" role="textbox"></div>
    <button data-testid="tweetButton">Post</button>
  </div>
`;
```

**Test cases:**
1. **Mount on compose detect** — fixture DOM with `[role="dialog"]` + `tweetTextarea_0` → `ComposeCockpit` mounts; all 3 pins present in rendered output.
2. **Pinned positions** — LEFT/RIGHT/UNDER pins anchored to modal rect via rAF tracker; internal-scroll containers present.
3. **Overflow internal-scroll** — content exceeding pin height scrolls within pin; no horizontal page scroll.
4. **Breakpoint collapse** — `data-cockpit="stacked"` set at ≤ 1180px; stacked column order = rail → static → judge.
5. **Channel captions** — "◆ Static engine" + "✦ AI judge" present in all layout modes.
6. **Generate flow** — generate click → `generating` phase → `generateIdeas` called; `pending` passed to `ComposeGenerateRail`.
7. **Apply flow** — Apply-all click → `onApplyAll()` called; `applyState: "applying"` passed to `JudgeStrip`.
8. **Unmount on dialog close** — dialog removed from DOM → `ComposeCockpit` unmounts cleanly (no lingering state).
9. **No horizontal page scroll** — cockpit assembly never adds horizontal scroll to document.

**Transport mock:** `FakeEngineTransport` implementing all 17 methods.

## Definition of Done

- [ ] `ComposeCockpit` mounts all three zones as `AnchorLayer` pins when compose detected.
- [ ] `ComposeMachineState` reducer handles all phases including generate, apply, and failure paths.
- [ ] `ProvenanceController` composed; `ProvenanceState` flows to children.
- [ ] Responsive collapse: `data-cockpit="stacked"` at < ~1180px; single column order rail→static→judge.
- [ ] Channel captions ("◆ Static engine" / "✦ AI judge") present in all layouts.
- [ ] No horizontal page scroll introduced.
- [ ] Internal scroll on pin overflow; X UI not pushed.
- [ ] Aurora Glass teal identity distinct from X (#1d9bf0); no XB token bleeds onto X DOM.
- [ ] All 9 test cases pass.
- [ ] Visual AC satisfied (see below).

## Acceptance Criteria

**Given** X's compose modal opens (URL `/compose/post` or dialog + textarea)  
**When** `ComposeCockpit` mounts  
**Then** LEFT `ComposeGenerateRail`, RIGHT `StaticEngineColumn`, and UNDER `JudgeStrip` are all present, anchored to the modal rect.

**Given** the cockpit is mounted  
**When** rendered at viewport width < ~1180px  
**Then** `data-cockpit="stacked"` is set on the cockpit root; zones collapse to a single column in order rail → static/coach → judge.

**Given** the cockpit is mounted at any width  
**When** rendered  
**Then** "◆ Static engine" and "✦ AI judge" channel captions are visible; no X UI elements are displaced or obscured by the cockpit layout.

**Given** the cockpit is mounted  
**When** zone content overflows its pin height  
**Then** the overflow scrolls within the pin's internal scroll container; the X modal and page do not scroll horizontally.

**Given** the compose dialog closes  
**When** `ComposeContext` becomes inactive  
**Then** `ComposeCockpit` unmounts; all pins removed; no layout artifacts remain.

**Given** all three zones are visible  
**When** inspecting CSS tokens  
**Then** no `--xb-*` tokens leak onto X's DOM; Aurora Glass teal (`--xb-accent`) is visually distinct from X's `#1d9bf0`.

## Visual AC

**Aurora Glass identity:**
- All cockpit panels use `--xb-surface-panel` (translucent glass), `--xb-border-edge` (teal-tinted), `--xb-glow-sm/md`.
- Teal `--xb-accent` = `hsl(174 90% 52%)` — harmonious but distinct from X's `#1d9bf0` (blue). No panel should be confused with native X UI.
- `--space-5` (~20px) gap between modal bottom and `JudgeStrip` pin.
- Stacked mode: `--space-4` gap between rail, static, and judge sections.

**Channel captions (static⟂judge firewall):**
- "◆ Static engine" — `--xb-text-muted`, `--type-caption`, `letter-spacing: 0.1em`; LEFT of or above static column.
- "✦ AI judge" — same spec; LEFT of or above judge strip.
- `ChannelDivider` (hairline): `--xb-border-edge` gradient line with "Static engine" / "AI judge" text labels; visible in both wide and stacked layouts.

**Responsive:**
- Wide (≥ 1180px): LEFT pill column, RIGHT static column, UNDER judge strip — three separate anchor pins.
- Stacked (< 1180px): single column, each section in a card block, `--space-4` between.
- Reduced motion: all transitions (pin mount/unmount, collapse) use `@media (prefers-reduced-motion: reduce)` to suppress.

**No horizontal scroll:** cockpit root has `overflow-x: hidden`; pin containers never exceed viewport width.

## Edge Cases

- **Modal rect changes during composition** (resize, X layout shift): rAF tracker re-measures; pins reanchor without flicker.
- **Two compose modals open simultaneously** (X edge case): track topmost dialog only; single cockpit instance.
- **`getGenerateCategories()` fails on context open:** `categories` = `[]`; `ComposeGenerateRail` renders empty (no error state in cockpit itself).
- **`getCaptureSummary()` fails:** `followers` = `undefined`; `StaticEngineColumn` shows disabled reach prediction (existing path).
- **Cockpit mounted while generate is already in flight** (fast re-open): machine resumes from current state; no double-call.
- **Narrow viewport (< 600px):** stacked layout tested at mobile-width; all captions remain visible; no clipping.
- **AnchorLayer rect tracker paused** (tab hidden, `visibilitychange`): pins freeze in place; resume on tab focus.

**Cross-deps:** XOB-024 (ComposeGenerateRail), XOB-025 (StaticEngineColumn), XOB-026 (JudgeStrip — base), XOB-027 (JudgeStrip — apply-improve).
