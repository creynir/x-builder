---
status: done
---

# XOB-022: [FND] `CompositionHighlightLayer` — Range→`getClientRects` positioning, graceful degrade

> **Test approach (supersedes the "JSDOM + mocked rects" wording in Test Strategy):** tests run in the **real Chromium browser-mode harness** (XOB-018), so `Range`/`getClientRects()`/`getBoundingClientRect()` are REAL — this is exactly why browser mode was chosen (jsdom returns all-zero/empty rects, which would make this component untestable). Assert STRUCTURAL/relative correctness (highlight count, spans within the composer bounds, severity token classes, the `getLayerOrigin` offset math, graceful-degrade paths) rather than brittle exact pixels. For the deterministic "multi-line quote → N spans" case, force a real wrap (narrow composer + long quote) OR locally override `Range.getClientRects` to return N rects (testing the rect→span mapping, not layout) — implementer's choice. Consume the shared `JudgeAnnotation` type (`{quote, severity, recommendation}` — matches `judgeAnnotationSchema`, no drift).

## Implementation Details

**Components / symbols:**

- `CompositionHighlightLayer` — absolutely-positioned shadow layer rendered over X's contenteditable rect; `pointer-events: none` on the layer itself, except where individual highlight hover targets explicitly set `pointer-events: auto`; z-index `var(--xb-z-pin)`. Owns the rect-mapping pipeline: quote string → Range API → `getClientRects()` → blue underlay `<span>` elements.
- `useComposerRect()` — hook; reads the bounding rect of the composer contenteditable element (`XSelectors.COMPOSER_TEXTAREA`) via `getBoundingClientRect()`; updates on resize (`ResizeObserver`) and scroll (`scroll` event on relevant ancestor, passive listener) both debounced ~120 ms via a shared rAF tracker.
- `useHighlightRects(composerEl, annotations)` — hook; maps each `annotation.quote` (exact substring) to `DOMRect[]` via the Range API; memoizes by `annotations` array reference + composer content version; re-runs on `composerEl` content mutation (debounced ~120 ms); returns `HighlightRect[]`.
- `HighlightRect` — internal shape: `{ annotationIndex: number; rect: DOMRect; severity: "warning" | "suggestion" }`.
- `GreenWash` — single `<div>` covering the full composer text region; `background: var(--xb-highlight-green-wash)`; rendered only in `"generated"` provenance state (controlled by parent via `showGreen` prop); no per-span mapping.
- `BlueHighlight` — one `<span>` per `HighlightRect`; `background: var(--xb-highlight-blue-warn)` for `severity: "warning"`, `var(--xb-highlight-blue-suggest)` for `severity: "suggestion"`; `pointer-events: auto`; `role="mark"`, `aria-label` from `annotation.recommendation`; positioned via `position: absolute` with `top`/`left`/`width`/`height` derived from `rect` offset against the layer origin.

**Props interfaces:**

```ts
interface CompositionHighlightLayerProps {
  composerEl: HTMLElement | null;   // the contenteditable element (from AnchorLayer pin); null = renders nothing
  annotations: AnnotationEntry[];   // from judgeDraft verdict; default [] (XOB-002 schema, .default([]))
  showGreen: boolean;               // true = generated state (GreenWash shown, BlueHighlights hidden)
  // blue highlights shown only when showGreen === false && annotations.length > 0
}

// From @x-builder/shared (XOB-002, extended judge verdict schema):
interface AnnotationEntry {
  quote: string;           // exact substring to locate in composerEl.textContent
  severity: "warning" | "suggestion";
  recommendation: string;  // shown on hover and as aria-label
}
```

**Quote location algorithm (§16.4 verbatim — first-match + left-to-right consumed-offset):**

```
consumedOffset = 0
for each annotation (left-to-right):
  idx = composerEl.textContent.indexOf(annotation.quote, consumedOffset)
  if idx === -1: silently drop (unmatched quote)
  else:
    create Range; range.setStart(textNode, idx); range.setEnd(textNode, idx + quote.length)
    rects = range.getClientRects()
    if rects.length === 0: silently drop (empty rects)
    else:
      consumedOffset = idx + quote.length   ← advance cursor
      push HighlightRect per rect
```

If the locate pass throws (any exception): **catch, render empty layer, log `console.warn("[xb] highlight locate threw:", err)`** — the compose flow continues unaffected.

**State levels:**

- `composerEl`, `annotations`, `showGreen` — L4 inputs (props from parent `ComposeCockpit`/`ProvenanceController` in XOB-023+; at this ticket driven by fixture props in tests).
- Computed `HighlightRect[]` — L5 (derived from annotations + DOM state; re-computed on debounce tick).
- Debounce/rAF handles — L4 (held in refs, cleaned up on unmount).

## Data Models

```ts
// Internal only — not exported from the overlay package public API
interface HighlightRect {
  annotationIndex: number;
  rect: DOMRect;         // raw getClientRects() entry
  severity: "warning" | "suggestion";
  recommendation: string;
}

// Layer origin is the composer element's getBoundingClientRect(),
// adjusted for the shadow host's own position (offsetParent chain).
// BlueHighlight positioning:
//   top:  rect.top  - layerOrigin.top
//   left: rect.left - layerOrigin.left
//   width: rect.width
//   height: rect.height
```

## Integration Point

**Parent mount:** `CompositionHighlightLayer` is rendered by `ComposeCockpit` (XOB-029) / `ProvenanceController` (XOB-023) as an absolutely-positioned child that tracks the compose modal rect via the shared rAF anchor tracker from `AnchorLayer`. At this ticket it is rendered directly in tests with injected `composerEl` and `annotations` fixture props — no transport, no provenance logic.

**How the user reaches it:** transparent; the layer is always present over the composer when `composerEl` is non-null. Users see the green wash (generated state) or blue underlays (user-written with annotations).

**Terminal outcome of this ticket:** given a fixture `composerEl` with `textContent` containing the annotation quotes, the layer renders correctly-positioned blue underlay rects after the debounce fires; unmatched quotes are silently dropped; a thrown error renders an empty layer; composer typing is never blocked.

## Scope Boundaries / Out of Scope

**May change:** `overlay/src/highlight/composition-highlight-layer.tsx`, `overlay/src/highlight/use-composer-rect.ts`, `overlay/src/highlight/use-highlight-rects.ts`, `overlay/src/highlight/green-wash.tsx`, `overlay/src/highlight/blue-highlight.tsx`.

**This ticket is positioning-only against fixture quotes.** No transport call, no `useTransport()`, no provenance state machine. The `showGreen` and `annotations` props are passed in externally (by XOB-023 wiring in a future ticket); here they come from test fixtures.

**ZERO-TRACE (no code, no stubs):** no `ProvenanceController`, no `ComposeCockpit`, no `JudgeStrip`, no `judgeDraft` call, no `applyJudgeSuggestions` call. No mutation of X's composer DOM (layer is `pointer-events: none` except hover targets; it never inserts content into the contenteditable).

**Graceful degrade is MANDATORY at every failure point:**
- `getClientRects()` returns empty → drop that highlight, continue.
- `textContent.indexOf` returns -1 → drop, continue.
- Any thrown exception in the locate pass → catch, render empty layer, log warn.
- Layer never blocks typing: the highlight re-map is debounced and runs in rAF, not synchronously on keydown.

**Carried P2 concern (tickets/README.md):** rect-thrash visual budget during rapid typing. Correctness is safe via the drop-on-empty rule; the jitter note is surfaced in Visual AC below.

## Test Strategy & Fixture Ownership

**Suite:** Vitest + RTL (shadow-aware JSDOM). Fixture DOM owned by `@x-builder/overlay` — never scraped from live x.com.

**Fixture pattern:** `buildComposerFixture(text: string): HTMLDivElement` — creates a `div[data-testid="tweetTextarea_0"]` with a single `Text` node containing `text`; appended to a test container; `getBoundingClientRect` mocked to return a stable `DOMRect` (e.g. `{top:100,left:50,width:500,height:120}`). `getClientRects()` on `Range` mocked to return predictable rects.

**Tests:**

- Single annotation with a matching quote → `BlueHighlight` rendered with `top`/`left`/`width`/`height` matching the mocked rect offset against layer origin.
- Multi-line quote (mock `getClientRects()` returns 2 rects) → 2 `BlueHighlight` elements rendered.
- Annotation quote not found in `composerEl.textContent` → 0 `BlueHighlight` elements; no error thrown.
- `getClientRects()` returns empty `DOMRectList` (length 0) → 0 highlights; no error.
- Locate pass throws (`textContent` access simulated to throw) → `CompositionHighlightLayer` renders empty (0 highlights); no unhandled exception; `console.warn` called once.
- Two annotations referencing the same quote string → left-to-right consumed-offset: second annotation locates at the second occurrence (advance cursor after first); both render with distinct positions.
- `annotations` updated (new prop) → re-render clears old highlights and maps new ones (after debounce tick; advance time in test).
- `showGreen === true` → `GreenWash` renders, 0 `BlueHighlight` elements regardless of annotations.
- `showGreen === false`, `annotations: []` → 0 highlights, 0 green wash.
- `composerEl === null` → layer renders nothing, no error.
- Debounce: compositor scroll event fires → highlight re-map scheduled via rAF, not run synchronously.

**Fixture ownership:** all `HTMLDivElement` fixtures constructed in `overlay/src/highlight/__tests__/`; no live x.com DOM; no network requests.

## Definition of Done

- `CompositionHighlightLayer` positions blue underlay rects pixel-aligned with `annotation.quote` substrings in the fixture composer after the ~120 ms debounce.
- First-match + left-to-right consumed-offset algorithm is implemented as specified in §16.4.
- Multi-line quote (multiple `getClientRects()` rects) produces one `BlueHighlight` per rect.
- Unmatched quote → silently dropped (no error, no empty placeholder element).
- `getClientRects()` empty → silently dropped.
- Locate pass throws → empty layer, `console.warn`, compose flow unaffected.
- `showGreen === true` → `GreenWash` only; zero blue highlights.
- `composerEl === null` → nothing rendered, no error.
- Layer has `pointer-events: none`; `BlueHighlight` hover targets have `pointer-events: auto`.
- All unit tests pass; `pnpm typecheck` green.

## Acceptance Criteria

- **Given** a fixture `composerEl` with `textContent = "The quick brown fox"` and `annotations = [{quote: "quick brown", severity: "warning", recommendation: "soften tone"}]`, **When** `CompositionHighlightLayer` renders and the debounce fires, **Then** exactly one `BlueHighlight` element appears positioned at the mocked rect for "quick brown".
- **Given** a mock `getClientRects()` that returns 2 rects for a quote (simulating a line-wrapped substring), **When** the layer renders, **Then** 2 `BlueHighlight` elements are rendered for that single annotation.
- **Given** `annotations = [{quote: "no match here", ...}]` and `composerEl.textContent` does not contain that string, **When** the layer renders, **Then** 0 `BlueHighlight` elements are rendered and no error is thrown.
- **Given** the locate pass throws (mock `textContent` getter to throw), **When** `CompositionHighlightLayer` renders, **Then** the layer is empty (0 highlights), `console.warn` is called once with the error, and the component does not propagate an unhandled exception.
- **Given** `showGreen === true`, **When** the layer renders, **Then** `GreenWash` is visible, 0 `BlueHighlight` elements are rendered, and `annotations` are ignored regardless of their content.
- **Given** two annotations both referencing the quote `"foo"` in `composerEl.textContent = "foo bar foo baz"`, **When** the layer renders, **Then** the first annotation maps to the first occurrence (index 0) and the second maps to the second occurrence (index 8) — left-to-right consumed-offset rule.
- **Given** the user is typing rapidly in the composer (scroll + mutation events firing at < 100 ms intervals), **When** the layer observes these events, **Then** re-mapping is debounced (not executed on every event) and the composer is never blocked.

## Visual AC

**Aurora Glass highlight tokens (from §I delta):**
- `GreenWash`: `background: var(--xb-highlight-green-wash)` — `hsl(150 72% 50% / 0.14)`; no border, no glow; covers the full composer text region bounding box.
- `BlueHighlight` (warning severity): `background: var(--xb-highlight-blue-warn)` — `hsl(205 96% 62% / 0.34)`; 1px bottom border `var(--xb-highlight-blue)`.
- `BlueHighlight` (suggestion severity): `background: var(--xb-highlight-blue-suggest)` — `hsl(205 96% 62% / 0.20)`; 1px bottom border `var(--xb-highlight-blue)` at lower opacity.
- Blue color (`hsl(205 96% 62%)`) is distinct from X's own link/action blue (`#1d9bf0`) by design.
- Green color (`hsl(150 72% 50%)`) is distinct from X's own accent by design.

**Required states:**
- **Green (generated):** single `GreenWash` div; no blue spans; covers full composer text rect.
- **Blue (user-written with annotations):** `N` `BlueHighlight` spans positioned precisely; no green wash.
- **Empty (user-written, no annotations / loading / error / no composer):** layer renders nothing visible.
- **Degrade (error / empty rects):** layer renders nothing; no visible artefact; no layout shift.

**Hover state (per `BlueHighlight`):** `pointer-events: auto`; `:hover` → `opacity: 1` (from 0.8 default); hover tooltip showing `recommendation` text is implemented in a future ticket (XOB-027); at this ticket, `aria-label` on the span carries the recommendation.

**`data-xtheme="default"` (X white):** both highlight colors are RGBA with alpha — they blend correctly on light backgrounds. No specific light-theme override needed.

**Reduced motion:** no CSS transitions on highlight rect positions at this ticket (rects snap to position on each debounce tick). Smooth repositioning animation is deferred; if added later, must be gated with `@media (prefers-reduced-motion: reduce) { transition: none }`.

**P2 jitter note (carried from tickets/README.md):** during rapid typing, highlights may "stutter" as the debounce fires and rects are recomputed from a mid-edit DOM state. Correctness is preserved (empty rects drop gracefully); the visual jitter is acceptable for v1. If jitter is jarring in practice, consider only re-mapping on debounce *end* (trailing edge only) — implementation detail left to the implementor.

## Edge Cases

- Composer DOM uses nested `<span>` elements (X rich-text formatting): `textContent` on the root element collapses all spans; the Range API requires a leaf `Text` node as the range start/end container. The locate algorithm must walk `TreeWalker(composerEl, NodeFilter.SHOW_TEXT)` to find the correct `Text` node and character offset — not assume `composerEl.firstChild` is a `Text` node.
- Quote spans across multiple `Text` nodes (e.g. mid-quote `<span>` inserted by X for hashtag coloring): `textContent` still matches (concatenation), but `setStart`/`setEnd` across different text nodes via the collapsed-offset approach may produce unexpected rects. Acceptable behavior: produce rects covering the approximate region; do not throw; do not crash. This is a known limitation documented in a code comment.
- `getBoundingClientRect()` returns all-zero rect (composer not yet laid out or off-screen): treat as `composerEl === null` — render nothing, schedule retry on next debounce tick.
- Rapid `annotations` prop updates (judge result arrives mid-typing): cancel pending debounce, schedule fresh re-map; the layer shows stale highlights until the new debounce tick fires (acceptable gap, ≤ 120 ms).
- Shadow host is itself inside a CSS transform or scrolled container: `getClientRects()` returns viewport-relative rects; the layer's absolute positioning must offset from the shadow host's own `getBoundingClientRect().top/left`, not from `{0,0}`. Implement a `getLayerOrigin()` utility that returns the shadow root's host element rect.

## Pipeline Log

Lane: rgb-tdd lean Red-first (Red self-validates → Green → combined Blue+Yellow → `[FND]` architectural checkpoint).

| Station | Commit | Result |
|---|---|---|
| pre-Red SHA | `d35a714` | base |
| Red (failing tests, self-validated) | `14fb458` | scope/ticket-ids gates pass; browser-mode Chromium harness |
| Green (impl) | `5cbf451` | 183 tests pass; typecheck 10/10; overlay build self-contained; `gates.py all` clean |
| Blue (validate Green) | — | **APPROVE_WITH_CONCERNS** — empirically verified rendered `spanRect.left = quoteRect.left` (Δ 0px); offsets telescope through non-`{0,0}` shadow-host origin; two-state XOR enforced structurally at the data source (`useHighlightRects(el, showGreen ? [] : annotations)`), not just the render branch. Red's `span.style.left < composerRect.left` (test line 661) encodes a test-artifact, not a real invariant. |
| Yellow (intent/wiring) | — | **APPROVE_WITH_CONCERNS** — two-state exclusivity enforced; X-policy non-invasive; zero-trace; offsetParent/transform/scroll-safe via `getLayerOrigin()`. |
| `[FND]` architectural checkpoint (Blue) | — | **APPROVE** — `{composerEl, annotations, showGreen}` contract closed against XOB-023 (provenance drives `showGreen`) and XOB-027 (apply→green is an atomic prop flip; green branch starves the §16.4 pipeline so no stale blue underlay survives). Positioning substrate sound for XOB-029's moving modal. Refactor **deferred** (dual-origin telescopes to 0px — correct math, not luck; no downstream ticket forced to work around it; the L2 skew fix is XOB-029's natural job regardless; refactor is internal-only → zero contract churn deferring it). |

### Concerns Ledger

| # | Concern | Owner | Resolution |
|---|---|---|---|
| L1 | **Dual coordinate origin** (host-vertical / composer-horizontal). Renders 0px-correct but mixes two origins; Red's `span.style.left < composerRect.left` (test line 661) protects the artifact, not the goal. | XOB-022 follow-up cleanup | Refactor to single host origin (`rect − layerOrigin` uniform) + recalibrate Red's assertion to rendered-rect-within-composer (the invariant already correct at test lines 192–194). Internal only; no contract change. Non-blocking for XOB-023. |
| L2 | **Transient multi-source-read skew** — `getLayerOrigin(layerRef.current)` and `useComposerRect` read on separate ticks; during modal motion they can momentarily disagree (self-healing within ≤1 debounce/frame). | **XOB-029** | **RESOLVED in XOB-029** (`8e2e53c`): `useComposeSnapshot` reads host origin + modal + composer rect together in ONE rAF pass, feeding both the pins and the single `CompositionHighlightLayer`. |
| L3 | **Green-state `useHighlightRects` re-arm loop** — when `showGreen`, the layer passed a FRESH `[]` literal each render → the §16.4 locate effect (deps `[composerEl, annotations]`) re-armed → `flushSync(setRects)` → re-render → loop (latent; deadlocks under a `runAllTimers`-style drain). Exposed by XOB-029's green-state integration. | **RESOLVED in XOB-029** (`8e2e53c`) | Changed to a frozen module-level `EMPTY_ANNOTATIONS` singleton (reference-stable). Behavior-preserving (same empty-annotations / GreenWash / zero-blue semantics); 24 highlight tests stay green. Ratified by Blue + Yellow as a minimal, in-scope latent-bug fix shipped with XOB-029. |
