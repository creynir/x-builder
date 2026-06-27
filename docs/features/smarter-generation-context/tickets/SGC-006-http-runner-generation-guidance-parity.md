---
status: todo
---

# SGC-006: Wire HTTP and runner parity

## Implementation Details

Wire `buildServer` and `createBoundEngineServices` to use the exported `createGenerationGuidanceResolver` when they construct the default `GenerateIdeasService`.

Remove the runner-local whole-KB guidance resolver only after runner bindings consume the engine export. Preserve `options.generateCandidates` as a full override: when a host injects generation, no guidance resolver is wrapped around it.

## Data Models

No new models.

Consumes `GenerationGuidanceResolver`, existing `GenerateIdeaRequest`, and existing settings and post-library repositories.

## Integration Point

Producers: `buildServer` and `createBoundEngineServices`. Consumer: default `GenerateIdeasService` construction. User entry points: overlay runner `generateIdeas({ format })` and HTTP `POST /ideas/generate`. Terminal outcome: both default entry points use the same compact context resolver without changing request or response schemas.

## Scope Boundaries / Out of Scope

In scope: default HTTP and runner service construction, removal of runner-local whole-KB resolver duplication, and tests proving parity.

Out of scope: no transport protocol changes, overlay UI changes, HTTP request/response changes, behavior change for injected `options.generateCandidates`, or remote storage/service calls.

## Test Strategy & Fixture Ownership

Coverage level: server integration and runner transport integration tests. Owning suites: engine server tests and runner transport binding tests. Fixture strategy: temp settings root, temp KB file, in-memory post library, fake LLM prompt capture. Dependency category: local-substitutable filesystem and in-process repositories. Isolation boundary: no real user settings, no real X session, no real LLM.

## Definition of Done

- Default HTTP generation gets compact guidance when settings/corpus exist.
- Runner generation uses the same engine resolver.
- Injected generation override remains untouched.
- Response schema remains unchanged.

## Acceptance Criteria

- Given default `buildServer` with KB and post library, when `/ideas/generate` receives `{ format }`, then default service gets compact guidance.
- Given runner bound services with the same settings and store, when `generateIdeas({ format })` runs, then the same resolver behavior is used.
- Given `options.generateCandidates` is injected, when `/ideas/generate` runs, then the injected function remains the complete generation owner.
- Given no KB and empty corpus, when either entry point runs, then generation still reaches the base LLM prompt.

## Edge Cases

- Bare `buildServer()` with empty repositories.
- Missing workspace root.
- Settings path absent.
- Runner-only environment.
- Injected generation override.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
