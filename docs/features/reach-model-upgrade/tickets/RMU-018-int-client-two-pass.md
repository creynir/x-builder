---
status: done
---

# RMU-018: [INT] Client writer two-pass + settings→judge wiring

## User Flows to Verify

- Given a draft + followers / When auto-score → judge → refine complete (through the real `writer-workflow` reducers and a mock `WriterApiClient`) / Then the model committed through `publishModel` shows a `qualityBasis="judge"` prediction and the verdict's 5 new dims.
- Given `accountProfile` saved via the settings public driver / When the writer judges / Then the `audienceMatch` row reflects a number (profile present) — verifying the settings-persist → judge-read seam at the mock-API boundary.
- Given advanced-context fields set / When analyze fires / Then `scoringContext` carries them alongside an unchanged `followers`.

## Architectural Invariants

- The model never simultaneously holds a `static` AND a `judge` prediction for the same draft version (a facade keeping both for a diff fails).
- Editing the draft mid-refine yields `refinement !== "refined"` and drops the stale result (a facade ignoring `requestId` / text-equality fails).
- `followers` continues to flow in `scoringContext` after advanced fields are added (a facade that overwrites `scoringContext` fails).
- The pass-2 request body contains `scoringContext.judgeSignals === { impressions, replies }` and no other `scores` keys (a facade sending the whole `verdict.scores` fails).

## Modules Under Test

`writer-workflow` reducers/runners (`applyAdvancedContextChange`, `runJudgeDraft`,
`runTwoPassRefine`, edit-reset reducers), `WriterPage` public driver, `SettingsRoute` public
driver, mock `WriterApiClient`/`SettingsRouteApiClient` (remote-owned, schema-shaped).
In-process SSR; no real network.

## Pipeline Log

- 2026-06-14 — **Done.** [INT] pipeline (Purple + Blue; no Red/Green). Purple (`66c2064`, scrubbed → `bb662f7`) added `client/src/features/writer/tests/writer-two-pass-integration.test.tsx` (7 tests: 3 user flows + 4 architectural invariants) exercising the REAL `createWriterPagePublicDriver` (incl. its deferred `judge` entry), `createSettingsRoutePublicDriver`, and the real reducers/runners (`runJudgeDraft`→`runTwoPassRefine`, `applyIdeaChange`) with only the `WriterApiClient`/settings API client mocked (schema-shaped). Orchestrator scrub (cycle): the deterministic ticket-ids gate flagged a lone ticket-ID string in a CODE COMMENT (`(RMU-014 zero-trace)`) — rephrased to `(zero-trace)` so the aggregate gate stays clean; no test logic changed. Blue Validate Purple **APPROVE** — verified all 4 invariants are genuinely FALSIFIABLE against a facade (Inv1 explicit absence of `staticPrediction`/`previousPrediction`/`previous` + source-confirmed in-place replace; Inv2 non-vacuous stale-guard with the refine proven in-flight via a `running` assertion before the edit; Inv3 `followers` preserved under the advanced spread; Inv4 `judgeSignals` deep-equals `{impressions,replies}` + per-key absence of the other 11 dims), mock honesty good, flow 2 confirms RMU-014 zero-trace (judge body `{ text }` only — engine fallback NOT re-tested). All 7 pass; client suite **253/253**; typecheck clean; gates clean. **No concerns.**
