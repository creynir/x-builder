---
status: todo
---

# XOB-019: [FND] Transport-consuming client seam (`useTransport`) + `XSelectors` + `AnchorLayer` skeleton

## Implementation Details

**Components / symbols:**

- `OverlayTransportProvider` — React context provider; wraps `window.__xbTransport` (typed as `EngineTransport`) in a stable ref; renders `OverlayRuntime`'s children. Provides the single point where `FakeEngineTransport` is substituted in tests.
- `useTransport()` — React hook; reads from `OverlayTransportContext`; throws if called outside the provider (dev-only invariant check).
- `EngineTransport` — interface (imported from `@x-builder/shared`, defined in XOB-002); typed to exactly 17 methods: `getOverlayReadiness`, `getStatus`, `getSettings`, `updateSettings`, `validateArchive`, `importArchive`, `getActiveContext`, `activateContext`, `deactivateContext`, `analyzePosts`, `judgeDraft`, `generateIdeas`, `suggestPost`, `getCooldown`, `getCaptureSummary`, `getGenerateCategories`, `applyJudgeSuggestions`. Each method is `async`, structured-clone JSON only.
- `FakeEngineTransport` — test-only implementation of `EngineTransport`; all 17 methods return configurable promises (default: `Promise.resolve({})`); exported from `overlay/src/testing/fake-transport.ts`.
- `XSelectors` — plain object of `data-testid` and structural selector strings (the only file in the overlay that contains unofficial X selector strings):
  ```ts
  export const XSelectors = {
    COMPOSER_TEXTAREA:  'div[data-testid="tweetTextarea_0"]',
    COMPOSER_BUTTON:    'div[data-testid="tweetButton"]',
    COMPOSER_DIALOG:    '[role="dialog"]',
    TWEET_ARTICLE:      'article[data-testid="tweet"]',
    TWEET_TEXT:         'div[data-testid="tweetText"]',
  } as const;
  ```
- `safeQuery(root: ParentNode, selector: string): Element | null` — wraps `root.querySelector`, catches, increments `selectorMissCount`, returns `null` on miss or throw.
- `safeQueryAll(root: ParentNode, selector: string): Element[]` — same contract, returns `[]`.
- `selectorMissCount` — module-level counter (number); exported for `ReadinessIndicator` to surface the "layout changed" flag when misses exceed a threshold.
- `AnchorLayer` — React component (renders `null` visually at this ticket, skeleton only); mounts a single `MutationObserver(document.body, {childList: true, subtree: true})` batched via `requestAnimationFrame` and debounced ~150 ms; reconciles a `Map<Element, AffordanceHandle>` node→pin registry; calls `safeQueryAll` on each tick; disconnects when `document.visibilityState === "hidden"` (`visibilitychange` event); zero matches is a valid state (no error thrown, no render side-effect at this ticket).

**Props interfaces:**

```ts
interface OverlayTransportProviderProps {
  transport: EngineTransport;
  children: ReactNode;
}

// AnchorLayer — no external props at this ticket (pins wired in XOB-025+)
interface AnchorLayerProps {}
```

**State levels:**

- `OverlayTransportProvider`: L3 (cross-overlay; the transport reference is stable for the lifetime of the shadow root).
- `AnchorLayer` pin registry: L3 (`Map<Element, AffordanceHandle>`, owned by `AnchorLayer`, shared via a separate `AnchorRegistryContext`). The registry is empty at this ticket (no pins mounted).
- `selectorMissCount`: module-level (L3 global within the overlay bundle); not stored in React state.

## Data Models

```ts
// @x-builder/shared — EngineTransport (defined in XOB-002; overlay imports type only)
interface EngineTransport {
  getOverlayReadiness(): Promise<OverlayReadiness>;
  getStatus(): Promise<unknown>;
  getSettings(): Promise<AppSettings>;
  updateSettings(next: AppSettings): Promise<void>;
  validateArchive(file: File): Promise<ArchiveValidationResult>;
  importArchive(file: File): Promise<void>;
  getActiveContext(): Promise<ActiveContext>;
  activateContext(): Promise<void>;
  deactivateContext(): Promise<void>;
  analyzePosts(request: AnalyzePostsRequest): Promise<AnalyzePostsResponse>;
  judgeDraft(request: JudgeDraftRequest): Promise<JudgeDraftResponse>;
  generateIdeas(request: GenerateIdeasRequest): Promise<GenerateIdeasResponse>;
  suggestPost(): Promise<SuggestPostResponse>;
  getCooldown(): Promise<CooldownReport>;
  getCaptureSummary(): Promise<CaptureSummary>;
  getGenerateCategories(): Promise<GenerateCategory[]>;
  applyJudgeSuggestions(request: { text: string }): Promise<ApplyJudgeSuggestionsResponse>;
}

// AffordanceHandle — internal to AnchorLayer
interface AffordanceHandle {
  anchorEl: Element;
  rect: DOMRect;
  type: "composer" | "tweet";
}
```

## Integration Point

**Parent mount:** `OverlayTransportProvider` wraps `OverlayRuntime`'s children in `bootstrap()` (XOB-018). `AnchorLayer` is rendered as a child of `OverlayRuntime` at this ticket (empty, skeleton only).

**How the user reaches it:** not directly — transport seam and anchor layer are infrastructure. Components in XOB-020+ call `useTransport()` to make engine calls; `AnchorLayer` pins activate in XOB-025+.

**Terminal outcome:** any overlay component can call `useTransport()` and receive a fully typed `EngineTransport`; `XSelectors` + `safeQuery` can be imported anywhere in the overlay; `AnchorLayer` runs its `MutationObserver` loop and keeps the pin registry (empty at this ticket, no errors on zero matches).

## Scope Boundaries / Out of Scope

**May change:** `overlay/src/transport/provider.tsx`, `overlay/src/transport/use-transport.ts`, `overlay/src/transport/engine-transport.ts` (re-export type from shared), `overlay/src/testing/fake-transport.ts`, `overlay/src/selectors.ts`, `overlay/src/anchor-layer.tsx`, `overlay/src/runtime.tsx` (wires provider + anchor layer).

**ZERO-TRACE (no code, no stubs):** no `SettingsAffordance`, no `MetricExplainer`, no `CompositionHighlightLayer`, no `ProvenanceController`, no `ComposeCockpit`, no `ComposeGenerateRail`, no `StaticEngineColumn`, no `JudgeStrip`, no `SuggestAffordance`. `AnchorLayer` mounts no actual pin components (empty registry output). No DOM mutation beyond the observer attachment. No `window.__xbTransport` polyfill — if `window.__xbTransport` is absent, `OverlayTransportProvider` renders children unchanged and logs a dev-mode warning.

## Test Strategy & Fixture Ownership

**Suite:** Vitest + RTL (shadow-aware). All fixtures owned by `@x-builder/overlay`.

**Tests:**

- `useTransport()` inside `OverlayTransportProvider` with a `FakeEngineTransport` → resolves all 17 method calls without error.
- `useTransport()` outside a provider → throws (dev invariant) or returns a meaningful error in test mode.
- `safeQuery(document, "#nonexistent")` → returns `null` and increments `selectorMissCount` by 1.
- `safeQueryAll(document, 'div[data-testid="tweetTextarea_0"]')` when no matching element → returns `[]` and increments `selectorMissCount`.
- `safeQuery` with a `querySelector` that throws (e.g. invalid selector passed via forged string) → returns `null`, increments miss count, does not propagate.
- `AnchorLayer` mounted with an empty DOM → no error thrown, no pin rendered, registry is empty (`Map.size === 0`).
- `AnchorLayer`: JSDOM body mutated (element added/removed) → observer fires → registry reconcile runs → still empty (no `XSelectors` targets present) → no error.
- `AnchorLayer` disconnects observer when `document.visibilityState` becomes `"hidden"` (simulate `visibilitychange`).
- `FakeEngineTransport` implements all 17 `EngineTransport` methods (TypeScript enforced + runtime check at test init: `Object.keys(fake).length === 17`).

**Fixture strategy:** plain JSDOM DOM with `OverlayTransportProvider` wrapping test trees; `FakeEngineTransport` as the injected transport. No live x.com selectors needed — tests use synthetic DOM only.

## Definition of Done

- `OverlayTransportProvider` and `useTransport()` compile against the `EngineTransport` interface from `@x-builder/shared` with zero type errors.
- `FakeEngineTransport` implements all 17 methods; exported from `overlay/src/testing/`.
- `XSelectors` constants are the single source for all X `data-testid` strings in the overlay; no other file hardcodes them.
- `safeQuery` / `safeQueryAll` return null/[] on miss and increment `selectorMissCount` — never throw.
- `AnchorLayer` runs its rAF-batched `MutationObserver` loop; zero matches does not error; observer disconnects on `visibilitychange` hidden.
- All unit tests pass.
- `pnpm typecheck` and `pnpm build` green.

## Acceptance Criteria

- **Given** `OverlayTransportProvider` wrapping a component that calls `useTransport()`, **When** the component calls any of the 17 methods on the returned transport, **Then** the call resolves without error (using `FakeEngineTransport`).
- **Given** a DOM with no elements matching `XSelectors.COMPOSER_TEXTAREA`, **When** `safeQuery(document.body, XSelectors.COMPOSER_TEXTAREA)` is called, **Then** it returns `null` and `selectorMissCount` increments by 1.
- **Given** `safeQueryAll` called with a valid selector that matches nothing, **When** called, **Then** it returns `[]` and does not throw.
- **Given** `AnchorLayer` mounted, **When** `document.body` is mutated (nodes added/removed), **Then** the `MutationObserver` fires, the reconcile loop runs, and no error is thrown even when no `XSelectors` targets are found; the pin registry remains `Map.size === 0`.
- **Given** `AnchorLayer` running, **When** `document.visibilityState` changes to `"hidden"`, **Then** the `MutationObserver` is disconnected.
- **(Negative)** **Given** this ticket's diff, **When** overlay sources are inspected, **Then** no `SettingsAffordance`, `MetricExplainer`, `CompositionHighlightLayer`, `ProvenanceController`, or `ComposeCockpit` symbols are present (zero-trace).

## Visual AC

None — this ticket is infrastructure only. The `AnchorLayer` renders nothing visible. The only observable browser-side effect is the `MutationObserver` attachment on `document.body`, which is not user-facing.

**Selector-miss flag:** `selectorMissCount` is the internal counter; no UI is shown at this ticket. When a downstream component (XOB-020's `ReadinessIndicator`) reads it, it surfaces "X layout changed — affordances paused" — but that rendering is out of scope here.

**Reduced motion:** no motion at this ticket.

## Edge Cases

- `window.__xbTransport` absent at mount time (e.g. runner not yet bound): `OverlayTransportProvider` must not crash; log a single `console.warn("[xb] transport not available — overlay running without engine connection")` and provide a no-op transport so children do not throw on `useTransport()` calls.
- `MutationObserver` callback called with a very large mutation list (X SPA navigation heavy re-render): the rAF gate + 150 ms debounce absorbs the burst; only the latest scheduled tick runs (cancel-and-reschedule pattern).
- `requestAnimationFrame` unavailable in the test environment (JSDOM): mock `rAF` to call synchronously in tests to make the reconcile path unit-testable.
- `safeQuery` receiving a CSS selector string that is syntactically invalid (attacker-controlled or corrupted `XSelectors` constant): `DOMException` caught, miss count incremented, `null` returned — overlay continues.
- Observer on `document.body` during document teardown (page unload): wrap the observer disconnect in a `try/catch` in the cleanup effect to prevent unhandled exceptions during fast navigation.
