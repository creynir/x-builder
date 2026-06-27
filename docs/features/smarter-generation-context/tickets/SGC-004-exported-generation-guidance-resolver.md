---
status: in-progress
---

# SGC-004: Implement exported createGenerationGuidanceResolver

## Implementation Details

Implement `createGenerationGuidanceResolver` in the engine LLM layer and export it from `engine/src/index.ts`. The resolver composes playbook slicing and voice sample selection, then renders one compact guidance string.

The resolver must never throw to callers, must never render the full knowledge base, and must return `undefined` when both playbook and voice samples are empty. Settings lookup only controls the playbook path; settings read failures must not block voice sample selection. Post-library failures must not block playbook rendering.

Expose `CreateGenerationGuidanceResolverInput = { settingsRepository: Pick<AppSettingsRepository, "load">; postLibraryRepository: Pick<PostLibraryRepository, "loadStore"> }` and `createGenerationGuidanceResolver(input): GenerationGuidanceResolver`. The resolver reads `settings.knowledgeBasePath`, trims it, passes non-empty values to `resolvePlaybookSlice`, passes `useKnownPostIds` and `voiceProfileId` through to `selectVoiceSamples`, and renders at most two sections:

- `# Requested format playbook` followed by the selected playbook slice content.
- `# Voice samples (match tone, do not copy)` followed by `renderVoiceSampleGuidance(samples).content`.

If the request format is `founder_story` and any guidance section renders, append the exact guardrail line: `Founder-story guardrail: never invent, suggest, or prompt emotional content; only preserve stakes the user supplied.`

## Data Models

Consumes `GenerationGuidanceRequest`, `PlaybookSlice`, `VoiceSamplePost[]`, `AppSettingsRepository`, and `PostLibraryRepository`.

Factory input:

```ts
type CreateGenerationGuidanceResolverInput = {
  settingsRepository: Pick<AppSettingsRepository, "load">;
  postLibraryRepository: Pick<PostLibraryRepository, "loadStore">;
};
```

Returns:

```ts
type GenerationGuidanceResolver = (request: GenerationGuidanceRequest) => Promise<string | undefined>;
```

Dependencies: `AppSettingsRepository`, `PostLibraryRepository`, and local file read inside `resolvePlaybookSlice` for configured `knowledgeBasePath`.

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

- Given both playbook and samples exist, when resolver runs, then rendered guidance includes `# Requested format playbook`, only the requested format slice, `# Voice samples (match tone, do not copy)`, and rendered voice examples.
- Given settings load fails but usable voice samples exist, when resolver runs, then it still returns voice guidance.
- Given post-library read fails but a usable playbook slice exists, when resolver runs, then it still returns playbook guidance.
- Given all dependencies fail or yield empty context, when resolver runs, then it returns `undefined`.
- Given a KB fixture with unrelated sections, when resolver renders guidance, then unrelated section text is absent.
- Given `founder_story`, when resolver renders any guidance, then it includes the exact guardrail line to never invent, suggest, or prompt emotional content.
- Given `useKnownPostIds` and `voiceProfileId`, when resolver selects voice samples, then it passes them to `selectVoiceSamples` through its input.

## Edge Cases

- Whitespace-only KB.
- Whitespace-only post text.
- Oversized playbook section.
- Oversized voice samples.
- Settings read failure.
- Post-library read failure.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
- 2026-06-27: RGB pipeline started; ticket moved to in-progress. Pre-Red contract clarified factory input, render headings, failure isolation, exact founder-story guardrail, and request pass-through.
