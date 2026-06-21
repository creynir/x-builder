---
status: todo
---

# XOB-025: StaticEngineColumn — compose detection + static metrics + Post Coach recommendations (RIGHT cockpit zone)

## Implementation Details

**Components:**
- `StaticEngineColumn` — RIGHT cockpit zone container; internal scroll on overflow.
- `MetricSlotGroup` — renders N `ScoreBar` slots (skeleton → filled).
- `PostCoachStrip` — Post Coach flagged/warned/passed items.
- `ReachPredictionBlock` — reach range + escape probability + `MetricExplainer` triggers.
- `RecommendationsList` — deterministic Post Coach recommendations (NOT from the judge).

**Compose detection** (owned by `AnchorLayer` / `XSelectors`; consumed here as `ComposeContext`):
- Triggers on `/compose/post` URL **OR** `[role="dialog"]` containing `div[data-testid="tweetTextarea_0"]`.
- Live composer text = debounced `.textContent` of the textarea (350 ms debounce).
- On text change → `analyzePosts(request)` call (static metrics; fast, ~400 ms target).

**Props (`StaticEngineColumn`):**
```ts
{
  analyzeState: AnalyzeState;       // idle | scoring | ready | failed
  followers?: number;               // from getCaptureSummary().followers (auto, never prompted)
  onRetryStatic: () => void;
  explainer: ExplainerSource;       // MetricExplainer copy source (L1 or static fallback)
}
```

Where `AnalyzeState`:
```ts
type AnalyzeState =
  | { status: "idle" }
  | { status: "scoring" }
  | { status: "ready"; result: ScoredPostItem }
  | { status: "failed"; error: string };
```

`ScoredPostItem` carries `score.value`, `postCoach` (flagged/warned/passed), `prediction` (stallRange/escapeRange/escapeProbability/midpoint/signals), and per-item `cooldown?: CooldownSignal`.

**Followers auto-supply:** `getCaptureSummary().followers` → `scoringContext.followers`. If absent → `prediction.status: "disabled"` / `reason: "missing_followers"` (existing path in deterministic engine); **no prompt, no manual input field, no `ManualScoringContextPanel`**.

**State levels:**
- `analyzeState` = L1 (transport call, owned by `ComposeCockpit` state machine).
- `followers` = L1 (`getCaptureSummary`, fetched once on context open, passed down).

**Primitives used:** `ScoreBar` (core metric unit, every dimension), `Skeleton` (waiting slots), `Badge`, `Alert` (failure state), `KeyValueList` (signals), `MetricExplainer` (ⓘ triggers on each metric label).

## Data Models

- `ScoredPostItem` — from `AnalyzePostsResponse.items[0]`; shape mirrors `AnalyzedPostItem` with `score.value`, `postCoach`, `prediction`.
- `CooldownSignal` — `{ format, countInWindow, windowDays, lastPostedAt?, status, message }` (§15.5 / `cooldownSignalSchema`).
- `CaptureSummary` — `{ postsCaptured, lastCaptureAt?, followers?, screenName?, profileCapturedAt? }`.

No local data models added; all shapes from `@x-builder/shared`.

## Integration Point

- **Parent mount:** `ComposeCockpit` mounts `StaticEngineColumn` into the RIGHT `AnchorLayer` pin (anchored to modal right edge) when `ComposeContext` is active.
- **User entry:** user types in X's composer → 350 ms debounce → `ComposeCockpit` calls `analyzePosts` → passes resulting `analyzeState` down; `followers` supplied once from `getCaptureSummary()` on context open.
- **Terminal outcome:** user reads static metrics, Post Coach nudges, and reach prediction → edits draft accordingly in X's composer. No write-back from this component.

## Scope Boundaries / Out of Scope

**In scope:**
- Compose detection via `XSelectors` (URL + dialog observer, owned by `AnchorLayer`; `StaticEngineColumn` consumes the derived `analyzeState`).
- Debounced `.textContent` polling → `analyzePosts` trigger (owned by `ComposeCockpit` machine; passed as `analyzeState`).
- Static metrics: `ScoreBar` grid (skeleton → filled, fast).
- Post Coach strip: flagged/warned/passed items.
- Reach prediction block: range, midpoint, escape probability.
- Deterministic `RecommendationsList` from Post Coach (NOT judge suggestions).
- Per-item cooldown signal display (from `analyzeState.result.cooldown`).
- Auto-followers from `getCaptureSummary()` → disabled/reason path when absent.
- Internal scroll on overflow; never pushes X UI.

**Out of scope (zero-trace):**
- Manual follower input field / `ManualScoringContextPanel` — removed.
- Judge metrics (owned by `JudgeStrip`, XOB-026/027).
- Apply-all / provenance render (XOB-027).
- Generate buttons (owned by `ComposeGenerateRail`, XOB-024).
- `CompositionHighlightLayer` / blue annotations (XOB-022).
- Anything that mutates X's composer.

## Test Strategy & Fixture Ownership

**Framework:** Vitest + RTL, shadow-DOM-aware.

**Fixtures (owned by overlay package):**
```ts
// fixtures/analyze-state.ts
export const scoringState: AnalyzeState = { status: "scoring" };
export const readyState: AnalyzeState = {
  status: "ready",
  result: {
    score: { value: 72 },
    postCoach: { flagged: ["short_hook"], warned: [], passed: ["has_cta"] },
    prediction: { stallRange: [400, 900], escapeRange: [1200, 3500], escapeProbability: 0.38, midpoint: 1800, signals: [] },
    cooldown: { format: "hot_take", countInWindow: 3, windowDays: 7, status: "warming", message: "3 hot takes this week" },
  },
};
export const failedState: AnalyzeState = { status: "failed", error: "analyze_failed" };
export const missingFollowersResult = { ...readyState.result, prediction: { status: "disabled", reason: "missing_followers" } };
```

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

- [ ] Compose detection (URL + dialog+textarea) triggers `analyzePosts` on debounced text change.
- [ ] `StaticEngineColumn` renders `Skeleton` slots while scoring; fills `ScoreBar` values when ready.
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
- `ScoreBar`: reuses foundation `ScoreBar` primitive; bar fill uses neutral score-band tokens (`--score-strong/good/usable/needs-rewrite/unknown`); **never** `--xb-judge` or `--xb-accent` CTA hue.
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
