---
status: in-progress
---

# XOB-025: StaticEngineColumn — compose detection + static metrics + Post Coach recommendations (RIGHT cockpit zone)

## Implementation Details

**Components:**
- `StaticEngineColumn` — RIGHT cockpit zone container; internal scroll on overflow.
- `MetricSlotGroup` — renders N `ScoreBar` slots (skeleton → filled).
- `PostCoachStrip` — Post Coach flagged/warned/passed items.
- `ReachPredictionBlock` — reach range + escape probability + `MetricExplainer` triggers.
- `RecommendationsList` — deterministic Post Coach recommendations (NOT from the judge).

**Compose detection — OUT OF SCOPE here; owned by XOB-029 (ComposeCockpit assembly).** The detection (URL `/compose/post` OR `[role="dialog"]` containing `div[data-testid="tweetTextarea_0"]`), the 350 ms debounced `.textContent` read, the `ComposeContext` derivation (`{composerEl, isActive, composerText}`), the `AnchorLayer` pin register/reconcile API, and the `analyzePosts(request)` trigger are all built in **XOB-029** (which mounts the three zone pins through the extended `AnchorLayer` and runs the `analyzeState` machine). `StaticEngineColumn` is **purely presentational**: it receives `analyzeState` + `followers` + `explainer` as props (exactly what the 8 test cases exercise) and renders. This scope split keeps every XOB-025 deliverable test-covered; the carried XOB-019→AnchorLayer-pin-API note is redirected to XOB-029.

**Props (`StaticEngineColumn`):**
```ts
{
  analyzeState: AnalyzeState;       // idle | scoring | ready | failed
  followers?: number;               // from getCaptureSummary().followers (auto, never prompted)
  onRetryStatic: () => void;
  explainer: ExplainerSource;       // MetricExplainer copy source (L1 or static fallback)
}
```

Where `AnalyzeState` (overlay-local UI state wrapper, owned by `ComposeCockpit`):
```ts
type AnalyzeState =
  | { status: "idle" }
  | { status: "scoring" }
  | { status: "ready"; result: ScoredPostItem }   // ScoredPostItem = the status:"scored" AnalyzedPostItem (real shape above)
  | { status: "failed"; error: string };
```
`ScoredPostItem` is a type alias: `Extract<AnalyzedPostItem, { status: "scored" }>` from `@x-builder/shared` (do NOT redeclare its fields locally).

`ScoredPostItem` is the **`status: "scored"` variant of `analyzedPostItemSchema`** (`shared/src/schemas/deterministic-analysis.ts`). Its REAL shape (verified against the schema — the ticket's earlier informal shape was wrong):
- `score: PostScore` = `{ value: 0–100, checks: VoiceCheck[], learnings: Learning[], engageability: { engageable, reason } }`. The headline static metric is `score.value`.
- `postCoach: PostCoachViewModel` = a **discriminated union** on `state`: `{ state: "empty", title: "Post Coach", message }` OR `{ state: "ready", title: "Post Coach", value, badge: { label, tone, tooltip }, target: 60, engageability, failed: VoiceCheck[], warned: VoiceCheck[], passed: VoiceCheck[], counts: { flagged, nudges, onPoint }, expanded, previewMode, sections: [{ title, items: VoiceCheck[] }], learnings, learningCaveat, hiddenChecks, helperText, footerText }`. **NOTE: the lists are `failed`/`warned`/`passed` (VoiceCheck objects `{ id, kind?, label, status: "pass"|"warn"|"fail" }`), NOT `flagged` string arrays.**
- `prediction: EngagementPrediction` = a **discriminated union** on `status`: `{ status: "available", signals: [{ signal_key, label, multiplier }], predictedMidImpressions, stallRange: { low, high }, escapeRange: { low, high }, escapeProbability: 0–1, expectedReplies, baseImpressions, baseSource, qualityBasis, reachModelVersion }` OR `{ status: "disabled", reason: "missing_followers"|"text_too_short", message }`. **`stallRange`/`escapeRange` are `{ low, high }` objects, NOT tuples; there is NO `midpoint` (use `predictedMidImpressions`).**
- Plus required item fields: `status: "scored"`, `id`, `text`, `detectedFormat`, `heuristicLabel: "Heuristic rank, not prediction."`, `analyzedAt`, `analyzerVersion`, optional `sourceFormat`, and per-item `cooldown?: CooldownSignal`.

**Followers auto-supply:** `getCaptureSummary().followers` → `scoringContext.followers`. If absent → `prediction.status: "disabled"` / `reason: "missing_followers"` (existing path in deterministic engine); **no prompt, no manual input field, no `ManualScoringContextPanel`**.

**State levels:**
- `analyzeState` = L1 (transport call, owned by `ComposeCockpit` state machine).
- `followers` = L1 (`getCaptureSummary`, fetched once on context open, passed down).

**Primitives used:** `ScoreBar` (core metric unit, every dimension), `Skeleton` (waiting slots), `Badge`, `Alert` (failure state), `KeyValueList` (signals), `MetricExplainer` (ⓘ triggers on each metric label).

## Data Models

All shapes are imported from `@x-builder/shared` — **no local redeclaration, no re-derived Zod.**

- `ScoredPostItem = Extract<AnalyzedPostItem, { status: "scored" }>` — full real shape under Implementation Details (`score: PostScore`, `postCoach: PostCoachViewModel` discriminated `empty|ready`, `prediction: EngagementPrediction` discriminated `available|disabled`, `cooldown?`).
- `PostScore` = `{ value, checks: VoiceCheck[], learnings: Learning[], engageability }`.
- `PostCoachViewModel` (`postCoachViewModelSchema`), `EngagementPrediction` (`engagementPredictionSchema`), `ReachRange = { low, high }` (`reachRangeSchema`).
- `CooldownSignal` — `{ format, countInWindow, windowDays, lastPostedAt?, status: "clear"|"warming"|"cooldown", message }` (`cooldownSignalSchema`). ✓ (matches)
- `CaptureSummary` — `{ postsCaptured, lastCaptureAt?, followers?, screenName?, profileCapturedAt? }` (`x-live-capture.ts`). ✓ (matches)

Component reads only `score.value` (headline bar), `postCoach` ready-state `failed/warned/passed` + `badge` + `counts`, `prediction` available/disabled fields, and `cooldown`. It does NOT need to render every PostCoachViewModel field — it renders the subset the AC names.

## Integration Point

- **Parent mount:** `ComposeCockpit` mounts `StaticEngineColumn` into the RIGHT `AnchorLayer` pin (anchored to modal right edge) when `ComposeContext` is active.
- **User entry:** user types in X's composer → 350 ms debounce → `ComposeCockpit` calls `analyzePosts` → passes resulting `analyzeState` down; `followers` supplied once from `getCaptureSummary()` on context open.
- **Terminal outcome:** user reads static metrics, Post Coach nudges, and reach prediction → edits draft accordingly in X's composer. No write-back from this component.

## Scope Boundaries / Out of Scope

**In scope:**
- A fresh v2 `ScoreBar` primitive (first consumer).
- `StaticEngineColumn` + `MetricSlotGroup` + `PostCoachStrip` + `ReachPredictionBlock` + `RecommendationsList`, all **presentational** over the injected `analyzeState`/`followers`/`explainer` props.
- Static metrics: `ScoreBar` (skeleton → filled, fast) driven by `result.score.value`.
- Post Coach strip: flagged/warned/passed items.
- Reach prediction block: range, midpoint, escape probability.
- Deterministic `RecommendationsList` from Post Coach (NOT judge suggestions).
- Per-item cooldown signal display (from `analyzeState.result.cooldown`).
- Auto-followers from `getCaptureSummary()` → disabled/reason path when absent.
- Internal scroll on overflow; never pushes X UI.

**Out of scope (zero-trace):**
- **Compose detection, `ComposeContext` derivation, `AnchorLayer` pin register/reconcile API, the 350 ms debounced `.textContent` read, and the `analyzePosts` trigger — all owned by XOB-029.** `StaticEngineColumn` receives `analyzeState` as a prop and does no transport/detection itself.
- Manual follower input field / `ManualScoringContextPanel` — removed.
- Judge metrics (owned by `JudgeStrip`, XOB-026/027).
- Apply-all / provenance render (XOB-027).
- Generate buttons (owned by `ComposeGenerateRail`, XOB-024).
- `CompositionHighlightLayer` / blue annotations (XOB-022).
- Anything that mutates X's composer.

## Test Strategy & Fixture Ownership

**Framework:** Vitest **browser mode → Playwright Chromium** via `vitest-browser-react` — the established overlay harness (XOB-018/020/021/022/023/024), shadow-DOM-aware. NOT jsdom/RTL.

**Fixtures (owned by overlay package):** `overlay/src/testing/analyze-state.ts`.

**CRITICAL — fixtures must be VALID instances of the real schema.** The `result` of a `ready` state is a full `Extract<AnalyzedPostItem, {status:"scored"}>` — the informal fixture that previously lived here (`score:{value:72}`, `postCoach:{flagged:[…]}` string arrays, `prediction` tuples + `midpoint`) was WRONG and would not parse. To guarantee correctness:
1. Build the `ready` fixture as a complete `scoredPostItemSchema`-valid object — copy a known-valid construction from `client/src/features/writer/tests/deterministic-components.test.tsx` or `engine/src/server/tests/posts-analyze.test.ts` and adapt.
2. **Add a fixture-validity test** that runs `analyzedPostItemSchema.parse(readyState.result)` (and the disabled-prediction + cooldown variants) and asserts it succeeds — so the fixture can never silently drift from the schema.

Required fixture variants:
- `scoringState: AnalyzeState = { status: "scoring" }`
- `readyState` — full valid scored item with `score.value` (e.g. 72), `postCoach: { state: "ready", …, failed: [<one VoiceCheck>], warned: [], passed: [<one VoiceCheck>], counts, badge, … }`, `prediction: { status: "available", stallRange: { low, high }, escapeRange: { low, high }, escapeProbability, predictedMidImpressions, signals: […], expectedReplies, baseImpressions, baseSource, qualityBasis, reachModelVersion }`, `cooldown: { format, countInWindow, windowDays, status: "warming", message }`.
- `failedState: AnalyzeState = { status: "failed", error: "analyze_failed" }`
- `missingFollowersResult` — `{ ...readyState.result, prediction: { status: "disabled", reason: "missing_followers", message: "<required, non-empty>" } }` (the `message` field is REQUIRED).

**Test cases:**
1. **Idle** — renders `Skeleton` slots (N bars in loading state); no metrics visible.
2. **Scoring** — same as idle; `aria-busy` on metric region.
3. **Ready → fills** — `ScoreBar` values match `result.score.value`; Post Coach items render; reach prediction visible.
4. **Missing followers** — `prediction.status: "disabled"` → reach block shows "no follower data" message; no prompt for input.
5. **Cooldown signal** — `result.cooldown.status: "warming"` → cooldown badge visible in Post Coach or recommendations strip.
6. **Failed** — `Alert` with retry button shown; `onRetryStatic` called on click.
7. **Channel caption** — "◆ Static engine" caption present in DOM.
8. **Neutral styling** — no `--xb-judge` tokens; no primary-CTA button in this column.

**Transport mock:** `FakeEngineTransport` (calls owned by `ComposeCockpit`; `StaticEngineColumn` only receives result state).

## Definition of Done

- [ ] **(Compose detection / `analyzePosts` trigger / `ComposeContext` / `AnchorLayer` pin-API → deferred to XOB-029; not built here.)**
- [ ] A fresh v2 `ScoreBar` primitive exists in `client/src/ui/v2/` (token-driven, shadow-portable) and is exported from the v2 barrel.
- [ ] Overlay fixtures are valid `analyzedPostItemSchema` instances (proven by a `.parse()` fixture-validity test).
- [ ] `StaticEngineColumn` renders `Skeleton` slots while scoring; fills `ScoreBar` value(s) from `result.score.value` when ready.
- [ ] Post Coach strip renders flagged/warned/passed items from deterministic engine (not judge).
- [ ] `ReachPredictionBlock` renders or shows disabled-state when followers absent.
- [ ] Followers supplied automatically from `getCaptureSummary()`, no manual input.
- [ ] `RecommendationsList` sourced from deterministic Post Coach only.
- [ ] "◆ Static engine" channel caption present.
- [ ] Internal scroll; no layout shift on X UI.
- [ ] All 8 test cases pass.
- [ ] Aurora Glass Visual AC satisfied (see below).

## Acceptance Criteria

**Given** X's composer is detected (URL or dialog)  
**When** the user types (debounced 350 ms)  
**Then** `analyzePosts` is called and `StaticEngineColumn` transitions from `scoring` to `ready`, filling `ScoreBar` values.

**Given** `getCaptureSummary()` returns a profile with `followers`  
**When** `analyzePosts` completes  
**Then** `ReachPredictionBlock` shows a reach range (no follower input prompt).

**Given** `getCaptureSummary()` returns no `followers`  
**When** `analyzePosts` completes  
**Then** reach block shows disabled/missing-followers state; no input field is rendered.

**Given** the static engine call fails  
**When** `analyzeState.status === "failed"`  
**Then** an `Alert` with a retry button is shown; judge zone is unaffected.

**Given** the `StaticEngineColumn` is visible  
**When** rendered in any state  
**Then** the channel caption "◆ Static engine" is present and no judge-styled (`--xb-judge`) tokens are used.

## Visual AC

**Aurora Glass tokens:**
- Container: `--xb-surface-panel` glass background, `--xb-border-edge` right-edge accent, `--xb-glow-sm`.
- `Skeleton` slots: `--xb-surface-panel` shimmer; existing overlay shimmer animation (gated by reduced-motion).
- `ScoreBar`: **build a FRESH v2 `ScoreBar` primitive in `client/src/ui/v2/` (XOB-025 is its first consumer)** — do NOT import the legacy `client/src/ui/foundation.tsx` `ScoreBar` (it renders via global CSS classnames, not shadow-portable; per the locked v2-primitive-library convention we build fresh, token-driven, self-contained primitives). Mirror the legacy `ScoreBarProps` (`{ label, value, max?, bandLabel?, helpText?, loading?, disabled? }`) but render with inline `var(--…)` styles (no global classnames). Bar fill uses neutral score-band tokens (`--score-strong/good/usable/needs-rewrite/unknown`); **never** `--xb-judge` or `--xb-accent` CTA hue. Add `ScoreBar` to the v2 barrel `client/src/ui/v2/index.ts`.
- Channel caption: "◆ Static engine" in `--xb-text-muted`, `--type-caption`, `letter-spacing: 0.1em`.
- Failure `Alert`: `variant="danger"` with retry `Button` (`variant="secondary"`).
- Cooldown badge on relevant items: `Badge` variant `"warning"`, amber `--xb-band-major`.
- Hover on `ScoreBar` label ⓘ: `ExplainerTrigger` ghost with `--xb-glow-sm`.
- Reduced motion: `Skeleton` shimmer stops; no transition animations.
- Internal scroll: `overflow-y: auto` on column container; scrollbar styled to match panel.

**Static engine identity:** neutral palette; this side of the cockpit must be visually quieter than the judge side — no cyan glow, no pulse, no accent-CTA buttons.

## Edge Cases

- **Composer opens with text already present** (paste, X draft restore): `analyzePosts` fires immediately on context open if text is non-empty.
- **Composer text cleared:** transitions back to `idle`; `Skeleton` slots shown.
- **Very short text (< 10 chars):** `analyzePosts` may return `postCoach: { flagged: ["too_short"] }`; render as normal.
- **`analyzeState` stale while new request in-flight:** show stale results with a subtle spinner overlay on the metric region (no flash to empty).
- **Multiple compose modals** (X allows nested?): `AnchorLayer` tracks the topmost; `StaticEngineColumn` receives only one `analyzeState`.
- **Overflow:** Post Coach list truncated at 5 items; "See more" expander if more exist.

**Cross-deps:** XOB-019 (AnchorLayer/compose detection), XOB-021 (MetricExplainer), XOB-023 (ProvenanceController — static column renders independently of provenance state).
