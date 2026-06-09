# BEUI-005: [FE] Client API Contract Boundary

## Goal

Add a typed client API boundary that parses every engine response with shared schemas and classifies client-side failures.

## In Scope

- `EngineApiClient`.
- `getStatus`.
- `getSettings`.
- `saveSettings`.
- `generateIdea`.
- Success methods resolve with typed data only.
- Failures throw `ApiClientError` with a classified `apiError` payload.
- Timeout classification.
- Network failure classification.
- HTTP error body parsing through `apiErrorSchema`.
- Invalid JSON and invalid response schema classification as `invalid_response`.

## Out Of Scope

- UI rendering.
- Retry UI.
- Server endpoint implementation.

## Acceptance Criteria

- Given `GET /status` returns valid status, then the client returns typed `AppStatus`.
- Given fetch rejects, then the client throws `ApiClientError` with `apiError.code: "engine_unreachable"`.
- Given request times out, then the client throws `ApiClientError` with `apiError.code: "request_timeout"`.
- Given a response body does not match its schema, then the client throws `ApiClientError` with `apiError.code: "invalid_response"`.
- Given an HTTP error includes `apiErrorSchema`, then the thrown `ApiClientError` preserves `code`, `scope`, `retryable`, and `fieldErrors`.
- Given a component or hook catches `ApiClientError`, then it can read the normalized payload from `error.apiError`.

## Contract Decision

Use throwing failures, not result unions. `EngineApiClient` success methods resolve with typed response data. Any failure throws an `ApiClientError`.

```ts
class ApiClientError extends Error {
  apiError: ApiError;
  cause?: unknown;
}
```

## Test Strategy

- Suite: client Vitest.
- Fixture strategy: mocked `fetch`, small inline response bodies.
- Dependency category: local mocks; no live engine.

## Dependencies

- BEUI-001.
- BEUI-002 for server error shape.
- BEUI-003 and BEUI-004 for endpoint producers.
