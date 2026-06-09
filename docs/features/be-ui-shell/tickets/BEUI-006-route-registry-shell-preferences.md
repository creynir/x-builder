# BEUI-006: [FE] Route Registry And Shell Preferences

## Goal

Add the client route registry and shell preference boundary for URL-backed routes.

## In Scope

- Route registry for Writer, Voice, Post Library, and Settings.
- Shared schema validation for route configs.
- `/` resolves to `/writer`.
- Unknown routes resolve to `/writer`.
- Placeholder flags for Voice and Post Library.
- Client-local preferences: sidebar collapsed, density, last route.
- Local storage persistence with in-memory fallback.

## Out Of Scope

- Full AppShell rendering.
- Voice/Post Library feature workflows.
- Backend route registry endpoint.

## Acceptance Criteria

- Given `/` is opened, when route resolution runs, then active route is Writer and URL becomes `/writer`.
- Given an unknown path is opened, then route resolution returns Writer.
- Given Voice and Library routes are loaded, then they are enabled placeholders.
- Given local storage write fails, then the app continues with in-memory preference state.
- Given route configs are invalid, then validation fails in tests.

## Test Strategy

- Suite: client Vitest.
- Fixture strategy: route config fixtures and mocked local storage failure.
- Dependency category: in-process only.

## Dependencies

- BEUI-001.
