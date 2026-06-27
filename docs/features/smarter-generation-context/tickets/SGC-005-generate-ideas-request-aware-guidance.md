---
status: todo
---

# SGC-005: Wire GenerateIdeasService to request-aware guidance

## Implementation Details

Change `GenerateIdeasService` so its optional generation guidance resolver accepts a `GenerationGuidanceRequest`. In the existing format path, pass `format`, `idea`, `voiceProfileId`, and `useKnownPostIds ?? []` into the resolver. Keep idea-only behavior unchanged: no LLM generation, no judge, and no guidance resolver call.

Preserve the existing structured LLM request, generated candidate response shape, and all-settled judge behavior.

## Data Models

Consumes:

```ts
type GenerationGuidanceRequest = {
  format: DetectedPostFormat;
  idea?: string;
  voiceProfileId?: string;
  useKnownPostIds: string[];
};
```

No shared schema or response model changes.

## Integration Point

Producer/test surface: public `GenerateIdeasService.generate` format path. Consumer: `GenerationGuidanceResolver`. User entry point: clicked generate category in the compose rail. Terminal outcome: same three generated candidates, with optional judge verdicts attached only when judge succeeds. `generateFromFormat` remains a private implementation detail.

## Scope Boundaries / Out of Scope

In scope: request-aware resolver invocation on the format path, existing fail-open guidance handling, and existing generate/judge regression behavior.

Out of scope: no overlay changes, transport changes, generated response schema changes, judge rubric changes, or idea-only behavior changes.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests. Owning suite: existing `GenerateIdeasService` tests. Fixture strategy: resolver spy, fake structured LLM, fake judge, existing generated candidate fixtures. Dependency category: in-process fakes. Isolation boundary: no real LLM, no filesystem, no real settings.

## Definition of Done

- Format generation calls resolver exactly once with the request fields.
- Idea-only generation does not call resolver.
- Resolver failure does not surface as user-visible generation failure.
- Existing generate/judge response tests still pass.

## Acceptance Criteria

- Given `generate({ format, voiceProfileId, useKnownPostIds })`, when the format path runs, then resolver is called once with those fields and `useKnownPostIds` defaults to `[]` when omitted.
- Given `generate({ idea })`, when the idea-only path runs, then resolver is not called.
- Given resolver throws, when format generation runs, then generation continues with the base prompt.
- Given one candidate judge fails, when response returns, then candidate count remains three and only successful judge verdicts are attached.

## Edge Cases

- Both `idea` and `format` present.
- Resolver returns blank string.
- Resolver throws.
- LLM generate failure still maps to existing `generation_failed` behavior.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
