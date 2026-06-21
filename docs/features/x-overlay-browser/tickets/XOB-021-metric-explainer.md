---
status: todo
---

# XOB-021: Metric explainer

## Implementation Details

**Components / symbols:**

- `MetricExplainer` — orchestrator: renders `ExplainerTrigger` always; renders `ExplainerPopover` when `expanded === true`; resolves copy from `overlayExplainerCopy[metricKey]` with an optional L1 override (see Data Models); manages `expanded` toggle (L4).
- `ExplainerTrigger` — ghost `IconButton`-derived `<button>` rendering a quiet "ⓘ" icon; `aria-expanded`, `aria-controls` pointing to popover id; `aria-label="Explain [label]"`; placed inline after the metric label text.
- `ExplainerPopover` — `role="dialog"`, `aria-label="[label] — metric explainer"`, `aria-modal="false"` (non-modal: Shift-Tab must be able to reach x.com); `id` matching `ExplainerTrigger`'s `aria-controls`. Sections: metric label + `whatItMeans` paragraph + `howToRead` paragraph + optional band scale rendered via two `Badge` components (`lowLabel` / `highLabel`). Closes on `Esc` (focus returns to trigger), click-outside (composedPath). Positioned absolutely relative to trigger with collision-flip.
- `overlayExplainerCopy` — typed `Record<MetricKey, ExplainerEntry>` constant (static default); exported from `overlay/src/explainer/copy.ts`.
- `MetricKey` — union type of all valid keys: the 13 judge dimensions (`overall`, `voiceMatch`, `strangerAnswerability`, `opinionClarity`, `negativeRisk`, `statusDependency`, `noveltySignal`, `cta`, `audienceMatch`, `brevityFit`, `replyVsQuoteOrientation`, `hookStrength`, `contentDepth`) + deterministic Post Coach checks (`repetition`, `postCoach`, and per-flag variants) + reach fields (`reachRange`, `reachMidpoint`, `escapeProbability`, `stallRange`, `escapeRange`).

**Props interfaces:**

```ts
interface MetricExplainerProps {
  metricKey: MetricKey;
  source?: ExplainerSource; // L1 override; if absent, falls back to overlayExplainerCopy
  value?: number;           // current metric value (used to highlight the relevant band)
  band?: string;            // current band label for context
}

interface ExplainerEntry {
  label: string;
  whatItMeans: string;
  howToRead: string;
  scale?: { lowLabel: string; highLabel: string };
  goodDirection: "higher" | "lower" | "poled";
}

type ExplainerSource = Record<MetricKey, ExplainerEntry>;
```

**Direction legend rules (non-negotiable):**

- `goodDirection: "lower"` (applies to `negativeRisk`, `statusDependency`): `howToRead` must contain the phrase "lower is better" and the scale's `lowLabel` renders first (favorable end left).
- `goodDirection: "poled"` (applies to `replyVsQuoteOrientation`): `howToRead` must explain that neither pole is inherently good; no directional legend arrow; scale shows both poles labeled without a "better/worse" direction indicator.
- `goodDirection: "higher"` (all other dims): default — scale left is low/bad, right is high/good.

**State levels:**

- `expanded` — L4 (local to each `MetricExplainer` instance; multiple explainers can be open simultaneously if a parent allows, but the conventional usage is one-at-a-time managed by the metric host).
- `ExplainerEntry` copy — L1 override if `source` prop is provided; otherwise static constant (no async fetch at this ticket; the transport hook for L1 copy is an optional extension point).

**Note — blue annotations vs explainer (§G of delta):** `CompositionHighlightLayer` blue span annotations (XOB-022/027) explain specific *words* in the draft via inline hover targets. `MetricExplainer` explains the *metric* (aggregate dimension). Both coexist and serve distinct purposes; this ticket owns the aggregate metric explanation only.

## Data Models

```ts
// overlay/src/explainer/copy.ts — static default, shipped with bundle
export const overlayExplainerCopy: Record<MetricKey, ExplainerEntry> = {
  // 13 judge dimensions — each with label, whatItMeans, howToRead, scale, goodDirection
  overall:                 { label: "Overall", whatItMeans: "...", howToRead: "higher is better ...", scale: { lowLabel: "0 · weak", highLabel: "100 · strong" }, goodDirection: "higher" },
  voiceMatch:              { ... goodDirection: "higher" },
  strangerAnswerability:   { ... goodDirection: "higher" },
  opinionClarity:          { ... goodDirection: "higher" },
  negativeRisk:            { label: "Negative risk", whatItMeans: "chance the post reads as inflammatory, dunk-bait, or likely to draw pile-ons", howToRead: "lower is better. Under ~30 is calm; over ~60 means soften the framing.", scale: { lowLabel: "0 · calm", highLabel: "100 · risky ↑" }, goodDirection: "lower" },
  statusDependency:        { label: "Status dependency", whatItMeans: "how much reach depends on your existing follower count rather than the post's own pull", howToRead: "lower is better. Posts that travel on content spread further than posts that rely on status.", scale: { lowLabel: "0 · content-led", highLabel: "100 · status-led ↑" }, goodDirection: "lower" },
  noveltySignal:           { ... goodDirection: "higher" },
  cta:                     { ... goodDirection: "higher" },
  audienceMatch:           { label: "Audience match", whatItMeans: "...", howToRead: "higher is better — null means insufficient data", scale: ..., goodDirection: "higher" },
  brevityFit:              { ... goodDirection: "higher" },
  replyVsQuoteOrientation: { label: "Reply vs quote orientation", whatItMeans: "whether this post is optimized to invite replies or to be quote-tweeted", howToRead: "neither pole is better — the right orientation depends on your goal. Replies grow conversation; quotes spread reach.", scale: { lowLabel: "← replies", highLabel: "quotes →" }, goodDirection: "poled" },
  hookStrength:            { ... goodDirection: "higher" },
  contentDepth:            { ... goodDirection: "higher" },
  // Deterministic Post Coach checks
  repetition:              { label: "Repetition / cooldown", ... goodDirection: "lower" },
  postCoach:               { label: "Post coach", ... goodDirection: "higher" },
  // Reach fields
  reachRange:              { label: "Reach range", ... goodDirection: "higher" },
  reachMidpoint:           { label: "Reach midpoint", ... goodDirection: "higher" },
  escapeProbability:       { label: "Escape probability", ... goodDirection: "higher" },
  stallRange:              { label: "Stall range", ... goodDirection: "lower" },
  escapeRange:             { label: "Escape range", ... goodDirection: "higher" },
};
```

The exact copy text for each entry is authored as part of this ticket. Placeholder ellipsis above indicates where implementation fills in real, user-facing prose — every entry must be non-empty before DoD.

## Integration Point

**Parent mount:** `MetricExplainer` is a leaf component rendered inline by any metric host — `MetricSlotGroup` (static dims), `JudgePanelOverlay` dim rows, `ReachPredictionBlock`, `PostCoachStrip`. It is not owned by `AnchorLayer` or any panel component directly.

**How the user reaches it:** the `ExplainerTrigger` "ⓘ" button appears after every metric label. User clicks (or `Enter`/`Space`) to open the `ExplainerPopover`. `Esc` closes and returns focus to the trigger.

**Terminal outcome:** user understands what the metric means, how to read it, and which direction is favorable — without leaving the compose flow.

## Scope Boundaries / Out of Scope

**May change:** `overlay/src/explainer/metric-explainer.tsx`, `overlay/src/explainer/explainer-trigger.tsx`, `overlay/src/explainer/explainer-popover.tsx`, `overlay/src/explainer/copy.ts`, `overlay/src/explainer/types.ts`.

**ZERO-TRACE (no code, no stubs):** no `StaticEngineColumn`, no `JudgeStrip`, no `CompositionHighlightLayer`, no `ProvenanceController`, no annotation hover targets. Copy is static at this ticket — no transport fetch for `getExplainerCopy()` (the optional L1 override is wired only via the `source` prop passed by a parent; the transport call is out of scope).

## Test Strategy & Fixture Ownership

**Suite:** Vitest + RTL (shadow-aware). All fixtures owned by `@x-builder/overlay`.

**Tests:**

- Every key in `MetricKey` union has a corresponding entry in `overlayExplainerCopy` — enforced by TypeScript (`Record<MetricKey, ExplainerEntry>` type) and a runtime test that asserts `Object.keys(overlayExplainerCopy).length` matches the union member count.
- `negativeRisk` entry: `goodDirection === "lower"`, `howToRead` contains "lower is better", scale `lowLabel` does not contain "bad" (verify direction framing).
- `statusDependency` entry: same lower-is-better assertions.
- `replyVsQuoteOrientation` entry: `goodDirection === "poled"`, `howToRead` does not contain "better" unqualified (no directional bias).
- `MetricExplainer` closed by default: `aria-expanded="false"` on trigger.
- Click trigger → `ExplainerPopover` appears with `role="dialog"` and correct `aria-label`.
- `Esc` inside open popover → closes, focus returns to trigger.
- Click-outside → closes.
- `source` prop override: pass a custom `ExplainerSource` with a modified `voiceMatch` entry → popover renders the overridden copy, not the static default.
- `value` and `band` props passed → rendered in the popover (band label visible in copy context).
- `audienceMatch` with `value === null` → popover renders the "null means insufficient data" note without crashing.

**Fixture strategy:** no external fixture files needed; tests construct minimal `MetricExplainer` trees with static copy defaults. `FakeEngineTransport` not required (no transport call at this ticket).

## Definition of Done

- `overlayExplainerCopy` contains a non-empty `ExplainerEntry` for every `MetricKey` (all 13 judge dims + deterministic checks + reach fields) — TypeScript-enforced, zero blank entries.
- Direction legends are correct: `negativeRisk` and `statusDependency` entries say "lower is better"; `replyVsQuoteOrientation` is poled with no directional bias.
- `ExplainerTrigger` is keyboard-reachable, announces `aria-expanded`, and opens/closes the popover.
- `ExplainerPopover` is `role="dialog"`, `Esc` closes and returns focus to trigger, click-outside closes.
- Optional L1 `source` override takes precedence over the static copy constant.
- All unit tests pass; `pnpm typecheck` green.

## Acceptance Criteria

- **Given** any metric label in the overlay, **When** the user clicks its "ⓘ" trigger, **Then** `ExplainerPopover` opens with `role="dialog"`, displaying `whatItMeans`, `howToRead`, and (if defined) the band scale.
- **Given** `ExplainerPopover` is open, **When** the user presses `Esc`, **Then** the popover closes and focus returns to the `ExplainerTrigger` button.
- **Given** `metricKey === "negativeRisk"`, **When** the popover is open, **Then** `howToRead` contains the phrase "lower is better" and the scale renders `lowLabel` on the left (favorable end).
- **Given** `metricKey === "replyVsQuoteOrientation"`, **When** the popover is open, **Then** the copy explains both poles without declaring either "better", and no directional arrow is rendered.
- **Given** a parent passes a custom `source` prop overriding `voiceMatch` copy, **When** the popover opens for `voiceMatch`, **Then** the overridden copy is displayed, not the static default.
- **Given** `metricKey === "audienceMatch"` and the metric is `null` (insufficient data), **When** the popover opens, **Then** it renders without crashing and notes that null means insufficient data.
- **Given** `overlayExplainerCopy` is evaluated, **When** TypeScript compiles the module, **Then** every `MetricKey` member has a corresponding entry (compile-time enforcement — no key may be omitted).

## Visual AC

**Aurora Glass tokens required:**
- `ExplainerTrigger`: ghost style — no fill, no border normally; `color: var(--xb-text-muted)`; `font-size: var(--font-size-xs)` (quiet, not competing with metric label).
- `ExplainerPopover`: `background: var(--xb-surface-overlay)`, `border: 1px solid var(--xb-border-edge)`, `box-shadow: var(--xb-glow-sm)`, `border-radius: var(--radius-md)`, `font: var(--type-caption)`. `color: var(--xb-text)` ≥ 4.5:1 on `--xb-surface-overlay`.
- Band scale `Badge` pair: `variant="neutral"` for both poles; `variant` tinted by `goodDirection` is not applied at the scale level (avoid false color meaning on a labeled scale).
- Direction callout text ("lower is better" / "neither pole is better"): `color: var(--xb-text-muted)`, `font: var(--type-caption)`.

**Required states:**
- **Closed (ideal):** only the quiet "ⓘ" trigger visible inline; no visual weight.
- **Open:** popover anchored near the trigger; does not overflow shadow host (collision-flip applied); `backdrop-filter: blur(var(--xb-glass-blur))`.
- **Loading (future — out of scope):** if L1 copy fetch is ever wired, a `Skeleton` would render inside the popover while loading. Not required at this ticket.
- **Null value:** `audienceMatch` with no numeric value → scale section absent; `whatItMeans` + `howToRead` still render.

**`data-xtheme="default"` (X white):** `--xb-surface-overlay` uses its opacity-0.94 override; text color switches to dark; teal edge stays legible.

**Reduced motion:** no animation in this component. The popover appears/disappears without CSS transitions at this ticket (transitions may be added later; the gated-keyframe pattern is not needed here).

**High-contrast mode (`[data-contrast=high]`):** drop `backdrop-filter`, solidify `border` to `2px solid var(--xb-accent)`, increase `--xb-text` to pure white.

## Edge Cases

- Popover width exceeds viewport on narrow X layout: `max-width: min(320px, 90vw)` constraint; internal text wraps.
- `metricKey` not found in `overlayExplainerCopy` at runtime (possible if copy map and key union get out of sync via a downstream bug): render a fallback "No description available" copy; do not crash.
- Multiple `MetricExplainer` instances open simultaneously (e.g. user Tab-walks through all triggers): each is independent (separate `expanded` state per instance); closing one does not affect others. Hosts that want one-at-a-time behavior must implement it at the metric host level (out of scope for this component).
- Very long `whatItMeans` copy: popover scrolls internally (`max-height: 60vh; overflow-y: auto`) rather than growing off-screen.
- `aria-controls` pointing to an id that hasn't rendered yet (popover conditionally rendered): use `aria-expanded` as the primary SR signal; the `aria-controls` is best-effort and may be absent when closed (acceptable per ARIA spec for conditional rendering).
