# BEUI-004: [BE] Settings Persistence Boundary

## Goal

Add engine-side app settings load/save endpoints behind a narrow repository interface.

## In Scope

- `AppSettingsRepository`.
- JSON/file-backed first implementation behind the repository interface.
- `GET /settings`.
- `PATCH /settings`.
- Defaults when no persisted settings exist.
- Validation through `appSettingsSchema`.
- Safe temp-root support for tests.

## Out Of Scope

- SQLite migration.
- User-authored profile or post data.
- Client Settings UI.

## Acceptance Criteria

- Given no settings file exists, when `GET /settings` is called, then defaults are returned with `source: "defaults"`.
- Given valid settings are patched, when `PATCH /settings` completes, then the response returns persisted settings with `source: "persisted"`.
- Given invalid settings are patched, then the response is `400 validation_failed`.
- Given persistence fails, then the response is `500 settings_persist_failed`.
- Given settings are saved, then subsequent load returns the saved values from the isolated test root.

## Test Strategy

- Suite: engine Vitest with Fastify `app.inject` and repository unit tests.
- Fixture strategy: temp directory per test; fake failing repository for persist failure.
- Dependency category: local-substitutable filesystem; isolated roots only.

## Dependencies

- BEUI-001.
- BEUI-002.
