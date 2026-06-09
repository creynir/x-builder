# BEUI-003: [BE] Status Readiness Endpoint

## Goal

Add `GET /status` for detailed shell readiness while keeping `GET /health` liveness-only.

## In Scope

- `ReadinessService`.
- `GET /status` returning `appStatusSchema`.
- Engine readiness.
- Deterministic scorer readiness.
- Codex readiness as ready, partial, failed, disabled, or unconfigured without running a full judge.
- Storage readiness boundary check.
- Timeout/refresh policy documented in code tests: target under 1s for combined readiness.

## Out Of Scope

- Full Codex judge execution.
- Voice extraction flow.
- Post Library storage tables.

## Acceptance Criteria

- Given the server is running, when `GET /health` is called, then it still returns `{ ok: true }`.
- Given readiness dependencies are ready, when `GET /status` is called, then `overall` is `ready`.
- Given Codex is unavailable but deterministic scorer is ready, then `overall` is `partial`.
- Given storage is not writable, then storage state is failed or unavailable and `overall` is `partial` or `unavailable` according to engine availability.
- Given readiness service throws, then the response is normalized with `apiErrorSchema`.

## Test Strategy

- Suite: engine Vitest with Fastify `app.inject`.
- Fixture strategy: injected fake readiness dependencies for ready, partial, failed, and thrown paths.
- Dependency category: in-process fakes; no real Codex CLI; no developer-local config.

## Dependencies

- BEUI-001.
- BEUI-002.
