---
status: done
---

# RVA-008: [INT] Reply Assistant End-To-End Contract

## User Flows to Verify

- Given: a valid X reply composer with observed parent context / When: the user generates reply variants and chooses one / Then: three to four unscored variants render, the selected body writes to the native composer, the composer remains editable, and no X Reply/Post button is clicked.
- Given: the chosen generated reply is later present in canonical post storage / When: voice/profile evidence readers run / Then: the exact generated hash is excluded from voice/RAG evidence.
- Given: a normal post composer / When: the overlay mounts / Then: the existing post cockpit path remains available and does not call reply-specific transport methods.

## Architectural Invariants

- Reply generation and post generation are separate transport/service paths.
- Reply assistant mode does not call `generateIdeas`, `judgeDraft`, `applyJudgeSuggestions`, or `recordFeedbackPrediction`.
- Reply variant responses are unscored and contain no judge/reach/Post Coach/apply fields.
- Generated reply exact-hash exclusion is applied at every named voice/profile evidence seam.
- Native X composer remains the only place where the user edits/posts the reply.

## Modules Under Test

- Shared reply schemas and `EngineTransport`.
- Runner expose-function transport and bound service bundle.
- Engine reply variant route/service.
- Engine generated reply ledger and evidence exclusion hooks.
- Overlay `ComposeCockpit` reply assistant branch and native composer write path.

## Integration Point

User entry point: active X reply composer with valid reply context.

Existing module consumer: runner-bound engine transport mediates overlay-to-engine calls.

Terminal outcome: reply assistant completes generate -> choose -> write -> record without legacy reply generation or voice-evidence contamination.

## Scope Boundaries / Out of Scope

In scope: integration coverage across shared, engine, runner, and overlay for the reply assistant contract.

Out of scope: live X posting, real LLM providers, external network, full browser E2E against x.com, generated reply promotion, fuzzy exclusion.

Zero trace: no test may click or simulate clicking X's Reply/Post submission as a success path.

## Test Strategy & Fixture Ownership

Coverage level: integration tests in the runtime packages. Use fake structured LLM, in-memory SQLite, runner binding map, fake X reply composer fixture, and fake or in-process transport as appropriate.

Fixture ownership: shared schema fixtures, engine route fixtures, runner binding fixtures, and overlay compose fixtures remain owned by their package test suites.

Isolation boundary: no live X, no real CLI model providers, no home-directory storage. Tests use explicit temp/in-memory state.

## Definition of Done

- Focused package tests pass for shared, engine, runner, and overlay.
- Required CI-equivalent commands pass for runtime packages.
- The PR body includes `Closes #4`.

## Acceptance Criteria

- Given: a reply assistant flow through the runner/engine binding / When: variants are generated / Then: the LLM-guarded method is `generateReplyVariants`, and `recordGeneratedReply` is not LLM-guarded.
- Given: a reply assistant UI test / When: the reply branch renders / Then: no category rail, reach estimate, Post Coach, judge strip, or apply-all control exists.
- Given: a selected variant / When: it is written / Then: generated reply recording receives normalized generated body/written text.
- Given: generated content is later imported as a post/reply / When: archive voice profile, voice index, SQLite voice samples, and generation-guidance fallback run / Then: generated hashes are absent from evidence.
- Given: normal post mode / When: existing generate flow runs / Then: reply-specific methods are not required and existing post behavior remains intact.

## Visual AC

Integration should preserve the screen spec in `spec/reply-assistant/reply-assistant-pin.md`, including accessible status regions, wrapping variant text, and no forbidden legacy reply UI surfaces.

## Edge Cases

- Reply context incomplete error round-trips through route and transport.
- Ledger duplicate record is idempotent.
- Existing voice embeddings for rows later identified as generated are removed.

## Pipeline Log

- 2026-07-01: Completed targeted integration matrix, overlay compose suite, and package typechecks; ready for PR CI.
