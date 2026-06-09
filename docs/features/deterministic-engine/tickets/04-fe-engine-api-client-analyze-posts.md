# [FE] EngineApiClient.analyzePosts

## Goal

Add a typed client API method for deterministic analysis.

## Context

- Existing `EngineApiClient` parses shared schemas and normalizes bad responses to `invalid_response`.
- UI must consume API view models and must not import analyzer logic.

## Requirements

- Add `analyzePosts` to the engine API client.
- Send `POST /posts/analyze`.
- Parse successful responses with the shared deterministic analyze response schema.
- Preserve per-item `score_failed` results for UI recovery.
- Convert malformed scored responses, including missing `postCoach`, into `invalid_response`.
- Keep generation and analysis as separate client calls.

## Tests

- Client sends the correct request body.
- Client parses scored and score-failed mixed responses.
- Client rejects scored responses missing `postCoach`.
- Client preserves API errors from full route failure.
- Client does not call `/ideas/generate` from `analyzePosts`.
