---
status: in-progress
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
