---
status: done
---

# XOB-027: JudgeStrip auto-improve (`applyJudgeSuggestions`) + approved state + green/blue provenance render

> **CONTRACT RECONCILIATION (2026-06-22):** `ProvenanceState` (XOB-023) is a **bare string union** `"generated" | "user_written"` — NOT an object. Everywhere this ticket writes `provenance.status === "user_written"` / `provenance.status === "generated"`, read it as `provenance === "user_written"` / `provenance === "generated"`. Provenance fixtures are the bare strings (reuse the `USER_WRITTEN`/`GENERATED` constants already in `overlay/src/judge/__tests__/judge-strip.test.tsx`).
>
> **This ticket EXTENDS the existing `overlay/src/judge/judge-strip.tsx`** (built in XOB-026) — Green MODIFIES that file (adds `onApplyAll` prop + Apply-all/banner rendering + the `ApplyState`-machine render); Red EXTENDS the existing `judge-strip.test.tsx` (adds the 9 apply/provenance cases + adds `onApplyAll: vi.fn()` to the existing `props()` helper defaults so the prior XOB-026 tests still typecheck). Harness: Vitest **browser mode → Playwright Chromium** (NOT jsdom/RTL).

## Implementation Details

**Extends `JudgeStrip`** (XOB-026) with:
- `ApplyAllButton` — "✦ Apply all suggestions" (judge-cyan; never X CTA).
- `ApprovedBanner` — "✓ Judge approved" state banner.
- `AlreadySolidBanner` — info banner for `improvedOverOriginal: false`.
- Full `ApplyState` machine + provenance-gated rendering.

**`ApplyState` type (complete definition):**
```ts
type ApplyState =
  | "idle"
  | "applying"
  | { status: "applied"; improvedOverOriginal: boolean }
  | { status: "failed"; error: string };
```

**Updated `JudgeStrip` props (additions to XOB-026):**
```ts
{
  // ... all XOB-026 props ...
  applyState: ApplyState;
  onApplyAll: () => void;   // triggers applyJudgeSuggestions({text}) in ComposeCockpit
}
```

**Apply-all gate:** shown **only** when `provenance.status === "user_written"`. When `provenance.status === "generated"`: button is hidden, never just disabled. This is the loop-prevention guard — the system never re-improves its own output.

**Apply flow (explicit user gesture → `ComposeCockpit` handles the async):**

1. User clicks "✦ Apply all suggestions" (`applyState === "idle"`, `provenance === "user_written"`).
2. `onApplyAll()` fires → `ComposeCockpit` calls `applyJudgeSuggestions({ text: composerText })` → `applyState` transitions to `"applying"`.
3. `JudgeStrip` shows pulse ("Improving…" + judge-cyan dot) while `applying`.
4. On return from `applyJudgeSuggestions`:
   - `ComposeCockpit` writes `response.text` into X's composer (explicit gesture).
   - `ComposeCockpit` re-pins `response.text` as the green anchor (ProvenanceController, XOB-023).
   - `provenance` flips to `"generated"`.
   - `applyState` → `{ status: "applied", improvedOverOriginal: response.improvedOverOriginal }`.

5. **`improvedOverOriginal: true`** → `applyState.applied` + green provenance: full green wash visible (XOB-023 scope), "✓ Judge approved" shown, Apply-all hidden.
6. **`improvedOverOriginal: false`** (guard kept original) → `AlreadySolidBanner`: `Alert` variant `"warning"` with title "Already solid — no safe improvement found" (info/neutral tone, **not** `"danger"`). The original text is still re-pinned green (same flow: `response.text === original`, anchor re-pinned). Post Coach hints may still appear under this banner.
7. **Apply failure** (`applyState.failed`) → `Alert` variant `"danger"` with title showing `error` + retry button; composer text is **untouched**; state remains `user_written / judged`.

**Edit-while-applying cancellation (carried P2):**
A mid-apply edit (composer text changes while `applyState === "applying"`) cancels the in-flight apply chain, identical to judge cancellation: `ComposeCockpit` detects `composerText !== priorText` during apply → aborts the `applyJudgeSuggestions` call → `applyState` resets to `"idle"`; any partial result is discarded; composer retains the user's edit. This behavior is owned by `ComposeCockpit`'s state machine; `JudgeStrip` renders `"idle"` when reset.

**Provenance render gates (this ticket):**
This ticket implements the full provenance render split previously only referenced in XOB-023/026:

| `provenance.status` | Green wash | "✓ Judge approved" | Blue annotations | Apply-all |
|---|---|---|---|---|
| `generated` | ✓ visible | ✓ visible | hidden | hidden |
| `user_written` | hidden | hidden | ✓ visible (XOB-022) | ✓ visible (if judged) |

Green whole-post wash = `CompositionHighlightLayer` GREEN state (XOB-022 renders it; provenance gate drives it).  
Blue annotations = `CompositionHighlightLayer` BLUE state (XOB-022 renders it; provenance gate drives it).  
`JudgeStrip` shows/hides Apply-all and approved banner based on `provenance`.

**Primitives used:** `Button` (judge-cyan; ghost with `--xb-judge` border), `Alert` (`"warning"` for already-solid, `"danger"` for failure), `Badge` (approved), `Skeleton`+pulse during applying.

**State levels:**
- `applyState` = L4 (owned by `ComposeCockpit`, passed to `JudgeStrip`).
- `provenance` = L5 derived (ProvenanceController, passed to `JudgeStrip`).

## Data Models

- `ApplyJudgeSuggestionsResponse` — from `applyJudgeSuggestionsResponseSchema` (§16.3): `{ text, verdict, approved, improvedOverOriginal }`.
- `ApplyState` — local discriminated union (defined above); owned by `ComposeCockpit` reducer.
- `ProvenanceState` — the bare string union `"generated" | "user_written"` from `ProvenanceController` (XOB-023). (NOT `{ status: … }`.)

No new shared schemas introduced; all shapes from `@x-builder/shared`.

## Integration Point

- **Parent mount:** `ComposeCockpit` passes `applyState` + `onApplyAll` to `JudgeStrip`.
- **User entry:** user reads judge verdict in `user_written` state → clicks "✦ Apply all suggestions" → `onApplyAll()` → `ComposeCockpit` calls `applyJudgeSuggestions({ text })`.
- **Terminal outcome (improved):** improved text written to composer → green anchor pinned → `provenance: "generated"` → green wash + "✓ Judge approved" shown; Apply-all hidden.
- **Terminal outcome (not improved):** original re-pinned → info "Already solid" banner → Post Coach hints may still show.
- **Terminal outcome (failure):** composer untouched → danger `Alert` + retry; state reverts.

## Scope Boundaries / Out of Scope

**In scope:**
- `ApplyAllButton` shown/hidden per `provenance.status`.
- `ApplyState` machine transitions (idle → applying → applied|failed) rendered in `JudgeStrip`.
- `AlreadySolidBanner` (info, not danger) when `improvedOverOriginal: false`.
- Green provenance render gate: "✓ Judge approved" visible in `generated` state.
- Edit-while-applying cancellation rendering (resetting to `idle`; abort owned by `ComposeCockpit`).
- Post Coach hints visible even under approved state.
- Apply failure: danger `Alert` + retry; composer untouched.

**Out of scope (zero-trace):**
- `applyJudgeSuggestions` transport call itself (owned by `ComposeCockpit`).
- Writing improved text into composer (owned by `ComposeCockpit` — explicit gesture).
- Re-pinning the green anchor (XOB-023 `ProvenanceController`).
- Green wash / blue annotation rendering (XOB-022 `CompositionHighlightLayer`).
- `judgeDraft` call or judge flow (XOB-026).

## Test Strategy & Fixture Ownership

**Framework:** Vitest **browser mode → Playwright Chromium** via `vitest-browser-react` — the established overlay harness (XOB-018/020–026), shadow-DOM-aware. NOT jsdom/RTL.

**Fixtures (owned by overlay package; declare inline in the test or extend `overlay/src/testing/`):**
```ts
const applyingState: ApplyState = "applying";
const appliedImproved: ApplyState = { status: "applied", improvedOverOriginal: true };
const appliedNotImproved: ApplyState = { status: "applied", improvedOverOriginal: false };
const applyFailed: ApplyState = { status: "failed", error: "generation_failed" };

// provenance fixtures are BARE STRINGS — reuse the existing USER_WRITTEN / GENERATED
// consts in judge-strip.test.tsx:
const userWrittenProvenance: ProvenanceState = "user_written";
const generatedProvenance: ProvenanceState = "generated";
```
Also add `onApplyAll: vi.fn()` to the existing `props()` helper defaults so prior XOB-026 tests keep typechecking once `onApplyAll` becomes a required prop.

**Test cases:**
1. **Apply-all hidden in `generated`** — `provenance: generated` → no "✦ Apply all suggestions" button in DOM.
2. **Apply-all visible in `user_written` + `judged`** — `provenance: user_written`, `judge: judged` → button present and enabled.
3. **`applying` state** — pulse + "Improving…" label shown; button replaced by loading indicator.
4. **`applied` + `improvedOverOriginal: true`** — `applyState.applied.improvedOverOriginal === true` + `provenance: generated` → "✓ Judge approved" visible; Apply-all hidden.
5. **`applied` + `improvedOverOriginal: false`** — `AlreadySolidBanner` with `Alert variant="warning"` shown; **not** `"danger"`; title "Already solid — no safe improvement found"; Apply-all hidden (state is `generated`).
6. **`failed`** — `Alert variant="danger"` shown; retry button calls `onApplyAll`; no other state changes.
7. **Edit-while-applying reset** — `applyState` back to `"idle"` → button reappears; no partial state shown.
8. **Post Coach hints under approval** — when `provenance: generated` and `analyzeState.ready`, Post Coach items may still render in `StaticEngineColumn` (no suppression in `JudgeStrip`).
9. **Loop prevention** — `provenance: generated` → Apply-all absent; no path from `JudgeStrip` triggers a second apply.

**Transport mock:** `FakeEngineTransport`.

## Definition of Done

- [ ] "✦ Apply all suggestions" hidden (not just disabled) when `provenance.status === "generated"`.
- [ ] Apply-all shown and enabled when `provenance.status === "user_written"` + `judge.status === "judged"`.
- [ ] `applying` state shows pulse with "Improving…".
- [ ] `improvedOverOriginal: true` path: approved banner shown; Apply-all hidden.
- [ ] `improvedOverOriginal: false` path: `AlreadySolidBanner` with info (warning) `Alert`; NOT danger.
- [ ] Failure path: danger `Alert` + retry; composer text untouched; state reverts.
- [ ] Edit-while-applying: `applyState` resets to `"idle"` on mid-apply text change.
- [ ] All 9 test cases pass.
- [ ] Aurora Glass Visual AC satisfied (see below).

## Acceptance Criteria

**Given** `provenance.status === "user_written"` and `judge.status === "judged"`  
**When** `JudgeStrip` renders  
**Then** "✦ Apply all suggestions" button is visible and clickable.

**Given** `provenance.status === "generated"`  
**When** `JudgeStrip` renders  
**Then** "✦ Apply all suggestions" is absent from the DOM (not hidden with CSS).

**Given** the user clicks "✦ Apply all suggestions"  
**When** `applyJudgeSuggestions` is in flight  
**Then** the button shows a pulse/loading state and "Improving…"; the composer is unchanged.

**Given** `applyJudgeSuggestions` returns `improvedOverOriginal: true`  
**When** the response is processed  
**Then** improved text is in the composer (written by `ComposeCockpit`), `provenance` is `"generated"`, "✓ Judge approved" is shown, Apply-all is hidden.

**Given** `applyJudgeSuggestions` returns `improvedOverOriginal: false`  
**When** the response is processed  
**Then** the original text is re-pinned green, `provenance` is `"generated"`, and the `AlreadySolidBanner` (`Alert variant="warning"`) reads "Already solid — no safe improvement found" — **not** a danger/error state.

**Given** `applyJudgeSuggestions` call fails  
**When** the error is received  
**Then** a danger `Alert` with a retry action is shown; the composer text is unchanged; `applyState` is `"failed"`.

**Given** the user edits the composer while `applyState === "applying"`  
**When** the text change is detected  
**Then** the in-flight apply is cancelled, `applyState` resets to `"idle"`, and the Apply-all button reappears.

## Visual AC

**Aurora Glass tokens (judge channel):**
- Apply-all button: `Button` with `--xb-judge` border (`hsl(192 95% 60% / 0.55)`), judge-cyan text; ghost variant; **never** `variant="primary"` or `--xb-accent` fill. Label: "✦ Apply all suggestions".
- Applying pulse: same judge-cyan dot + `--xb-pulse-duration` + `--xb-glow-judge`; "Improving…" label; `aria-busy="true"`; gated keyframe (reduced-motion: static label, no pulse).
- "✓ Judge approved": `Badge` variant `"success"`, `--xb-band-post-now` green.
- `AlreadySolidBanner`: `Alert` variant `"warning"` (amber); title "Already solid — no safe improvement found"; `--xb-band-major` amber tokens; **not** red/danger.
- Failure `Alert`: `variant="danger"`, `--xb-band-donot` red; retry as `Button variant="ghost"`.
- Post Coach hints: may appear below the approved banner in the RIGHT column; not suppressed.
- Green/blue provenance: rendered by `CompositionHighlightLayer` (XOB-022) per the gate table above; `JudgeStrip` does not duplicate these visuals.
- Reduced motion: applying pulse → static "Improving…" + `aria-busy`; all keyframes gated.

## Edge Cases

- **User clicks Apply-all while judge is still running (not yet `judged`):** button should not be present in this state (requires `judge.status === "judged"` to show); guarded by render condition.
- **Apply returns in < 500ms** (stub/test env): transition still passes through `applying` state for at least one render cycle so UI doesn't flash.
- **Applying → edit → cancel → re-judge:** after cancel, `ComposeCockpit` should re-run `judgeDraft` since the user has now edited; `JudgeStrip` transitions back to `running`.
- **`improvedOverOriginal: false` + original is below approved threshold:** `applyState.applied.improvedOverOriginal === false`; text is re-pinned green but `derived approved` may be `false` depending on original verdict. The info banner appears; "✓ Judge approved" only shown if `deriveApproved(verdict) === true`.
- **Multiple rapid clicks on Apply-all before `ComposeCockpit` responds:** the button transitions to `applying` state on first click and is removed from DOM; subsequent clicks impossible.

**Cross-deps:** XOB-022 (CompositionHighlightLayer — green/blue rendering), XOB-023 (ProvenanceController — anchor re-pin + provenance gate), XOB-026 (JudgeStrip base — extends this ticket's component).

## Pipeline Log

Lane: rgb-tdd lean Red-first (Red self-validates → Green → combined Blue+Yellow). Not `[FND]`. Extends the XOB-026 `JudgeStrip`.

| Station | Commit | Result |
|---|---|---|
| pre-Red SHA | `d138688` | base (after reconciliations: `ProvenanceState` bare string `provenance==='x'`, extends `judge-strip.tsx`+test, `ApplyJudgeSuggestionsResponse {text,verdict,approved,improvedOverOriginal}` confirmed, browser-mode harness) |
| Red (failing tests, self-validated) | `6b5316d` | +9 cases + 2 edges in `judge-strip.test.tsx`; added `onApplyAll: vi.fn()` to the `props()` helper (keeps 15 XOB-026 tests typechecking); 6 fail for the right reason (no apply UI / missing prop). scope CLEAN; ticket-ids: describe-label renamed to behavioral (amend) → only 2 benign comment matches remain. |
| pre-Green SHA | `6b5316d` | base |
| Green (impl) | `9f4a509` | +140/-0 in `overlay/src/judge/judge-strip.tsx` (additive: `onApplyAll` prop + `ApplySection` machine + 4 sub-components); 273/273 overlay tests pass; typecheck green; `gates.py all` CLEAN. |
| Blue (validate Green) | — | **APPROVE** — no test modification (`6b5316d...9f4a509` test-diff empty/byte-identical); Apply-all ABSENT (returns null) not CSS-hidden in generated; AlreadySolid=`warning`; apply-retry→`onApplyAll` (not `onRetryJudge`); no bespoke threshold (`deriveApproved` reused); +140/-0 additive, XOB-026 byte-stable. |
| Yellow (intent/wiring) | — | **APPROVE** — loop-prevention enforced structurally (render gate; test 9 clicks every button, `onApplyAll` never fires in generated); presentational (no transport/composer-write/anchor-repin/abort — all grep hits are out-of-scope comments); AlreadySolid framed as info not error; single approval authority; provenance gate owned on Apply-all/approved side only (green/blue wash left to XOB-022). |

### Concerns Ledger

| # | Concern | Owner | Resolution |
|---|---|---|---|
| G1 (= D1 recurrence) | **v2 `Button` has no `style`/`className`/border prop**, so the Apply-all's `--xb-judge` border (Visual AC) is applied by wrapping the `variant="ghost"` Button in a judge-cyan-bordered span. Clean token-driven workaround — the button stays ghost/transparent so "never primary CTA" holds; touches no Button internals, no suppression. This is the **third** judge/zone affordance hitting the D1 limitation (after XOB-024 full-width, XOB-026 implicit). | v2 `Button` enhancement (rule-of-three TRIGGERED) | The rule-of-three is now met — add a `borderColor`/token or `block` prop to v2 `Button` so judge-channel bordered-ghost buttons and full-width pills don't need wrapper spans. Best done as a small standalone v2 primitive change (or fold into XOB-029 polish). Non-blocking; current wrappers are correct. |
