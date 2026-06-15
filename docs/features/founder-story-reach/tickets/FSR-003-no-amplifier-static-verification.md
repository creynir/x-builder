---
status: todo
---

# FSR-003: [CHORE] Runtime no-amplifier verification

## Goal

Add static verification that this epic does not introduce runtime amplifier
fields or emotional-growth copy. The goal is to preserve the safety boundary:
the app may classify existing text, but must not prompt users to manufacture
emotional content for reach.

## Changes

- Add or extend a static policy test that scans runtime paths for forbidden
  amplifier fields:
  - `scoringContext.amplifier`
  - `eventContext`
  - `prediction.amplifierType`
  - `founder_story_event`
  - `founder_story_personal_stakes`
  - `founder_story_reuse_decay`
  - judge amplifier dimensions
  - amplifier UI controls
- Add or extend a static policy test that scans relevant runtime UI,
  user-facing docs, and judge prompt strings for forbidden emotional-growth copy:
  - `add hardship`
  - `make it more emotional`
  - `share something vulnerable`
  - `add personal stakes`
  - `reveal more`
  - `use adversity`
  - `use trauma`
- Exclude ticket/spec files and the policy test fixture that defines the banned
  phrase list from the scan target; otherwise the policy will fail on its own
  definition.
- Keep allowlisted user-facing docs wording narrowly scoped to explaining that
  amplifier research is future-only and requires beat identity plus prior-use
  count.
- Ensure new fixtures do not include private named examples from research
  context.

## Verification

- `pnpm test` fails if forbidden runtime amplifier fields are introduced in
  shared schemas, engine estimator/types, judge schemas/prompts, client request
  builders, or prediction UI.
- `pnpm test` fails if forbidden emotional-growth copy appears in client UI,
  user-facing docs touched by this epic, or judge instruction fixtures, except
  in the policy fixture that defines the banned list.
- `pnpm typecheck` passes.
- `pnpm lint` passes.

## Pipeline Log
