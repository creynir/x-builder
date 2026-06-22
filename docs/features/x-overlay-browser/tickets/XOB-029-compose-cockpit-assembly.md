---
status: in-progress
---

# XOB-029: ComposeCockpit — orchestrator assembly + responsive collapse

> **SCOPE DECISION (2026-06-22, user-directed) — XOB-029 is the FULL overlay-side integration:**
> 1. **Auto-apply best candidate.** `generateIdeas` returns **3 candidates** (`generateIdeaResponseSchema = { candidates: [3] }`, each `{ id, format, text, verdict?, approved? }`). On generate, the cockpit auto-applies the **best** candidate — the highest `verdict.scores.overall` among `deriveApproved`-true candidates; if none approved, `candidates[0]`. It writes that candidate's `text` into X's composer (explicit-gesture write), captures the written text as the green anchor (`setAnchor`), and sets the judge from `candidate.verdict` (→ `judged`/pre-approved) or starts the normal judge flow if the candidate carries no `verdict` (→ `typing`). **No multi-candidate picker** (deferred; no component, not tested here). NOTE the response `candidate.format` is a 3-value enum (`one-liner|mini-framework|debate-question`) distinct from `DetectedPostFormat` — the cockpit reads `candidate.text`/`verdict`/`approved`, not `candidate.format`.
> 2. **Full DOM integration built HERE:** (a) **compose detection** (URL `/compose/post` OR `[role="dialog"]` ⊃ `tweetTextarea_0`); (b) the **`AnchorLayer` register/reconcile mutation API + `ComposeContext` provider** (`{composerEl, isActive, composerText}`) — additively extend `overlay/src/anchor-layer.tsx` (today a read-only registry skeleton); (c) **live-modal pin anchoring** — the 3 zones position over the modal rect, tracked by (d) a **single per-frame rAF snapshot** (host origin + modal/composer rect captured together) that ALSO feeds `CompositionHighlightLayer` — this resolves the carried **XOB-022 L2 / XOB-023 C1** multi-source-read skew; (e) the **real contenteditable composer-write gesture** (write generated/improved text into `tweetTextarea_0` on explicit user click — policy-safe, never auto-post); (f) **in-flight abort/cancel** — a composer edit during `judging`/`applying` aborts the in-flight `judgeDraft`/`applyJudgeSuggestions` (AbortController or a generation-token guard) and resets state.
> 3. **Transport BINDING remains XOB-030 [INT].** XOB-029 calls the engine ONLY through the XOB-019 `useTransport()` seam (`transport.getGenerateCategories()`, `.getCaptureSummary()`, `.analyzePosts()`, `.judgeDraft()`, `.generateIdeas()`, `.applyJudgeSuggestions()`, `.getOverlayReadiness()`). Tests inject `FakeEngineTransport` via `OverlayTransportProvider`. The real `__xbuilder_*`→engine binding + RunnerApp wiring + capture/readiness round-trip is XOB-030.
> 4. **judge readiness gate:** before auto-kicking `judgeDraft`, the cockpit checks `getOverlayReadiness().llm.state === "ready"`; otherwise `JudgeStrip` shows `{ status: "unavailable", hint: readiness.llm.label/message }`.
> 5. Build a small **`ChannelDivider`** (labelled neon hairline) here — none exists. Harness: Vitest **browser mode → Playwright Chromium** (NOT jsdom/RTL); X-shaped fixture DOM in `document.body` + `FakeEngineTransport`.
> 6. `ProvenanceState` is the **bare string** `"generated" | "user_written"`.

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
- Compose detection (URL/dialog) + the `AnchorLayer` register/reconcile mutation API + `ComposeContext` provider (`{composerEl, isActive, composerText}`) — additive extension of the XOB-019 skeleton.
- The single per-frame **rAF snapshot** tracker (host origin + modal/composer rect together) feeding both the pins and `CompositionHighlightLayer` (resolves XOB-022 L2 / XOB-023 C1).
- Live-modal pin anchoring of all three zone components; internal scroll on overflow; no push of X UI.
- Owning the `ComposeMachineState` reducer + the `ApplyState` (L4).
- Orchestrating all transport calls via the `useTransport` seam (categories, capture summary, analyze, judge, generate, apply, readiness).
- The **explicit-gesture composer-write** (write generated/improved text into `tweetTextarea_0` on user click; never auto-post) + **auto-apply-best** candidate selection.
- **In-flight abort/cancel** on composer edit during `judging`/`applying`.
- `ProvenanceController` composition; `setAnchor` wired to the composer-write step.
- Responsive collapse at < ~1180px via `data-cockpit="stacked"`.
- Channel captions + a new `ChannelDivider`.
- No-horizontal-scroll guarantee.

**Out of scope (zero-trace):**
- Individual zone rendering (delegated to XOB-024/025/026/027).
- `CompositionHighlightLayer` (XOB-022, already built).
- `SuggestAffordance` (XOB-028, separate affordance).
- Cockpit visible on non-compose routes.

## Test Strategy & Fixture Ownership

**Framework:** Vitest **browser mode → Playwright Chromium** via `vitest-browser-react` (NOT jsdom/RTL) — real DOM/contenteditable/getClientRects/shadow DOM. Integration assertions use X-shaped fixture DOM (the `xComposerFixture` below) inserted into `document.body`, with `FakeEngineTransport` injected via `OverlayTransportProvider`. Mount the cockpit inside `<OverlayTransportProvider transport={fake}><AnchorLayer>…</AnchorLayer></OverlayTransportProvider>` per the established harness (mirror `overlay/src/anchor-layer.test.tsx` for the rAF/fake-timer reconcile pattern and `transport/use-transport.test.tsx` for fake-transport injection).

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
6. **Generate flow** — generate click → `generating` phase → `generateIdeas({format})` called; `pending` passed to `ComposeGenerateRail`.
7. **Apply flow** — Apply-all click → `applyJudgeSuggestions({text})` called; `applyState: "applying"` passed to `JudgeStrip`.
8. **Unmount on dialog close** — dialog removed from DOM → `ComposeCockpit` unmounts cleanly (no lingering state/listeners/timers).
9. **No horizontal page scroll** — cockpit assembly never adds horizontal scroll to document.
10. **Auto-apply-best (composer write)** — `generateIdeas` resolves with 3 candidates → the highest-`overall` approved candidate's `text` is written into the fixture `tweetTextarea_0` (`.textContent` reflects it); the green anchor is set (provenance → `generated`); judge set from that candidate's `verdict` (→ judged/approved). If none approved → `candidates[0]` applied; if the chosen candidate has no `verdict` → provenance `user_written` + normal judge flow.
11. **Apply-all write** — `applyJudgeSuggestions` resolves `{text, improvedOverOriginal:true}` → improved `text` written into the composer; anchor re-pinned (provenance → `generated`); `applyState` → `{applied, improvedOverOriginal:true}`.
12. **In-flight abort on edit** — composer text changes while `judging` (or `applying`) → the in-flight `judgeDraft`/`applyJudgeSuggestions` is aborted (no stale result applied) and the machine resets (re-debounces analyze / `applyState`→`idle`); composer retains the user's edit.
13. **Judge-readiness gate** — `getOverlayReadiness().llm.state !== "ready"` → after `static_ready`, judge is NOT auto-kicked; `JudgeStrip` shows `unavailable` with the readiness hint. When `ready`, `judgeDraft` is kicked → `judging`→`judged`.
14. **rAF snapshot single-source** — host origin + composer/modal rect are read in ONE per-frame snapshot shared by the pins and the highlight layer (assert no independent double-read; e.g. one tracker instance feeds both).

**Transport mock note:** `FakeEngineTransport` overrides `analyzePosts`/`judgeDraft`/`generateIdeas`/`applyJudgeSuggestions`/`getGenerateCategories`/`getCaptureSummary`/`getOverlayReadiness` per case; tests advance fake timers for the 350 ms analyze debounce and await promise resolution.

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
