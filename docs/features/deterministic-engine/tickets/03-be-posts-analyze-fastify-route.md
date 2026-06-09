# [BE] POST /posts/analyze Fastify Route

## Goal

Expose deterministic analysis through a backend route.

## Context

- `/ideas/generate` should remain text-only.
- Existing Fastify routes parse shared schemas and return normalized `ApiError` responses.
- Full route failures may use `code: "deterministic_analysis_failed"` and `scope: "deterministic"`.

## Requirements

- Add `POST /posts/analyze`.
- Parse the request with the shared deterministic analyze request schema.
- Use `DeterministicAnalysisService` for scoring.
- Return shared deterministic analyze response schema.
- Preserve per-item failures as `status: "score_failed"` when possible.
- Use route-level `ApiError` only when the whole endpoint cannot complete.
- Do not call Codex or `/ideas/generate` from this route.
- Do not persist follower count day one.

## Tests

- `app.inject` valid request returns scored results.
- Request without followers returns disabled prediction and Post Coach.
- Request with followers returns available prediction.
- Invalid request returns existing validation error shape.
- Service item failure returns `score_failed` without dropping item text.
- Full service failure returns route-level `ApiError` with deterministic scope.
