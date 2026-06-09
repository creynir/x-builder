# BEUI-001: [FND] Shared Shell Schemas

## Goal

Add shared Zod contracts for shell readiness, API errors, app settings, and route configuration.

## In Scope

- `appStatusSchema`
- `apiErrorSchema`
- `appSettingsSchema`
- `appSettingsResponseSchema`
- `routeConfigSchema`
- Export all new schemas and inferred TypeScript types from `@x-builder/shared`.

## Out Of Scope

- Engine endpoints.
- Client UI.
- Settings persistence implementation.

## Acceptance Criteria

- Given shared shell schemas are imported from `@x-builder/shared`, when TypeScript compiles, then app, engine, and client packages can use the inferred types.
- Given a valid app status payload, when parsed by `appStatusSchema`, then it succeeds.
- Given a status subsystem has an invalid state, when parsed, then it fails.
- Given a settings payload has a non-localhost engine URL, when parsed, then it fails.
- Given an API error has an unknown code, when parsed, then it fails.
- Given a route config uses an unsupported path, when parsed, then it fails.

## Test Strategy

- Suite: shared Vitest tests.
- Fixture strategy: inline small valid/invalid objects; no external files.
- Dependency category: in-process only.

## Dependencies

None.
