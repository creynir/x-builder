# AOS-003 Docs And Validation

## Goal

Close the feature docs and validate the skill artifacts.

## Acceptance Criteria

- Feature README lists implemented skill paths.
- Architecture report records repo-grounded operating facts and drift notes.
- Both skill folders pass `quick_validate.py`.
- Doctor script passes `node --check` and runs successfully with warnings allowed for absent local runtime state.

## RGB/TDD

- Red: generated skill placeholders and missing validation evidence.
- Green: replace placeholders, fix metadata, and run validators.
- Blue: document the known storage-doc drift so future agents do not revive stale JSON assumptions.
