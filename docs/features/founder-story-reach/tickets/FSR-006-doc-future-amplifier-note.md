---
status: todo
---

# FSR-006: [DOC] Future amplifier note

## User Flows to Verify

- Given a maintainer reads `docs/features/reach-model-upgrade/README.md` /
  When they reach the founder-story section / Then they understand that
  `founder_story` is runtime now, but event/emotional amplification is
  future-only.
- Given a maintainer reads
  `docs/features/reach-model-upgrade/reach-model-reference.md` / When they read
  the amplifier note / Then it states that amplification requires future
  account/history producers for beat identity and prior-use count.
- Given a user-facing reach guide exists at `docs/how-to/estimate-post-reach.md`
  or the nearest existing reach guide path / When founder-story classification
  is mentioned / Then the docs describe only the visible classification and do
  not instruct users to add emotional content.

## Architectural Invariants

- Documentation does not claim x-builder knows the live X ranking algorithm.
- Documentation does not include private named research examples.
- Documentation describes future amplifier behavior as upper-tail-only, not
  median-lifting.
- Documentation states that the app must not ask users to add emotional content
  for reach.

## Modules Under Test

Documentation pages under `docs/features/reach-model-upgrade/` and the nearest
user-facing reach guide under `docs/`.

## Documentation Targets

- `docs/features/reach-model-upgrade/README.md` — Diataxis: Explanation.
- `docs/features/reach-model-upgrade/reach-model-reference.md` — Diataxis:
  Reference.
- `docs/how-to/estimate-post-reach.md` if that user-facing guide exists by this
  ticket; otherwise document the nearest existing reach guide path and note the
  chosen path in the Pipeline Log — Diataxis: How-To.

## Pipeline Log
