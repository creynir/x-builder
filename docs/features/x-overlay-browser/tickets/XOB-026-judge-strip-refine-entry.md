---
status: done
---

# XOB-026: JudgeStrip — waiting→pulse→fill + generate-refine entry path (UNDER cockpit zone)

## Implementation Details

**Components:**
- `JudgeStrip` — UNDER cockpit zone container (~`--space-5` / ~20px gap below modal).
- `JudgeWaitingIndicator` — "AI judge running" pulsing dot + label (or static waiting state).
- `JudgeVerdictHeader` — verdict band badge + confidence + attribution.
- `JudgeScoreGrid` — 13-dim grid of `ScoreBar` + `MetricExplainer` triggers.
- `JudgeNotesList` — strengths and improvements lists.

**Props (`JudgeStrip`):**
```ts
{
  judge: JudgeState;
  provenance: ProvenanceState;          // from ProvenanceController (XOB-023)
  applyState: ApplyState;               // from XOB-027 (idle in this ticket's scope)
  onRetryJudge: () => void;
  explainer: ExplainerSource;
}
```

Where `JudgeState`:
```ts
type JudgeState =
  | { status: "waiting" }
  | { status: "unavailable"; hint: string }
  | { status: "running" }
  | { status: "judged"; verdict: JudgeVerdict }
  | { status: "failed"; error: string };
```

`ApplyState` (defined fully in XOB-027; referenced here as an opaque prop that `JudgeStrip` passes to its apply-affordance child):
```ts
type ApplyState =
  | "idle"
  | "applying"
  | { status: "applied"; improvedOverOriginal: boolean }
  | { status: "failed"; error: string };
```

**State levels:**
- `judge` = L1 (transport `judgeDraft`, owned by `ComposeCockpit` machine; passed down).
- `provenance` = L5 derived (from `ProvenanceController`, XOB-023; determines whether Apply-all is shown — XOB-027 scope).
- `applyState` = L4 (owned by `ComposeCockpit`; defaults to `"idle"` in this ticket).

**Judge flow states rendered:**
1. `waiting` — static "Waiting for draft…" label; no pulse.
2. `running` — `JudgeWaitingIndicator` with pulse animation (§5.4 spec).
3. `judged` — verdict band fills in; 13-dim `JudgeScoreGrid`; `JudgeNotesList`.
4. `failed` — `Alert` (variant `"danger"`) + retry button; static metrics unaffected.
5. `unavailable` — subtle hint to configure judge in Settings.

**`aria-live` announcement:** the verdict region has `aria-live="polite"`; announces band + overall once when `status` transitions to `"judged"`.

**Generate-refine entry path (§F / §16.2):**

When a `generateIdeas` candidate is chosen (flow owned by `ComposeCockpit`):
- Candidate **has** `verdict` + `approved`: text enters composer as `generated/approved` state (XOB-023 sets green anchor). `JudgeStrip` shows `"✓ Judge approved"` immediately — **no pulse, no wait** — because the verdict already arrived with the candidate. `judge` state is set to `{ status: "judged"; verdict: candidate.verdict }`.
- Candidate **lacks** `verdict` (refine judge failed per §16.2 guard): text enters composer as `user_written`. `JudgeStrip` starts normal judge flow — `waiting` → `running` (pulse) → `judged`.

This branching is handled in `ComposeCockpit`'s state machine; `JudgeStrip` only renders what `judge` + `provenance` tell it.

**Pulse motion spec (§5.4):**
- 8px judge-cyan dot + "AI judge running" label.
- `opacity: 0.45 ↔ 1` + `box-shadow` glow radius `4px ↔ 10px`.
- Duration: `var(--xb-pulse-duration, 1100ms)`, `ease-in-out`, infinite.
- Tokens: `--xb-glow-judge`, `--xb-pulse-duration`.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` → no pulse; static "Running…" label + `aria-busy="true"` on the indicator; keyframe is gated separately (not relying solely on `--duration-*` vars).

**Primitives used:** `ScoreBar` (13 dims), `Badge` (verdict band, confidence), `Skeleton` (dim slots while running), `Alert` (failure), `Button` (retry; ghost/secondary — never primary CTA).

## Data Models

- `JudgeVerdict` — from `judgeVerdictSchema` (§16.4 + existing shape): `{ verdict, confidence, scores, headline, strengths, improvements, annotations: JudgeAnnotation[] }`. `annotations` defaults to `[]`.
- `JudgeAnnotation` — `{ quote: string, severity: "suggestion" | "warning", recommendation: string }` (§16.4).
- `deriveApproved(verdict): boolean` — from `@x-builder/shared`; overlay must not implement its own threshold.

No new local data models.

## Integration Point

- **Parent mount:** `ComposeCockpit` mounts `JudgeStrip` into the UNDER `AnchorLayer` pin (~`--space-5` gap below modal bottom rect) when `ComposeContext` is active.
- **User entry (normal flow):** `StaticEngineColumn` fills (XOB-025) → `ComposeCockpit` auto-kicks `judgeDraft` → passes `judge: { status: "running" }` → pulse shows → `judgeDraft` resolves → `judge: { status: "judged"; verdict }` → grid fills.
- **User entry (refine path):** user clicks a generate category (XOB-024) → `generateIdeas({ format })` returns candidate with `verdict`+`approved` → `ComposeCockpit` pins anchor (XOB-023) + sets `judge: { status: "judged"; verdict: candidate.verdict }` → `JudgeStrip` renders approved state immediately.
- **Terminal outcome:** user reads verdict, 13-dim scores, strengths/improvements → edits draft in X's composer (normal flow) OR proceeds to Apply-all (XOB-027 scope).

## Scope Boundaries / Out of Scope

**In scope:**
- All `JudgeState` rendering (waiting/running/judged/failed/unavailable).
- Pulse animation + reduced-motion gating.
- `aria-live` verdict announcement.
- Generate-refine entry: rendering "✓ Judge approved" when `provenance === "generated"` AND `judge.status === "judged"` AND `deriveApproved(verdict)` (no pulse on pre-approved entry). **NOTE:** `ProvenanceState` (XOB-023) is a **bare string union** `"generated" | "user_written"` — compare `provenance === "generated"`, NOT `provenance.status`. The "✓ Judge approved" badge is gated on provenance+approved; it is distinct from the verdict **band** badge (post_now/slight_rework/major_rework/do_not_post), which renders on every `judged` state. (Both `slight_rework` and `post_now` are `deriveApproved===true`.)
- Retry button on failure (calls `onRetryJudge`).

**Out of scope (zero-trace):**
- Apply-all button + `applyJudgeSuggestions` call (XOB-027).
- Blue annotation rendering (XOB-022/027).
- Green whole-post wash (XOB-023/027).
- Auto-improve logic (XOB-027).
- Edit-while-judging cancellation (owned by `ComposeCockpit` machine).

## Test Strategy & Fixture Ownership

**Framework:** Vitest **browser mode → Playwright Chromium** via `vitest-browser-react` — the established overlay harness (XOB-018/020–025), shadow-DOM-aware. NOT jsdom/RTL.

**Fixtures:** **REUSE the existing `makeJudgeVerdict` factory in `overlay/src/testing/fixtures.ts`** (built in XOB-023 — produces a REAL full 13-dim `JudgeVerdict` and derives the `verdict` label from `scores.overall` via shared's `deriveJudgeVerdict` unless overridden). Do NOT hand-write an abbreviated verdict (the inline example below was abbreviated/missing dims). Build the fixtures as:
```ts
const judgedVerdict = makeJudgeVerdict({ scores: { overall: 74 }, headline: "Good hook, sharpen the close", strengths: ["Clear value prop"], improvements: ["End with a sharper call to action"], annotations: [{ quote: "sharpen the close", severity: "suggestion", recommendation: "Add a concrete CTA" }] }); // → verdict "slight_rework" (deriveApproved === true)
const approvedVerdict = makeJudgeVerdict({ scores: { overall: 85 } }); // → verdict "post_now" (deriveApproved === true)
```
`provenance` fixtures are the bare strings `"generated"` / `"user_written"` (NOT `{ status: … }`).

**Test cases:**
1. **Waiting state** — static label rendered; no pulse dot; no `aria-busy`.
2. **Running state** — pulse dot + "AI judge running" label; `aria-busy="true"` in reduced-motion mode; no verdict visible.
3. **Judged state** — verdict band badge, 13 `ScoreBar` dims filled, strengths/improvements visible.
4. **`aria-live` announce** — transition `running → judged` → `aria-live="polite"` region announces band + overall.
5. **Failed state** — `Alert` variant `"danger"` + retry button; `onRetryJudge` called on click.
6. **Refine entry (pre-approved)** — `judge: { status: "judged", verdict: approvedVerdict }` + `provenance: "generated"` → "✓ Judge approved" shown; no pulse.
7. **Refine fallback (no verdict)** — candidate applied without verdict → `judge: { status: "waiting" }` → normal flow starts.
8. **Reduced motion** — pulse keyframe absent; static label present.
9. **Never primary CTA** — no element in `JudgeStrip` uses `--xb-accent` button style or `variant="primary"`.

**Transport mock:** `FakeEngineTransport` (`judgeDraft` owned by `ComposeCockpit`; `JudgeStrip` is fully presentational).

## Definition of Done

- [ ] All five `JudgeState` cases render correctly.
- [ ] Pulse animation uses `--xb-pulse-duration` + `--xb-glow-judge`; gated keyframe (not relying on `--duration-*`).
- [ ] Reduced-motion: no pulse; `aria-busy`; static label.
- [ ] `aria-live="polite"` announces verdict once on `running → judged`.
- [ ] Generate-refine entry: pre-approved candidate → "✓ Judge approved" without pulse.
- [ ] Refine fallback: missing verdict → normal judge flow starts.
- [ ] No primary-CTA styling on any element in `JudgeStrip`.
- [ ] All 9 test cases pass.
- [ ] Aurora Glass Visual AC satisfied (see below).

## Acceptance Criteria

**Given** `judge.status === "running"`  
**When** `JudgeStrip` renders  
**Then** a pulsing judge-cyan dot + "AI judge running" label is shown; verdict grid is not visible.

**Given** `judge.status === "judged"`  
**When** the verdict arrives  
**Then** the 13-dim `ScoreBar` grid fills, verdict band badge renders, strengths/improvements appear, and `aria-live` announces the result.

**Given** a `generateIdeas` candidate with `verdict` + `approved`  
**When** the candidate is applied to the composer  
**Then** `JudgeStrip` shows "✓ Judge approved" immediately with no pulse (the judge already ran).

**Given** a `generateIdeas` candidate without `verdict`  
**When** the candidate is applied to the composer  
**Then** `JudgeStrip` enters `waiting` → `running` normal flow.

**Given** `judge.status === "failed"`  
**When** `JudgeStrip` renders  
**Then** a danger `Alert` is shown with a retry button; `onRetryJudge` fires on click; static metrics (RIGHT column) are unaffected.

**Given** `prefers-reduced-motion: reduce`  
**When** `JudgeStrip` is in `running` state  
**Then** no pulse animation plays; a static "Running…" label with `aria-busy="true"` is shown instead.

## Visual AC

**Aurora Glass tokens (judge channel):**
- Container: `--xb-surface-panel` glass, `--xb-judge` (`hsl(192 95% 60%)`) edge accent, `--xb-glow-judge` on edges.
- Pulse dot: 8px, `background: var(--xb-judge)`, `box-shadow: var(--xb-glow-judge)`; pulse keyframe token-driven.
- Verdict band badge: `--xb-band-post-now` (green) / `--xb-band-slight` (teal) / `--xb-band-major` (amber) / `--xb-band-donot` (red) per verdict.
- `ScoreBar` fills (judge dims): reuse the v2 `ScoreBar` primitive (built in XOB-025). Its fill is colored by neutral `--score-*` band (semantic: green=strong…red=weak) and the primitive exposes no color-override prop — so do NOT fork it to force a `--xb-judge` tint. **Judge-channel identity is carried at the container level** (the `--xb-judge` edge accent + `--xb-glow-judge` + "✦ AI judge" caption + the pulse), not by per-bar tinting. (No test asserts bar tint.)
- "✓ Judge approved": `--xb-band-post-now` green; `Badge` variant `"success"`.
- `Alert` failure: existing `Alert` `variant="danger"` tokens.
- Retry button: `Button` `variant="ghost"` or `"secondary"` — **never** `variant="primary"`.
- `MetricExplainer` ⓘ triggers: ghost icon, `--xb-glow-sm` on hover.
- Channel caption: "✦ AI judge" in `--xb-text-muted`, `--type-caption`.
- Reduced motion: all animation tokens zero; static indicator.
- High-contrast: glows drop; borders solidify.

**Locked rule:** judge zone uses additive (`--xb-judge*`) styling; **never** the primary-CTA hue (`--xb-accent` as a button fill or `variant="primary"`).

## Edge Cases

- **Edit while judging** (cancel + re-queue): `ComposeCockpit` issues an abort; `JudgeStrip` transitions from `running` back to `running` (new request) without flash-to-waiting; owned by machine, not strip.
- **`judgeDraft` returns 0 annotations:** `annotations: []` default — `JudgeScoreGrid` renders normally; no annotation-related UI shown (blue highlights are XOB-022/027 scope).
- **Verdict with `overall >= 70` (approved) in normal flow:** `JudgeStrip` shows "✓ Judge approved" badge derived via `deriveApproved`; Apply-all still shown in user_written per XOB-027.
- **`unavailable` state:** quiet hint message (no `Alert` danger); `aria-live="polite"` announcement "Judge unavailable — configure in Settings."
- **LLM warming (judge not yet ready on first open):** `unavailable` state shown with hint to wait or check Settings.

**Cross-deps:** XOB-021 (MetricExplainer), XOB-023 (ProvenanceController — determines generated/user_written for entry path), XOB-024 (ComposeGenerateRail — generate click triggers refine entry), XOB-025 (StaticEngineColumn — static fills before judge kicks).

## Pipeline Log

Lane: rgb-tdd lean Red-first (Red self-validates → Green → combined Blue+Yellow). Not `[FND]`.

| Station | Commit | Result |
|---|---|---|
| pre-Red SHA | `28279b8` | base (after reconciliations: `ProvenanceState` bare string `provenance==="generated"`, reuse `makeJudgeVerdict`, ScoreBar judge-identity at container level not bar-tint, browser-mode harness) |
| Red (failing tests, self-validated) | `b2091f9` | ~15 tests (9 cases + edges); scope CLEAN; ticket-ids 1 benign comment match; module-not-found failure. Introduced the `data-judge-pulse="animated"` stable pulse hook + a reference-Button computed-bg comparison for "never primary CTA". |
| pre-Green SHA | `b2091f9` | base |
| Green (impl) | `6372856` | 1 file (`overlay/src/judge/judge-strip.tsx` + internal sub-components); 262/262 overlay tests pass; typecheck green; `gates.py all` 1 ui-tokens lead (keyframe glow-radius literal — accepted, see F1). |
| Blue (validate Green) | — | **APPROVE** — no test modification; exactly 13 ScoreBars; "✓ Judge approved" full conjunction (provenance+judged+`deriveApproved`, no bespoke threshold); named `@keyframes` gated SEPARATELY under `prefers-reduced-motion` (not just the duration var); aria-live announce is a derived string (no effect). ui-tokens keyframe literal = legitimate spec-mandated animation endpoint. |
| Yellow (intent/wiring) | — | **APPROVE** — presentational (no transport/machine); generate-refine entry never re-judges its own approved output; single approval authority; zero-trace (no Apply-all/blue/green/auto-improve; `applyState` accepted-but-unused); additive judge identity, never CTA. |

### Concerns Ledger

| # | Concern | Owner | Resolution |
|---|---|---|---|
| F1 | **Pulse keyframe glow-radius literals** (`box-shadow: 0 0 4px … ↔ var(--xb-glow-judge)`'s 12px) are hardcoded px. This is spec-mandated (§5.4 "glow radius 4px ↔ 10px") — a fixed `--xb-glow-judge` token can't express two animation endpoints; the color channel stays tokenized (`var(--xb-judge)`). No behavior issue; ui-tokens gate is a lead, not a verdict. | optional v2/neon-sheet nicety | Extract `--xb-pulse-glow-min`/`--xb-pulse-glow-max` (or a 4px-radius token) to fully tokenize both endpoints. Cosmetic; non-blocking. (Note: upper endpoint reuses `--xb-glow-judge`'s 12px, slightly above the spec's approximate 10px — token-reuse preferred over a new literal.) |
| F2 | **Combined running label** `"AI judge running · Running…"` reads slightly redundant — Green merged the two label strings the running AC + reduced-motion AC each require into one node. Intentional, contract-correct; no AC violated. | cosmetic | Optional copy polish in XOB-029 assembly. Non-blocking. |
| F3 (cross-ticket) | **XOB-025's "no primary CTA" test asserts the forbidden hue as `rgb(29,155,240)`** (X's brand blue), but the v2 primary `Button` fill resolves to `--accent-9` (≈`rgb(15,142,233)`) — so that assertion would NOT catch a v2 primary button. Harmless today (XOB-025 has no primary button), but a weak assertion. XOB-026's equivalent test uses a live reference-Button computed-bg comparison (robust). | test-hardening (XOB-031 or a cleanup) | Harden XOB-025's CTA-hue assertion to compare against a live `<Button variant="primary">` computed bg (the XOB-026 approach) rather than a hardcoded brand-blue literal. Non-blocking. |
