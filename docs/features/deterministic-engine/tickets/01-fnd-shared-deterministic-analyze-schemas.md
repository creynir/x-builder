# [FND] Shared Deterministic Analyze Schemas

## Goal

Create the shared Zod contract for deterministic post analysis so backend and client parse the same request and response shapes.

## Context

- Existing shared API schemas live in `shared/src/schemas/shell.ts`.
- Existing client and server both parse shared schemas at the boundary.
- Analyzer domain types currently live in `engine/src/deterministic/post-analyzer.ts`.

## Requirements

- Add request schema for `POST /posts/analyze`.
- Request accepts 1-10 items.
- Each item includes `id`, `text`, and optional writer `sourceFormat`.
- Request includes manual scoring context with optional `followers`.
- Request includes `presentation.postCoachMode` with `preview` and `expanded`, defaulting to `preview`.
- Add successful scored result schema with:
  - `status: "scored"`
  - `id`
  - `text`
  - optional `sourceFormat`
  - `detectedFormat`
  - `score`
  - required `postCoach`
  - `prediction`
  - `heuristicLabel: "Heuristic rank, not prediction."`
  - `analyzedAt`
  - `analyzerVersion`
- Add per-item failure schema with:
  - `status: "score_failed"`
  - `id`
  - `text`
  - optional `sourceFormat`
  - `reason`
  - `message`
  - `retryable`
- Model prediction availability explicitly. Missing followers must not look like a real prediction.
- Include `PostCoachViewModel` schema as an engine-produced view model.
- `PostCoachViewModel` ready state must include `learningCaveat`.
- Day-one `learningCaveat` value is the literal string `Static rule check. Imported performance data is not connected yet.`
- Client schema validation must fail if a scored result omits `postCoach`.

## Tests

- Shared schema accepts valid scored and score-failed fixtures.
- Shared schema rejects a scored result without `postCoach`.
- Shared schema rejects a ready `postCoach` without `learningCaveat`.
- Shared schema accepts a ready `postCoach` with the day-one `learningCaveat` literal.
- Shared schema rejects request batches with zero or more than ten items.
- Shared schema accepts missing followers and represents prediction as disabled/missing.
- Shared schema distinguishes writer `sourceFormat` from analyzer `detectedFormat`.
