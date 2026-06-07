# [FE] Deterministic Detail Inspector

## Goal

Add the detail inspector for a selected candidate's deterministic analysis.

## Context

- Screen spec: `docs/features/deterministic-engine/spec/deterministic-detail-inspector.md`.
- Mockup: `docs/features/deterministic-engine/spec/mockups/deterministic-detail-inspector.html`.
- Inspector consumes the engine-produced `postCoach` view model.

## Requirements

- User can open details for a scored candidate.
- Inspector shows candidate text, score, Post Coach, prediction, source slot, detected format, and analysis metadata.
- Inspector renders full `postCoach` detail view from API data.
- Inspector can request or retry expanded Post Coach mode.
- Focus and close behavior should follow existing accessible UI patterns.
- Failed or missing analysis states show recovery actions without hiding candidate text.

## Tests

- Opening details renders selected candidate analysis.
- Detail Post Coach uses `analysis.postCoach` directly.
- Missing followers state shows add-followers recovery.
- Retry in inspector calls analysis only.
- Closing inspector returns the user to the candidate board.
