---
status: todo
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
- Generate-refine entry: rendering "✓ Judge approved" when `provenance.status === "generated"` and `judge.status === "judged"` (no pulse on pre-approved entry).
- Retry button on failure (calls `onRetryJudge`).

**Out of scope (zero-trace):**
- Apply-all button + `applyJudgeSuggestions` call (XOB-027).
- Blue annotation rendering (XOB-022/027).
- Green whole-post wash (XOB-023/027).
- Auto-improve logic (XOB-027).
- Edit-while-judging cancellation (owned by `ComposeCockpit` machine).

## Test Strategy & Fixture Ownership

**Framework:** Vitest + RTL, shadow-DOM-aware.

**Fixtures (owned by overlay package):**
```ts
// fixtures/judge-verdict.ts — reuse/mirror shared/src/schemas/judge.ts shape
export const judgedVerdict: JudgeVerdict = {
  verdict: "slight_rework", confidence: "medium", headline: "Good hook, sharpen the close",
  scores: { overall: 74, voiceMatch: 81, negativeRisk: 22, strangerAnswerability: 68, /* ... 13 total */ },
  strengths: ["Clear value prop"], improvements: ["End with a sharper call to action"],
  annotations: [{ quote: "sharpen the close", severity: "suggestion", recommendation: "Add a concrete CTA" }],
};
export const approvedVerdict: JudgeVerdict = { ...judgedVerdict, verdict: "post_now", scores: { ...judgedVerdict.scores, overall: 85 } };
```

**Test cases:**
1. **Waiting state** — static label rendered; no pulse dot; no `aria-busy`.
2. **Running state** — pulse dot + "AI judge running" label; `aria-busy="true"` in reduced-motion mode; no verdict visible.
3. **Judged state** — verdict band badge, 13 `ScoreBar` dims filled, strengths/improvements visible.
4. **`aria-live` announce** — transition `running → judged` → `aria-live="polite"` region announces band + overall.
5. **Failed state** — `Alert` variant `"danger"` + retry button; `onRetryJudge` called on click.
6. **Refine entry (pre-approved)** — `judge: { status: "judged", verdict: approvedVerdict }` + `provenance: { status: "generated" }` → "✓ Judge approved" shown; no pulse.
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
- `ScoreBar` fills (judge dims): `--xb-judge` tinted (distinct from static `--xb-accent`).
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
