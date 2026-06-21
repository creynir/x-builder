---
status: todo
---

# XOB-020: Settings affordance + settings panel

## Implementation Details

**Components / symbols:**

- `SettingsAffordance` — orchestrator component; renders `SettingsLauncherButton` always and `SettingsPanel` when `open === true`; owns the `open` toggle (L4); calls `useTransport()` to drive all L1 data; fetches `getSettings()`, `getOverlayReadiness()`, and `getCaptureSummary()` on mount and on panel open.
- `SettingsLauncherButton` — `IconButton`-derived button (`role="button"`, `aria-haspopup="dialog"`, `aria-expanded`); Aurora Glass neon orb/pill; fixed to top-left corner of the shadow layer via `:host`-relative `position: fixed` using `--xb-z-panel`; renders readiness summary dot in the orb.
- `SettingsPanel` — anchored popover positioned `position: absolute` relative to the launcher (NOT `Drawer` — see scope boundary); `role="dialog"`, `aria-modal="true"`, `aria-label="X Builder settings"`. Contains four sections.
- `ArchiveUploadSection` — file `Input`-derived drop zone + `Button` ("Upload archive"); on select → `validateArchive(file)` (loading state) → if valid → `importArchive(file)` (progress indicator). Rejection surfaces an `Alert` variant `"danger"`.
- `JudgeProviderSection` — `Input` for provider string; reads current value from `AppSettings.judgeProvider`; on blur/submit: read current `AppSettings` from transport, merge `{judgeProvider: newValue}`, call `updateSettings(nextFullSettings)`; rollback on rejection (restore prior full object to L4 echo).
- `ReadinessIndicator` — maps `OverlayReadiness` shape to colored `Badge` dots: `staticEngine.state`, `llm.state` (via `ReadinessState` enum), `capture.state`; when `capture.state === "layout_changed" || capture.state === "paused"` → shows `Alert` variant `"warning"` with text "X layout changed — affordances paused"; also surfaces `selectorMissCount` threshold check as a secondary trigger.
- `ActiveContextToggle` — `Switch`; label "Active context"; `checked` = `AppSettings.activeContext`; on change: read current `AppSettings`, merge `{activeContext: nextValue}`, call `updateSettings(nextFullSettings)`; optimistic L4 echo, rollback on rejection.

**Props interfaces:**

```ts
interface SettingsLauncherButtonProps {
  status: OverlayReadiness | "loading";
  open: boolean;
  onToggle(): void;
}

interface SettingsPanelProps {
  open: boolean;
  onClose(): void;
  settings: AppSettings | "loading" | { error: unknown };
  readiness: OverlayReadiness | "loading" | { error: unknown };
  capture: CaptureSummary | "loading" | { error: unknown };
  onUpdateSettings(next: AppSettings): void;
  onUploadArchive(file: File): void;
}

interface ArchiveUploadSectionProps {
  onUpload(file: File): void;
  uploadState: "idle" | "validating" | "importing" | { status: "done" } | { status: "rejected"; message: string };
}

interface ReadinessIndicatorProps {
  readiness: OverlayReadiness | "loading" | { error: unknown };
  selectorMissCount: number;
  selectorMissThreshold?: number; // default 5
}

interface ActiveContextToggleProps {
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}
```

**State levels:**

- `open` (panel open/close) — L4 (`SettingsAffordance` local state).
- `settings` / `readiness` / `capture` — L1 (`getSettings()`, `getOverlayReadiness()`, `getCaptureSummary()`; loading/error envelopes in `SettingsAffordance`).
- Optimistic echo (`activeContext`, `judgeProvider`) — L4 (pending override until transport resolves/rejects).
- Upload state (`idle | validating | importing | done | rejected`) — L4 (`ArchiveUploadSection` local).

## Data Models

```ts
// From @x-builder/shared (XOB-002):

interface AppSettings {
  judgeProvider: string;
  judgeReady: boolean;
  activeContext: boolean;
  accountProfile?: string;
}

interface OverlayReadiness {
  staticEngine: SubsystemStatus;
  llm: SubsystemStatus;
  capture: {
    state: "ok" | "paused" | "layout_changed";
    label: string;
    message?: string;
    lastCaptureAt?: string;
    checkedAt: string;
  };
}

interface SubsystemStatus {
  state: ReadinessState; // "ready" | "warming" | "degraded" | "unavailable" | "unknown"
  label: string;
  message?: string;
  retryable: boolean;
  checkedAt: string;
  details?: unknown;
}

interface CaptureSummary {
  postsCaptured: number;
  lastCaptureAt?: string;
  followers?: number;
  screenName?: string;
  profileCapturedAt?: string;
}
```

`SettingsPanel` renders `CaptureSummary` via a `KeyValueList` (postsCaptured, lastCaptureAt, optional screenName / followers).

## Integration Point

**Parent mount:** `SettingsAffordance` is rendered at the top level of `OverlayRuntime` (sibling to `AnchorLayer`), not inside the `AnchorLayer` pin tree — it is page-persistent, not node-anchored.

**How the user reaches it:** the `SettingsLauncherButton` is always visible in the top-left of the overlay layer. User clicks (or `Enter`/`Space`) to open `SettingsPanel`. Panel closes on `Esc` or click-outside (detected via `event.composedPath()[0]` to cross the shadow boundary correctly). Focus returns to `SettingsLauncherButton` on close.

**Terminal outcome:** user can upload an archive file, configure judge provider, see engine readiness, and toggle active context — without leaving x.com.

## Scope Boundaries / Out of Scope

**May change:** `overlay/src/settings/settings-affordance.tsx`, `overlay/src/settings/settings-launcher-button.tsx`, `overlay/src/settings/settings-panel.tsx`, `overlay/src/settings/archive-upload-section.tsx`, `overlay/src/settings/judge-provider-section.tsx`, `overlay/src/settings/readiness-indicator.tsx`, `overlay/src/settings/active-context-toggle.tsx`.

**`Drawer` explicitly NOT ported.** `position: fixed` inside a shadow host under a transformed/scrolled X layout produces unreliable viewport-relative positioning. `SettingsPanel` uses `position: absolute` within the overlay's own layer, with collision-flip if the panel overflows the shadow host bounds.

**`ToastRegion` NOT ported.** Upload/settings feedback is surfaced as inline `Alert` components within the panel, not fixed toast overlays.

**ZERO-TRACE (no code, no stubs):** no `MetricExplainer`, no `CompositionHighlightLayer`, no `ProvenanceController`, no `ComposeCockpit`, no `ComposeGenerateRail`, no `StaticEngineColumn`, no `JudgeStrip`, no `SuggestAffordance`. No auto-post, auto-follow, auto-DM, or any autonomous X action.

## Test Strategy & Fixture Ownership

**Suite:** Vitest + RTL (shadow-aware). All fixtures owned by `@x-builder/overlay`.

**Tests:**

- `SettingsLauncherButton`: renders with correct `aria-haspopup="dialog"` and `aria-expanded="false"` when closed.
- `SettingsAffordance` open/close: click launcher → panel appears with `role="dialog"`; press `Esc` → panel closes → focus returns to launcher button.
- Click-outside (composedPath-based): click on a mock element outside the panel's shadow subtree → panel closes.
- `ActiveContextToggle` optimistic echo: toggle → L4 checked flips immediately; transport rejects → checked reverts.
- `updateSettings` read-current-then-send-full pattern: transport `getSettings()` spy returns `{judgeProvider:"openai", activeContext:true, judgeReady:true}`; toggle `activeContext` → `updateSettings` called with full object `{judgeProvider:"openai", activeContext:false, judgeReady:true}`.
- Upload rejection: `FakeEngineTransport.validateArchive` rejects → `Alert` variant `"danger"` renders with rejection message.
- `ReadinessIndicator`: `capture.state === "layout_changed"` → `Alert` warning renders; `selectorMissCount >= 5` → same alert text.
- Loading state: `settings === "loading"` → `Skeleton` renders inside panel sections.
- `CaptureSummary` rendered in `KeyValueList`: fixture with `postsCaptured: 42, lastCaptureAt: "2026-06-21"` → both values appear in the list.

**Fixture builders:** `makeAppSettings(overrides?)`, `makeOverlayReadiness(overrides?)`, `makeCaptureSummary(overrides?)` — lightweight factory functions in `overlay/src/testing/`, mirroring schemas from `@x-builder/shared` (no Zod duplication).

## Definition of Done

- `SettingsLauncherButton` renders at top-left of shadow layer; `SettingsPanel` opens/closes on click and `Esc`; focus returns to launcher on close.
- `ActiveContextToggle` writes `updateSettings(nextFullSettings)` (full object, not partial); optimistic echo; rollback on rejection.
- `JudgeProviderSection` reads current `AppSettings`, merges one field, sends full object; `Input` is the foundation primitive.
- Archive upload: `validateArchive` → `importArchive`; rejection renders `Alert` variant `"danger"`.
- `ReadinessIndicator` maps `OverlayReadiness` `SubsystemStatus.state` to `Badge` variants; `capture.state` paused/layout_changed surfaces warning `Alert`.
- `CaptureSummary` rendered via `KeyValueList` inside panel.
- Soft focus-containment: `Tab` cycles within open panel; `Shift-Tab` can escape back to x.com (no hard trap).
- All unit tests pass; `pnpm typecheck` green.

## Acceptance Criteria

- **Given** the overlay is mounted, **When** the user clicks the top-left launcher button, **Then** `SettingsPanel` opens with `role="dialog"` and focus moves to the first interactive control inside it.
- **Given** `SettingsPanel` is open, **When** the user presses `Esc`, **Then** the panel closes and focus returns to `SettingsLauncherButton`.
- **Given** `SettingsPanel` is open, **When** the user clicks outside the panel (composedPath check), **Then** the panel closes and focus returns to `SettingsLauncherButton`.
- **Given** `AppSettings.activeContext === false`, **When** the user toggles `ActiveContextToggle`, **Then** the switch reflects `true` immediately (optimistic), and `updateSettings` is called with the full `AppSettings` object with `activeContext: true`; if transport rejects, the switch reverts to `false`.
- **Given** `getOverlayReadiness()` returns `capture.state === "layout_changed"`, **When** the panel is open, **Then** an `Alert` with variant `"warning"` and message "X layout changed — affordances paused" is visible inside `ReadinessIndicator`.
- **Given** the user selects an invalid archive file, **When** `validateArchive` rejects, **Then** an `Alert` with variant `"danger"` renders inside `ArchiveUploadSection` with the rejection message, and no `importArchive` call is made.
- **Given** `settings === "loading"`, **When** the panel is open, **Then** `Skeleton` placeholders render in place of settings values (no crash, no blank panel).

## Visual AC

**Aurora Glass tokens required:**
- `SettingsLauncherButton`: `background: var(--xb-surface-panel)`, `backdrop-filter: blur(var(--xb-glass-blur))`, `border: 1px solid var(--xb-border-edge)`, `box-shadow: var(--xb-glow-md)`; accent teal icon (`color: var(--xb-accent)`).
- `SettingsPanel`: `background: var(--xb-surface-panel)`, `backdrop-filter: blur(var(--xb-glass-blur))`, `border: 1px solid var(--xb-border-edge)`, `box-shadow: var(--xb-glow-md)`, `border-radius: var(--radius-lg)`; text `var(--xb-text)` ≥ 4.5:1 on panel surface across all three X themes.
- Readiness `Badge` dots: `staticEngine.state === "ready"` → `variant="success"`; `"warming"` → `variant="warning"`; `"degraded" | "unavailable"` → `variant="danger"`; `llm` same mapping; `capture.state === "ok"` → `variant="success"`.

**Required states:**
- **Ideal:** launcher orb glowing, panel open with all sections populated, all readiness dots green.
- **Loading:** `Skeleton` in each section while L1 fetches resolve.
- **Degraded:** `Alert` warning for layout-changed capture; `Alert` danger for LLM unavailable (non-blocking — user can still upload).
- **Error:** `Alert` danger inline in the affected section (settings load error, upload rejection); other sections remain functional.

**`data-xtheme="default"` (X white):** panel background → `hsl(200 30% 12% / 0.94)` + `--xb-text` → `hsl(200 30% 12%)`; teal accent edge stays (passes on white).

**Reduced motion:** no animation in this component; the launcher orb has `box-shadow: var(--xb-glow-md)` (static) — no pulse here (pulse is XOB-026's judge strip).

## Edge Cases

- `getSettings()` returns stale data between optimistic echo and transport confirmation: the optimistic value wins until transport responds; on success the transport value is authoritative (overrides echo).
- `updateSettings` called while a previous `updateSettings` is in-flight (rapid toggle): cancel/ignore the earlier in-flight or queue only the latest — prevent race condition where an older response overwrites a newer setting. Implement a generation counter or last-write-wins pattern.
- Panel scroll on small viewports: `SettingsPanel` has `max-height: 80vh; overflow-y: auto` (internal scroll); never pushes X UI or causes horizontal page scroll.
- `validateArchive` + `importArchive` file too large (engine enforces limit): transport rejects with an error message — surface in `Alert` danger; input is re-enabled for retry.
- Collision-flip: if `SettingsPanel` overflows the right or bottom edge of the viewport, flip to open rightward / upward respectively. Minimum implementation: check `getBoundingClientRect()` of the launcher + panel dimensions post-render; apply `data-flip-x` / `data-flip-y` CSS attribute overrides.
- `event.composedPath()` unavailable (should not occur in Chromium): fall back to `document.activeElement` check; if outside the panel, close.
