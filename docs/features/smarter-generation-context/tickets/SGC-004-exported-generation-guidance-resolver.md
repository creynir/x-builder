---
status: todo
---

# SGC-004: Implement exported createGenerationGuidanceResolver

## Implementation Details

Implement `createGenerationGuidanceResolver` in the engine LLM layer and export it from `engine/src/index.ts`. The resolver composes playbook slicing and voice sample selection, then renders one compact guidance string.

The resolver must never throw to callers, must never render the full knowledge base, and must return `undefined` when both playbook and voice samples are empty.

## Data Models

Consumes `GenerationGuidanceRequest`, `PlaybookSlice`, and `VoiceSamplePost[]`.

Returns:

```ts
type GenerationGuidanceResolver = (request: GenerationGuidanceRequest) => Promise<string | undefined>;
```

Dependencies: `AppSettingsRepository`, `PostLibraryRepository`, and local file read for configured `knowledgeBasePath`.

## Integration Point

Producer: `createGenerationGuidanceResolver`. Consumers: `buildServer` and `createBoundEngineServices` in later tickets. User entry point: clicked generate category. Terminal outcome: compact rendered guidance string consumed by `GenerateIdeasService`.

## Scope Boundaries / Out of Scope

In scope: resolver factory and rendering, fail-open behavior for settings/KB/post-library failures, export from engine package entry point, and founder-story guardrail in rendered guidance when applicable.

Out of scope: no LLM calls, response schema changes, overlay/transport changes, or logging of KB content, post text samples, full prompts, or provider payloads.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests. Owning suite: engine LLM tests. Fixture strategy: fake settings repository, fake post library repository, temp KB content, and captured rendered output. Dependency category: in-process fakes plus temp filesystem. Isolation boundary: no real user settings, no real corpus, no LLM.

## Definition of Done

- Resolver returns compact guidance when playbook or samples exist.
- Resolver returns `undefined` when no usable context exists.
- Resolver never returns unrelated KB sections.
- Engine package exports the resolver.

## Acceptance Criteria

- Given both playbook and samples exist, when resolver runs, then rendered guidance includes the requested format slice plus voice examples.
- Given all dependencies fail, when resolver runs, then it returns `undefined`.
- Given a KB fixture with unrelated sections, when resolver renders guidance, then unrelated section text is absent.
- Given `founder_story`, when resolver renders guidance, then it includes the rule to never invent, suggest, or prompt emotional content.

## Edge Cases

- Whitespace-only KB.
- Whitespace-only post text.
- Oversized playbook section.
- Oversized voice samples.
- Settings read failure.
- Post-library read failure.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
