# BEUI-002: [FND] Engine API Error Normalization

## Goal

Normalize engine API failures into `apiErrorSchema` so client recovery behavior can be consistent.

## In Scope

- Fastify error handler/classifier.
- Zod request parse errors to `400 validation_failed`.
- Unknown route to `404 not_found`.
- Unhandled handler errors to `500 internal_error`.
- Ensure `/ideas/generate` returns normalized validation and generation errors.

## Out Of Scope

- Client fetch classification.
- New status/settings endpoints.
- Logging infrastructure beyond safe server logging.

## Acceptance Criteria

- Given `/ideas/generate` receives invalid input, when requested, then the response is `400` with `code: "validation_failed"` and no stack trace.
- Given an unknown route is requested, then the response is `404` with `code: "not_found"`.
- Given a handler throws unexpectedly, then the response is `500` with `code: "internal_error"` and no stack trace.
- Given a validation error maps to fields, then `fieldErrors` contains field-specific messages when available.

## Test Strategy

- Suite: engine Vitest with Fastify `app.inject`.
- Fixture strategy: inline invalid request payloads and a test-only failing route or injected failing dependency.
- Dependency category: in-process only.

## Dependencies

- BEUI-001.
