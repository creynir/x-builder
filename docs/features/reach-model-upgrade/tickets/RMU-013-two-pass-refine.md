---
status: done
---

# RMU-013: Two-pass judge→refine orchestration

## Implementation Details

Implement the client two-pass flow: instant deterministic render → judge → re-issue analyze
with judge signals → **replace** the prediction. Pre/post-judge reach are different scales;
the model holds exactly one prediction per draft version, so no diff can be rendered.

1. **`runTwoPassRefine(apiClient, model, publish)`** runner (`writer-workflow.ts`):
   1. Require `model.judge.status === "ready"` and a current scored draft whose text equals `model.idea.trim()`. Else no-op.
   2. Capture `refineRequestId = nextRefineRequestId++`; set `refinement: { status:"running", requestId }`.
   3. **Extract ONLY the two scalars** from `model.judge.verdict.scores`: `{ impressions: scores.impressions, replies: scores.replies }`. Do NOT pass the whole `verdict.scores` object.
   4. Re-issue `analyzePosts` with `scoringContext.judgeSignals = { impressions, replies }` (plus the existing `followers`/`advancedContext`).
   5. On resolve, **stale-guard**: apply only if `refineRequestId` is still active AND the scored candidate's `text === model.idea.trim()`. If either fails, drop the result. On success, replace the candidate's prediction in `analysisByCandidateId` (the returned prediction carries server-supplied `qualityBasis: "judge"`) and set `refinement: { status:"refined", requestId }`.
2. **`runJudgeDraft`** — on judge success, publish the verdict FIRST (so `JudgePanel` renders before refine), then fire `runTwoPassRefine`.
3. **Edit reset** — extend `applyIdeaChange`, `applyAdvancedContextChange`, and the follower-draft change reducer to reset `refinement → { status:"skipped" }` so a stale judge never refines a changed draft.
4. **Refining indicator** — while `refinement.status === "running"`, show a `Badge variant="info"` "Refining reach…" inside the existing `aria-live="polite"` evaluation region. Keep the deterministic prediction visible underneath (no skeleton over the card — avoids a CLS flash).
5. Wire into `createWriterPagePublicDriver`.

## Data Models

`RefinementState` (declared in RMU-010). CONSUMES `scoringContext.judgeSignals` (RMU-001)
and the server-supplied `qualityBasis` on the refined prediction (RMU-008). The client passes
the two scalars only and does NO math.

## Integration Point

Studio; fires after "Judge draft" succeeds. Terminal outcome: the prediction is replaced with
a `qualityBasis="judge"` prediction; `EngagementPredictionCard` shows the "Refined with judge
signal" badge (RMU-011).

## Scope Boundaries / Out of Scope

Orchestration + status only. Renders NO diff/delta; never holds both predictions for one
draft version. Sends only the two `judgeSignals` scalars (not the full scores). Does NOT
change the judge rubric (RMU-012) or the regime rendering (RMU-011). Zero-trace: no
before/after comparison field anywhere.

## Test Strategy & Fixture Ownership

Reducer unit + integration. Owning suite: writer-page tests + a new workflow suite. Mock
`WriterApiClient` returns a `static` prediction then a `judge` prediction; assert the pass-2
request body contains `scoringContext.judgeSignals === { impressions, replies }` and no other
`scores` keys. Engine API = remote-owned mock. In-process.

## Definition of Done

Two-pass replaces the prediction; stale-guard drops edited-draft results; "Refining reach…"
shows while running; only one prediction per draft version; `pnpm test` + `pnpm typecheck` +
`pnpm lint` green.

## Acceptance Criteria

- Given a scored draft and a ready verdict with `scores.impressions=65`, `scores.replies=80`, When refine runs, Then the pass-2 `analyzePosts` request carries `scoringContext.judgeSignals === { impressions: 65, replies: 80 }` (only those two scalars; no other `scores` keys).
- Given pass-2 succeeds, Then the draft's prediction is replaced with the returned `qualityBasis === "judge"` prediction; only one prediction exists in the model.
- Given refine is running, When rendered, Then "Refining reach…" appears in the `aria-live` region.
- Given the user edits the draft while refine is in flight, When the refine result resolves, Then it is dropped (stale-guard), `refinement` is not "refined", and no `qualityBasis="judge"` prediction is shown for the new draft text.
- Given pass-2 analyze fails, When it resolves, Then the `static` prediction remains, the judge verdict stays visible, and the analysis error banner shows; no diff is rendered.
- Then no field representing a delta/diff between a static and a judge prediction exists anywhere in the rendered output.

## Visual AC

Refine badge `Badge variant="info"` using `--text-accent`; no skeleton over the prediction
during refine; no number tween; card height stable.

## Edge Cases

Judge ready but draft text changed before refine starts → no-op. Rapid re-judge → latest
`requestId` wins. Refine when the prediction is disabled → no-op (nothing to refine).

## Pipeline Log

- 2026-06-14 — **Done.** Standard pipeline, single clean cycle: Red (`82e03a0`) 18 failing tests — a new workflow suite `writer-two-pass-refine.test.ts` (16: two-scalar extraction + no-leak, prediction replacement + single-prediction, stale-guard drop + latest-requestId-wins, pass-2-failure keeps static + `routeErrorOrigin="analysis"`, three no-op gates, verdict-before-refine orchestration, `applyIdeaChange`/`applyFollowerDraftChange` → `skipped`) + 2 SSR render tests in `writer-page-advanced-context.test.tsx` (AC3 running badge in the `aria-live` region, AC6 zero-trace diff) → Blue Validate Red APPROVE (anti-rubber-stamp confirmed the leak/stale-guard/zero-trace tests have teeth) → Green (`20df9c3`) `runTwoPassRefine` (judge-ready+scored-draft gate, `nextRefineRequestId`, two-scalar extract, `analyzePosts` re-issue with `scoringContext.judgeSignals`, stale-guard, prediction replace with server `qualityBasis:"judge"`, failure → analysis error + static kept), `runJudgeDraft` chains refine after publishing the verdict, `applyIdeaChange`/`applyFollowerDraftChange` reset → `skipped`, "Refining reach…" `Badge variant="info"` in the `aria-live` region, threaded optional `judgeSignals` through `scoringContextFromAdvanced`→`candidateAnalysisRequest`→`requestAnalysis` (pass-1 omits it), driver `judge` entry → Blue (Validate Green) APPROVE + Yellow APPROVE — **no concerns**. Full client suite **237 passed / 0 failed**, typecheck + lint clean, gates clean. Production-reachable: `onJudge`→`judgeDraft`→`runJudgeDraft`→`runTwoPassRefine` (not driver-only). `qualityBasis` is server-derived (client never fabricates). RMU-011/012 untouched; zero diff/delta trace.
- **Concern C5 (orchestrator scope decision → epic-end triage):** RMU-013 item 3 lists `applyAdvancedContextChange` among the reducers resetting `refinement → "skipped"`, but RMU-010 already shipped it as `→ "idle"` with a passing owned test (`writer-advanced-context.test.ts:141`). Resolved by keeping the shipped `idle` contract (the `skipped` reset applies only to `applyIdeaChange` + `applyFollowerDraftChange`); `idle` and `skipped` are behavior-equivalent for item 3's stated goal (neither is `running`/`refined`, so no stale refine fires), and AC4's stale-guard provides the real protection. Architect to reconcile the intended label for `applyAdvancedContextChange` at triage (keep `idle`, or surface a distinct `skipped` semantic if a future "reach not refined — draft changed" affordance is wanted).
