---
status: done
---

# XOB-018: [FND] Overlay shadow-DOM injection host + Aurora Glass neon tokens

> **Test-harness decision (supersedes the "JSDOM" wording in Test Strategy below):** the overlay package uses **Vitest browser mode → Playwright Chromium (headless)** with `vitest-browser-react`, NOT jsdom. Rationale: this ticket's ACs require `getComputedStyle` to resolve the `--xb-*` custom properties from `adoptedStyleSheets`, and XOB-022 needs real `Range.getClientRects()` — neither jsdom nor happy-dom has a layout engine or faithful constructed-stylesheet resolution. Browser mode also matches production (the overlay runs in real Chromium via Playwright). This [FND] ticket establishes that harness for all of XOB-019–029.

## Implementation Details

**Components / symbols:**

- `bootstrap()` — entry function called by `addInitScript`; `requestIdleCallback`-gated; idempotent (mounts once per document, guarded by `document.getElementById("xb-overlay-root")` check).
- `OverlayRuntime` — empty React component (tree root); rendered into the shadow mount node via `createRoot`. Accepts no props at this ticket; placeholder for XOB-019+ wiring.
- `OverlayThemeBridge` — React component (no visible output); reads X's active theme from `document.documentElement` (`data-theme` attribute or computed `background-color` of `body`) → maps to `"default" | "dim" | "lights-out"` → sets `data-xtheme` on the `<xb-overlay-root>` host element. Polls via a `MutationObserver` on `document.documentElement`'s `data-theme` + `style` attributes (disconnects on unmount).
- `buildNeonSheet()` — returns a `CSSStyleSheet` populated with the full `--xb-*` Aurora Glass token set on `:host` plus `data-xtheme` override blocks; called once, result assigned to `shadowRoot.adoptedStyleSheets`.

**Props interfaces:**

```ts
// OverlayRuntime — no props at this ticket (children wired in XOB-019+)
interface OverlayRuntimeProps {}

// OverlayThemeBridge
interface OverlayThemeBridgeProps {
  hostEl: HTMLElement; // the <xb-overlay-root> element; bridge writes data-xtheme here
}
```

**State level:** `OverlayThemeBridge` theme-map result is L3 (cross-overlay, stored on the host element via `data-xtheme`; pure DOM side-effect, no React state).

**Token set seeded on `:host` (complete — verified against §6.2 + §I delta):**

```
--xb-accent          hsl(174 90% 52%)
--xb-accent-2        hsl(316 88% 62%)
--xb-judge           hsl(192 95% 60%)
--xb-surface-panel   hsl(210 28% 9% / 0.72)
--xb-surface-overlay hsl(210 30% 7% / 0.88)
--xb-border-edge     hsl(174 90% 52% / 0.55)
--xb-glow-sm         0 0 8px hsl(174 90% 52% / 0.35)
--xb-glow-md         0 0 18px hsl(174 90% 52% / 0.40)
--xb-glow-judge      0 0 12px hsl(192 95% 60% / 0.45)
--xb-text            hsl(180 25% 96%)
--xb-text-muted      hsl(195 18% 74%)
--xb-band-post-now   hsl(150 70% 50%)
--xb-band-slight     hsl(174 90% 52%)
--xb-band-major      hsl(42 92% 60%)
--xb-band-donot      hsl(352 85% 62%)
--xb-pulse-duration  1100ms
--xb-glass-blur      12px
--xb-z-pin           2147483000
--xb-z-panel         2147483100
--xb-z-popover       2147483200
--xb-highlight-green       hsl(150 72% 50%)
--xb-highlight-green-wash  hsl(150 72% 50% / 0.14)
--xb-highlight-blue        hsl(205 96% 62%)
--xb-highlight-blue-warn   hsl(205 96% 62% / 0.34)
--xb-highlight-blue-suggest hsl(205 96% 62% / 0.20)
```

`data-xtheme="default"` override block: panel opacity → `0.94`, `--xb-text` → `hsl(200 30% 12%)`, glow opacity halved.

## Data Models

No transport, no schemas. The only shared artifact this ticket exports:

```ts
// @x-builder/overlay — overlay/src/bootstrap.ts
export function bootstrap(): void;

// overlay/src/theme-bridge.tsx
export function OverlayThemeBridge(props: OverlayThemeBridgeProps): null;
```

## Integration Point

**Parent mount:** `addInitScript` (XOB-015) calls `window.__xbBootstrap()` which calls `bootstrap()`. The overlay IIFE bundles `bootstrap` and assigns it to `window.__xbBootstrap` at module evaluation time.

**How the user reaches it:** transparent — runs automatically before X's own scripts (`addInitScript` = `document_start` equivalent). The user never interacts with this ticket directly; it is the prerequisite for every visible affordance.

**Terminal outcome:** `<xb-overlay-root>` shadow host exists on `document.documentElement`; `:host` carries the full `--xb-*` token set; `data-xtheme` reflects the active X theme; an empty `OverlayRuntime` React root is mounted. Nothing visible to the user yet.

## Scope Boundaries / Out of Scope

**May change:** `overlay/src/bootstrap.ts`, `overlay/src/runtime.tsx`, `overlay/src/theme-bridge.tsx`, `overlay/src/neon-sheet.ts`, `overlay/src/index.ts` (IIFE entry assigning `window.__xbBootstrap`).

**ZERO-TRACE (no code, no stubs):** no transport, no `useTransport`, no `XSelectors`, no `AnchorLayer`, no `SettingsAffordance`, no `MetricExplainer`, no `CompositionHighlightLayer`, no `ProvenanceController`, no `ComposeCockpit`. No mutations to `document.body` or any X-owned element (only `document.documentElement.appendChild` of the host). No `position:fixed` elements. No paint-blocking work (all mount logic deferred to `requestIdleCallback`).

## Test Strategy & Fixture Ownership

**Suite:** Vitest + RTL (shadow-aware, via `attachShadow` in JSDOM). Owned entirely by `@x-builder/overlay`.

**Tests:**

- `bootstrap()` called twice on the same document → exactly one `<xb-overlay-root>` present (idempotency).
- `bootstrap()` → `shadowRoot.adoptedStyleSheets` contains the neon sheet → `getComputedStyle` on the shadow mount node resolves `--xb-accent` (verify token seeding).
- All 25 `--xb-*` tokens enumerated above are present and non-empty on `:host`.
- `OverlayThemeBridge`: mock `document.documentElement` with `data-theme="dim"` → `hostEl.dataset.xtheme === "dim"` after mount; simulate attribute change → bridge updates.
- Simulated SPA navigation (replace `document.head`, trigger `navigation` event) → host element count stays 1 after re-check call.
- No mutation to `document.body` or any element other than `document.documentElement` (spy on `document.body.appendChild`).

**Fixture strategy:** plain JSDOM DOM — no external fixture files needed. No `FakeEngineTransport` (transport wired in XOB-019).

## Definition of Done

- `bootstrap()` mounts `<xb-overlay-root>` with open shadow DOM exactly once per document, guarded against re-entry.
- `adoptedStyleSheets` carries the full 25-token `--xb-*` Aurora Glass set on `:host`.
- `OverlayThemeBridge` keeps `data-xtheme` in sync with X's active theme (Default / Dim / Lights Out).
- `createRoot` renders an empty `OverlayRuntime` into the shadow mount node — no visible output.
- All mount work is `requestIdleCallback`-gated; x.com paint is never blocked.
- No element in `document.body` or any X-owned DOM is modified.
- Unit tests pass (idempotency, token seeding, theme bridge, no-body-mutation).
- `pnpm typecheck` and `pnpm build` green.

## Acceptance Criteria

- **Given** a fresh document (X page load), **When** `bootstrap()` runs via `addInitScript`, **Then** exactly one `<xb-overlay-root>` element is appended to `document.documentElement`, with `attachShadow({mode:"open"})`, and `shadowRoot.adoptedStyleSheets` is non-empty.
- **Given** the shadow root, **When** `getComputedStyle` is queried on the mount node inside it, **Then** `--xb-accent` resolves to `hsl(174 90% 52%)` and all 25 `--xb-*` tokens (including `--xb-highlight-green`, `--xb-highlight-blue`, and their wash/warn/suggest variants) are present and non-empty.
- **Given** X is in Dim theme (`data-theme="dim"` on `<html>`), **When** `OverlayThemeBridge` mounts, **Then** `<xb-overlay-root data-xtheme="dim">` is set within one observer tick.
- **Given** X switches to Lights Out theme, **When** the `data-theme` attribute changes, **Then** `data-xtheme` updates correspondingly without a React remount.
- **Given** `bootstrap()` is called a second time (simulated SPA navigation), **When** the document is inspected, **Then** only one `<xb-overlay-root>` exists (idempotency guard holds).
- **Given** a user observing the X page, **When** `bootstrap()` has run, **Then** no element in `document.body` has been mutated, no paint-blocking synchronous work was performed, and nothing is visually rendered (the shadow host produces no paint output at this ticket).

## Visual AC

**Required states at this ticket:** nothing visible. The host element has `display: contents` (or equivalent zero-paint rule) on `:host` so it contributes no box.

**Aurora Glass token verification (not visible, but inspector-checkable):**
- `:host` computed style includes `--xb-surface-panel` with alpha channel (glass translucency).
- `:host[data-xtheme="default"]` override block raises `--xb-surface-panel` opacity to `0.94` and sets `--xb-text` to `hsl(200 30% 12%)`.
- `--xb-glow-sm`, `--xb-glow-md`, `--xb-glow-judge` carry box-shadow values (not `none`).
- `--xb-highlight-green-wash` and `--xb-highlight-blue` present (highlight layer prereq).

**Reduced motion:** no animations at this ticket (none seeded). The gated keyframe pattern (`@media (prefers-reduced-motion: reduce)`) for the judge pulse must be present in the neon sheet as a stub override that reduces `--xb-pulse-duration` to `0ms` — even though no animation is running yet — so XOB-022+ inherit the correct pattern.

## Edge Cases

- `requestIdleCallback` unavailable (unlikely in Chromium, but guard): fall back to `setTimeout(fn, 0)`.
- `CSSStyleSheet` constructor / `adoptedStyleSheets` unavailable: warn via `console.warn("[xb] adoptedStyleSheets unavailable — neon sheet skipped")` and continue without the sheet (affordances will be unstyled but the React tree will still mount for later graceful degrade).
- `attachShadow` already called on an element that was removed from DOM then re-appended: the idempotency check (`document.querySelector("#xb-overlay-root")`) prevents double-mounting regardless of the element lifecycle.
- X's dark/light theme derived from `body` background color (no `data-theme` attribute on some X layouts): `OverlayThemeBridge` must implement a heuristic fallback (compare `rgb(21, 32, 43)` for Dim, `rgb(0,0,0)` for Lights Out, otherwise Default) if `data-theme` is absent.

## Pipeline Log

Lean Red-first lane. **[FND]** — established the overlay test harness (**Vitest browser mode → Playwright Chromium**, NOT jsdom; see banner) for all of Wave 4.

- **Red** (`266ed7d`): set up the harness — React 19 deps, `@vitest/browser`+`vitest-browser-react@^1` (pinned for vitest 3) + `@vitejs/plugin-react`, JSX tsconfig, `overlay/vitest.config.ts` (browser mode); confirmed Chromium launches. Wrote `bootstrap.test.tsx` + `theme-bridge.test.tsx` (idempotency, open-shadow + adoptedStyleSheets, all-25-tokens via real `getComputedStyle`, display:contents, default-theme override, reduced-motion `0ms`, theme bridge + heuristic, SPA-nav, no-body-mutation). RED via missing modules; `rg "XOB-"` + lockfile clean.
- **Gates** (post-Red, base `83f1cbf`): `[ticket-ids]` CLEAN; `[scope]` CLEAN with harness files (`package.json`/`tsconfig`/`vitest.config`/lockfile) in `--allowed` (legitimate harness setup for this [FND]).
- **Green** (`5892d20`, cleanup `3c3d113`): `bootstrap` (idempotent, documentElement-only, adoptedStyleSheets-guard, `requestIdleCallback`-gated render) + `neon-sheet` (25 tokens, `:host{display:contents}`, `:host([data-xtheme="default"])` override, reduced-motion stub) + `theme-bridge` (data-theme + heuristic + observer-disconnect) + `OverlayRuntime` (empty root) + IIFE `window.__xbBootstrap`. **Browser mode caught a real bug** (`:host[data-xtheme]` → `:host([data-xtheme])` shadow-selector syntax) jsdom would have missed. 42 tests in real Chromium, typecheck 10/10, build 7/7, IIFE self-contained. Cleanup removed an inert eslint-disable (repo has no eslint).
- **Gates** (post-Green, base `266ed7d`): `[suppressions]`/`[ticket-ids]`/`[stubs]`/`[slop]` CLEAN; `[ui-tokens] 33` all confined to `neon-sheet.ts` (the token-definition source) — ruled justified; zero leaks into components.
- **Blue (Validate Green)**: APPROVE — substrate/tokens/theme/IIFE correct, 42 browser-mode tests pass, token discipline holds (components clean), typecheck+build honest (cache-bypassed).
- **Yellow (intent/UI)**: APPROVE — real shadow host, ZERO-TRACE (no later-affordance code, no body mutation, no position:fixed, idle-gated), Aurora Glass 25/25 fidelity, foundation seams at the right altitude.
- **[FND] Architectural checkpoint (Blue)**: APPROVE — substrate complete for XOB-019–029 mounts, 25-`--xb-*` contract covers every downstream consumer, shadow-isolation + theme-pairing + reduced-motion-stub sound, no drift. XOB-019 cleared.

### Concerns Ledger — CARRIED TO XOB-019 (resolve before visible components)
- **Design-system primitive tokens not seeded in the shadow root.** Downstream overlay components consume a SECOND token family — `--space-*`/`--type-*`/`--radius-*`/`--score-*` — defined `:root`-scoped in `docs/design-system/product-tokens.css`. The overlay is shadow-isolated (`:host{display:contents}`) and x.com defines no `:root` design tokens, so these **won't resolve inside the shadow root** unless seeded. XOB-018 correctly delivered only its specified `--xb-*` contract (per arch-report line 126). **XOB-019 must seed the consumed `--space/--type/--radius/--score` primitives onto the shadow `:host`** (extend the neon sheet or add a base-tokens sheet) so XOB-021 (`--type-caption`/`--radius-md`), XOB-024 (`--space-2`), XOB-025 (`--score-*`), XOB-026/029 resolve. First bites at XOB-021/025.
- **Bundle size:** the overlay IIFE is ~583 KB (React bundled). Acceptable for v1 (injected once via `addInitScript`); candidate post-v1 optimization (externalize React / preact-compat). Non-blocking.
- Status → **done**.
