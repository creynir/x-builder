# [FND] DeterministicAnalysisService Wrapper

## Goal

Create an engine service wrapper around the deterministic analyzer that produces the shared API view model.

## Context

- Analyzer logic lives in `engine/src/deterministic/post-analyzer.ts`.
- Useful exports include `analyzePost`, `predictEngagement`, and `derivePostCoachCard`.
- Existing analyzer currently has an implicit `1000` follower fallback that must not leak into API output.

## Requirements

- Add a service layer owned by the engine.
- Service accepts item text, optional writer source format, manual context, and Post Coach presentation mode.
- Service calls analyzer logic and returns shared-schema-compatible analysis results.
- Service derives `postCoach` with:
  - preview mode for candidate summaries.
  - expanded mode for detail inspector responses.
- Service sanitizes day-one learning copy.
- No returned Post Coach string may claim imported personal performance data exists.
- `learningCaveat` must be present for ready Post Coach state day one.
- Learning rows must indicate static-rule evidence until imports exist.
- Missing followers must produce disabled/missing prediction, not a fallback prediction.

## Tests

- Valid post without followers returns score, Post Coach, and disabled prediction.
- Valid post with manual followers returns score, Post Coach, and available prediction.
- Service never returns prediction derived from the implicit `1000` fallback when followers are absent.
- Service sanitizes `your data` or imported-metrics copy from Post Coach output.
- Preview and expanded Post Coach modes set the expected view-model flags.
