# BEUI-013: [INT] Engine And Shared Integration Coverage

## Goal

Verify engine endpoints produce payloads accepted by shared schemas and preserve shell recovery contracts.

## In Scope

- `/status` response parses with `appStatusSchema`.
- `/settings` load/save responses parse with `appSettingsResponseSchema`.
- `/ideas/generate` success parses with `generateIdeaResponseSchema`.
- Engine error responses parse with `apiErrorSchema`.
- `/health` remains liveness-only.

## Out Of Scope

- Browser E2E.
- Visual shell QA.
- Real Codex CLI execution.

## Acceptance Criteria

- Given the engine server is built in tests, when `/status` is injected, then response body parses through shared schema.
- Given settings are patched in an isolated temp root, then subsequent load returns the persisted values.
- Given `/ideas/generate` is called with a valid idea, then exactly three candidates are returned.
- Given invalid requests are sent, then errors parse through `apiErrorSchema`.

## Test Strategy

- Suite: engine Vitest integration tests with Fastify `app.inject`.
- Fixture strategy: temp roots and fake readiness/settings dependencies.
- Dependency category: in-process and local-substitutable filesystem only.

## Dependencies

- BEUI-001.
- BEUI-002.
- BEUI-003.
- BEUI-004.
