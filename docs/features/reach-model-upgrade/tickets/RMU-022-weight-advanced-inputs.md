---
status: todo
---

# RMU-022: Weight the advanced-context inputs (plannedHourUtc, willAttachMedia, accountAgeYears) in the reach model

> Follow-up from the RMU epic-close triage (Concern **C9b**, raised by Amber). Genuine future work; needs calibration data. Tracked here for backlog.

## Problem

Three advanced-context inputs are collected by `AdvancedContextPanel`, validated, and sent on the wire in `scoringContext` (`plannedHourUtc`, `willAttachMedia`, `accountAgeYears`), but the engine has **no consumer** for them — `computeReachModel` only reads `followers`, `trailingMedianImpressions`, `hasExternalLink`, `repeatHistory`, and `judgeSignals`. So setting a planned hour / attach-media / account-age does **not** move the estimate today. This was a deliberate "optional-until-producer" deferral (the shared schema comment + RMU-007/010 scope notes), and RMU-020's how-to was trimmed (C9a) to say these are "recorded but do not change today's estimate."

## Scope

- Add engine producers in `computeReachModel` (and the reach-model weights) that weight these three inputs into the estimate:
  - `plannedHourUtc` — a posting-hour multiplier (time-of-day reach curve).
  - `willAttachMedia` — a media multiplier.
  - `accountAgeYears` — an account-maturity factor (if calibration supports it).
- Constants are `// CALIBRATE` placeholders refit by the `@x-builder/calibration` workspace (RMU-016) once a labeled corpus exists.
- After the producers land, update `docs/how-to/estimate-post-reach.md` to move these three back into the "changes the estimate today" group.

## Notes

- Depends on calibration data (the corpus is absent — RMU-016). Until then the multipliers are placeholders.
- No client change needed (the inputs already flow in `scoringContext`); this is engine + a doc update.

## Acceptance Criteria

- `computeReachModel` reads `plannedHourUtc`/`willAttachMedia`/`accountAgeYears` from `scoringContext` and applies bounded multipliers; setting them shifts the prediction.
- `estimate-post-reach.md` updated to reflect that all five advanced inputs affect the estimate.
- `pnpm test` + `pnpm typecheck` green.
