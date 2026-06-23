---
status: done
---

# XOB-023: `ProvenanceController` — two-state derived model + green anchor store

## Implementation Details

**Components / symbols:**

- `ProvenanceController` — logic component (renders no DOM of its own); owns the green anchor (L3) and derives `ProvenanceState` (L5); passes `showGreen`, `annotations`, and `provenanceState` down to `CompositionHighlightLayer` and sibling zone components via render props or a context.
- `useProvenanceAnchor()` — hook exposing `{ anchor: string | null; setAnchor(text: string): void; clearAnchor(): void }` backed by a `useRef` (stable reference across renders, not React state — does not trigger a re-render on set; consumers derive state L5 each frame). The anchor value persists across pin re-mounts within a compose session (stored on a stable object that outlives `CompositionHighlightLayer` remounts).
- `useComposerText(composerEl: HTMLElement | null, debounceMs?: number)` — hook; debounced read (default 80 ms) of `composerEl.textContent ?? ""`; L4 (local to the controller).
- `deriveProvenanceState(anchor: string | null, composerText: string): ProvenanceState` — pure function; `anchor !== null && composerText === anchor` → `"generated"` (byte-for-byte equality per §16.5); otherwise `"user_written"`.
- `deriveApproved(verdict: JudgeVerdict | null): boolean` — imported from `@x-builder/shared` (XOB-002); **overlay must not implement its own threshold**. Used to compute `approved` in `"generated"` state.

**`ProvenanceState` (L5 — derived, never stored in React state):**

```ts
type ProvenanceState = "generated" | "user_written";
```

Exactly one value at any time. Never mixed.

**Anchor-setter events (the ONLY two paths that set the anchor):**

1. A `generateIdeas` candidate is applied to the composer (XOB-024/026) → `setAnchor(candidate.text)`.
2. `applyJudgeSuggestions` returns (XOB-027) → `setAnchor(returnedText)`.

These are the only callers of `setAnchor`. Neither `judgeDraft` nor any user edit sets the anchor.

**Loop prevention:** `Apply-all` button (XOB-027) is shown only in `"user_written"` state. Once `applyJudgeSuggestions` returns and the anchor is set, state becomes `"generated"` and Apply-all is hidden — the system never re-improves its own output.

**Props interfaces:**

```ts
interface ProvenanceControllerProps {
  composerEl: HTMLElement | null;
  annotations: JudgeAnnotation[];       // from latest judgeDraft verdict; default [] (shared JudgeAnnotation)
  latestVerdict?: JudgeVerdict | null;  // L1 — passed from parent compose machine; source of `approved` via deriveApproved. null/undefined ⇒ approved=false. Optional so the controller mounts before the first verdict; XOB-029 passes it explicitly.
  onProvenanceChange?(state: ProvenanceState): void; // optional callback for parent state machines
  children: (ctx: ProvenanceRenderContext) => ReactNode; // render prop pattern
}

interface ProvenanceRenderContext {
  provenanceState: ProvenanceState;
  showGreen: boolean;                   // === provenanceState === "generated"
  showBlue: boolean;                    // === provenanceState === "user_written" && annotations.length > 0
  approved: boolean;                    // deriveApproved(latestVerdict); only meaningful in "generated"
  setAnchor(text: string): void;        // called by generate/apply on confirmed text write
}
```

**State levels:**

- `anchor: string | null` — L3 (cross-overlay session-scoped; `useRef` in `ProvenanceController`, stable within a compose session; passed to `setAnchor` callers via context or render prop).
- `composerText: string` — L4 (debounced `composerEl.textContent`, local to controller).
- `provenanceState: ProvenanceState`, `showGreen`, `showBlue`, `approved` — L5 (all derived each render from L3 anchor + L4 composerText + latest verdict; never stored in React state).
- `latestVerdict: JudgeVerdict | null` — L1 (passed in as prop from parent compose machine; controller does not call `judgeDraft` directly).

## Data Models

```ts
// ProvenanceController consumes these shapes from @x-builder/shared (XOB-002):

type ProvenanceState = "generated" | "user_written";

// deriveApproved (from shared — overlay imports, never re-implements):
// deriveApproved(verdict) === (verdict.verdict === "post_now" || verdict.verdict === "slight_rework")
//   i.e. it reads the verdict LABEL, not the raw score. Because deriveJudgeVerdict(overall)
//   maps overall>=85 → "post_now", 70..84 → "slight_rework", <70 → "major_rework"/"do_not_post",
//   the approved boundary still lands at overall 70 (true) / 69 (false) — but ONLY when the
//   verdict label is consistent with scores.overall. Test fixtures MUST set the label via
//   deriveJudgeVerdict(scores.overall) so the boundary tests are meaningful.
// overlay must import and call deriveApproved; it must NOT write any approval threshold of its
// own (no `>= 70`, no `verdict === "post_now"` label-literal comparisons) anywhere in overlay source.

// AnnotationEntry (from judgeVerdictSchema via XOB-010):
interface AnnotationEntry {
  quote: string;
  severity: "warning" | "suggestion";
  recommendation: string;
}
```

## Integration Point

**Parent mount:** `ProvenanceController` is rendered by `ComposeCockpit` (XOB-029) as the orchestrator of the compose surface's provenance logic. At this ticket it is tested in isolation with a fixture `composerEl` and injected `annotations`.

**How the user reaches it:** transparent — `ProvenanceController` is not a visible component. Users see its effects: the green wash when `showGreen === true`, the blue annotation underlays when `showBlue === true`, and the "✓ Judge approved" label / Apply-all button visibility governed by `provenanceState`.

**Terminal outcome:** at any point in the compose flow, exactly one of the two provenance states is active; the state is consistent with the byte-comparison of the anchor and live composer text; `approved` is derived from `deriveApproved` from shared, not a bespoke threshold.

## Scope Boundaries / Out of Scope

**May change:** `overlay/src/provenance/provenance-controller.tsx`, `overlay/src/provenance/use-provenance-anchor.ts`, `overlay/src/provenance/use-composer-text.ts`, `overlay/src/provenance/derive-provenance-state.ts`.

**Anchor-setter callers (XOB-024, XOB-027) are out of scope for this ticket.** The `setAnchor` function is implemented and exported here; it is wired to generator/apply events in later tickets. At this ticket, `setAnchor` is tested directly in unit tests.

**`judgeDraft` call is out of scope.** The controller accepts `annotations` (and optionally `latestVerdict`) as props from the parent compose machine — it does not initiate transport calls.

**ZERO-TRACE (no code, no stubs):** no `ComposeGenerateRail`, no `StaticEngineColumn`, no `JudgeStrip`, no `SuggestAffordance`, no `ComposeCockpit` assembly. No `applyJudgeSuggestions` call site here (wired in XOB-027).

## Test Strategy & Fixture Ownership

**Suite:** Vitest + RTL (shadow-aware). All fixtures owned by `@x-builder/overlay`.

**Tests:**

- `deriveProvenanceState("hello world", "hello world")` → `"generated"` (byte-equal).
- `deriveProvenanceState("hello world", "hello world!")` → `"user_written"` (differ by one char).
- `deriveProvenanceState(null, "anything")` → `"user_written"` (null anchor = no anchor set).
- `deriveProvenanceState("", "")` → `"generated"` (edge: empty equal strings — empty post is generated if anchor was set to empty string). Note: `setAnchor("")` should be guarded against by callers, but controller must not crash.
- `ProvenanceController` mounted with `composerEl` containing `"foo"` and no anchor → `provenanceState === "user_written"`, `showGreen === false`.
- `setAnchor("foo")` called → `composerEl.textContent === "foo"` → `provenanceState === "generated"`, `showGreen === true`, `showBlue === false`.
- Edit simulation: after `setAnchor("foo")`, simulate `composerEl.textContent` changing to `"foo!"` (simulate input event + debounce) → `provenanceState === "user_written"`, `showGreen === false`; flip happens on first differing keystroke (after debounce tick).
- `annotations` non-empty + `provenanceState === "user_written"` → `showBlue === true`.
- `annotations` non-empty + `provenanceState === "generated"` → `showBlue === false` (annotations present but blue hidden).
- `approved` parity: `latestVerdict = { overall: 70, ... }` + `provenanceState === "generated"` → `approved === true` (matches `deriveApproved(verdict)` return).
- `approved` parity: `latestVerdict = { overall: 69, ... }` → `approved === false`.
- `approved` is computed by calling `deriveApproved` from `@x-builder/shared`; confirm the overlay source contains no literal threshold comparison (`>= 70` must not appear in overlay source — enforced by a lint rule or code-review gate, documented here as a requirement).

**Fixture strategy:** `buildComposerFixture(text: string): HTMLDivElement` — XOB-022 kept this inline in its test file (`n(text, widthPx)`); promote a real shared builder into `overlay/src/testing/` (ticket-owned) so both suites use one helper. `makeJudgeVerdict(overrides?)` factory in `overlay/src/testing/`, producing a REAL `JudgeVerdict` (all 13 score dims, headline, strengths, improvements, annotations) — no Zod dup. **The factory MUST set `verdict` (label) from `deriveJudgeVerdict(scores.overall)`** unless explicitly overridden, so `deriveApproved` (which reads the label) agrees with the boundary the AC asserts. The `approved`-parity tests assert `approved === deriveApproved(latestVerdict)` — they must NOT re-derive a threshold.

**Annotation type:** the controller's `annotations` prop is `JudgeAnnotation[]` from `@x-builder/shared` (the ticket's `AnnotationEntry` IS `JudgeAnnotation` — `{ quote, severity: "suggestion"|"warning", recommendation }`). It must pass through to `CompositionHighlightLayer` unchanged (XOB-022's prop is already typed `JudgeAnnotation[]`). Do not declare a new local `AnnotationEntry`.

**Harness:** Vitest **browser mode (Playwright Chromium)** — the established overlay harness (XOB-018/020/021/022) via `vitest-browser-react`. NOT jsdom (the "RTL shadow-aware" phrasing predates that decision). Real `textContent`, real timers (`vi.useFakeTimers()` for the debounce flip).

## Definition of Done

- `deriveProvenanceState` is a pure function with no side effects; byte-for-byte equality (`===`) is the only comparison.
- `useProvenanceAnchor()` uses `useRef` for the anchor value (does not trigger re-renders on set); `setAnchor` and `clearAnchor` are stable function references.
- `ProvenanceController` derives `showGreen`, `showBlue`, `approved` correctly every render; state is never mixed (`showGreen && showBlue` is never true at the same time).
- `approved` is derived exclusively by calling `deriveApproved` from `@x-builder/shared`; no `>= 70` threshold appears in overlay source code.
- Edit-flip: the state transitions to `"user_written"` on the first debounce tick after `composerText !== anchor`.
- All unit tests pass; `pnpm typecheck` green.

## Acceptance Criteria

- **Given** no anchor has been set (`anchor === null`), **When** `ProvenanceController` evaluates, **Then** `provenanceState === "user_written"` regardless of `composerEl.textContent`.
- **Given** `setAnchor("Hello world")` is called and `composerEl.textContent === "Hello world"` (byte-equal), **When** `ProvenanceController` evaluates, **Then** `provenanceState === "generated"`, `showGreen === true`, `showBlue === false`.
- **Given** the anchor is `"Hello world"` and the user edits the composer to `"Hello world!"`, **When** the debounce fires (simulated by advancing time), **Then** `provenanceState` flips to `"user_written"` on the first tick after the text diverges; `showGreen` becomes `false`.
- **Given** `provenanceState === "user_written"` and `annotations` is non-empty, **When** `ProvenanceController` evaluates, **Then** `showBlue === true`.
- **Given** `provenanceState === "generated"` and `annotations` is non-empty, **When** `ProvenanceController` evaluates, **Then** `showBlue === false` (blue annotations hidden in generated state).
- **Given** `latestVerdict.overall === 70` and `provenanceState === "generated"`, **When** `approved` is evaluated, **Then** `approved === true`, and this value matches the return of `deriveApproved(latestVerdict)` from `@x-builder/shared`.
- **Given** `latestVerdict.overall === 69`, **When** `approved` is evaluated, **Then** `approved === false`, matching `deriveApproved`.
- **(Negative)** **Given** the overlay source code, **When** it is inspected, **Then** no literal `>= 70` or `> 69` threshold comparison exists in any overlay file (the threshold is owned exclusively by `@x-builder/shared`'s `deriveApproved`).

## Visual AC

`ProvenanceController` is a logic component — it renders no DOM itself. Its output governs the visibility of `CompositionHighlightLayer`'s states:

**Exactly one state, never mixed:**
- `"generated"`: `GreenWash` visible, all `BlueHighlight` elements hidden, "✓ Judge approved" label shown (by parent), Apply-all button hidden (by parent).
- `"user_written"`: `GreenWash` hidden, `BlueHighlight` elements shown (if annotations present), verdict + Apply-all shown (by parent).

**Flip is immediate on first differing keystroke after debounce (≤ 80 ms default debounce).** There is no blend or transition between states; the green wash blinks off on the first character that diverges.

**`aria-live` announcement:** when `provenanceState` flips to `"user_written"` from `"generated"`, the parent compose machine should announce "Draft edited — judge running" via the existing `aria-live="polite"` verdict region (out of scope for this ticket; documented as a requirement for XOB-026/027).

**Reduced motion:** no animation in `ProvenanceController` itself (defers to `CompositionHighlightLayer`'s wash and `JudgeStrip`'s pulse).

## Edge Cases

- `composerEl` becomes `null` mid-session (modal closes): `useComposerText` returns `""` when `composerEl === null`; if anchor is `""`, this would spuriously read as `"generated"` — guard: when `composerEl === null`, always return `"user_written"` regardless of anchor value (no composer → no active compose session).
- Anchor set to a very long string (full post text, e.g. 280 chars): `===` comparison is O(n) but 280 chars is negligible on every debounce tick.
- `setAnchor` called with whitespace-normalized text while `composerEl.textContent` preserves raw whitespace (e.g. line breaks inserted by X's contenteditable): this would produce a spurious `"user_written"` state. The anchor must be set from the *exact* text as it appears in the compositor output at the moment of application — not from the generate/apply API response alone. The write-to-composer step (XOB-024/027) must capture `composerEl.textContent` *after* the text is written and pass that to `setAnchor`.
- Multiple rapid `setAnchor` calls (generate clicked twice quickly): the last call wins; no queue is maintained.
- `clearAnchor` semantics: called when the compose session ends (modal closes, `ComposeContext` inactive) — `ProvenanceController` unmounts; on next mount, anchor starts `null`. If the anchor ref is held in a parent context that survives unmounts (for session persistence), `clearAnchor` must be called explicitly on compose session end to prevent stale anchors appearing in a fresh compose.

## Pipeline Log

Lane: rgb-tdd lean Red-first (Red self-validates → Green → combined Blue+Yellow). Not `[FND]` — no architectural checkpoint.

| Station | Commit | Result |
|---|---|---|
| pre-Red SHA | `4eab7a4` | base |
| Red (failing tests, self-validated) | `c825883` | 24 tests; scope CLEAN; ticket-ids: 1 benign header-comment match. Flagged `latestVerdict` interface gap (in State Levels + ACs, missing from props block) → reconciled into ticket. |
| pre-Green SHA | `9262054` | base (after interface reconciliation) |
| Green (impl) | `168c2a7` | 4 files; 207/207 overlay tests pass; typecheck green; `gates.py all` CLEAN; no threshold literal (calls shared `deriveApproved` only). |
| Blue (validate Green) | — | **APPROVE_WITH_CONCERNS** — no test modification (`9262054...168c2a7` test-diff empty); two-state exclusivity structural; ref-backed anchor + stable setters; single approval authority. Concern **C1** (`flushSync`). |
| Yellow (intent/wiring) | — | **APPROVE** — 5-segment seam consumable by XOB-022 layer; `JudgeAnnotation[]` pass-through unchanged; zero-trace clean (no out-of-scope symbols, no transport); null-composer guard correct; `onProvenanceChange` a legitimate XOB-026/027 seam. |

Post-Green ticket reconciliations: `latestVerdict` added to `ProvenanceControllerProps` then relaxed to optional (`latestVerdict?: JudgeVerdict | null`) to match Red's `mountController` helper (nullish ⇒ `approved=false`; satisfies approved-parity ACs).

### Concerns Ledger

| # | Concern | Owner | Resolution |
|---|---|---|---|
| C1 | **`flushSync`-per-debounce-tick in `use-composer-text.ts`** is a deviation from the established plain-`setState` trailing-edge debounce (sibling `use-composer-rect.ts`). Production-SAFE and bounded (≤1 forced synchronous render per 80 ms debounce window, never per keystroke; satisfies the Visual AC "flip immediate on the debounce tick"), but partly a **test-accommodation**: the XOB-023 test reads a captured render-prop `ctx` variable synchronously after `flushDebounce()`, and a bare `setTimeout`+`setState` commit lands past that synchronous read. No AC/DoD violated. | XOB-023 follow-up / revisit at **XOB-029** integration | Drop `flushSync`; commit with plain `setText` (matching `use-composer-rect.ts`) and have the test observe post-tick state via the harness's `act`-aware settling or an observable DOM surface rather than the captured `ctx`. Requires touching Red's test → cannot be done unilaterally by Green; defer. Also note for XOB-029: once the controller is mounted in `ComposeCockpit`, a forced synchronous render on the debounce tick will flush any descendant highlight re-map in the same frame — fold into the single per-frame rAF snapshot (XOB-022 L2). |
