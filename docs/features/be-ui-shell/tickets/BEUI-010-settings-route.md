# BEUI-010: [FE] Settings Route

## Goal

Implement the shell-owned Settings Route for readiness repair and settings persistence.

## In Scope

- Settings route inside App Shell.
- Load settings from client API.
- Defaults state.
- Engine URL field.
- Storage path field.
- Codex command label field.
- `runCodexJudgeAfterGeneration` switch.
- `showDeterministicDetails` switch.
- Dirty state.
- Validation.
- Save settings.
- Test readiness against saved settings only.
- Explicit Back to Writer or previous route action.
- Unsaved navigation warning.

## Out Of Scope

- Full Codex adapter UI.
- Storage browser/picker.
- Auto-return after repair.

## Acceptance Criteria

- Given settings load returns defaults, then fields render with default values.
- Given the user edits a field, then dirty state appears and Save becomes available when valid.
- Given Engine URL is invalid, then field-level error appears and save does not submit.
- Given save fails, then values remain visible and error recovery appears.
- Given the form is clean and Test readiness succeeds, then the Top Status Bar state updates.
- Given the form is dirty, then Test readiness is disabled and helper copy says `Save settings before testing readiness.`
- Given settings save succeeds, then the route may trigger a status refresh using the saved settings.
- Given Settings opened from Writer recovery, then Back to Writer is explicit and no auto-return occurs.

## Contract Decision

`Test readiness` uses saved settings only. Unsaved draft values are not sent to readiness checks in this epic. Users must save first, then test or rely on the save-triggered status refresh.

## Test Strategy

- Suite: client Vitest with mocked API client.
- Fixture strategy: default settings, persisted settings, dirty form, validation errors, save failure, partial readiness.
- Dependency category: local mocks.

## Dependencies

- BEUI-004.
- BEUI-005.
- BEUI-008.
- BEUI-009.
