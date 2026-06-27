---
status: done
---

# SGC-001: [FND] Define request-aware generation guidance contract and audited format mapping

## Implementation Details

Introduce engine-internal types for request-aware generation guidance: `GenerationGuidanceRequest`, `GenerationContext`, `PlaybookSlice`, `VoiceSamplePost`, `FormatPlaybookMapping`, and `GenerationGuidanceResolver`.

Add an exhaustive `FormatPlaybookMapping` for every current `DetectedPostFormat`. Each entry must explicitly name the knowledge-base section ids to include, its priority, and whether a general fallback section is allowed. Do not use fuzzy matching, LLM classification, or implicit fallback to the whole knowledge base.

## Data Models

```ts
type GenerationGuidanceRequest = {
  format: DetectedPostFormat;
  idea?: string;
  voiceProfileId?: string;
  useKnownPostIds: string[];
};

type FormatPlaybookMapping = Readonly<Record<DetectedPostFormat, {
  sectionIds: string[];
  priority: "primary" | "secondary";
  includeFallbackGeneral: boolean;
}>>;

type PlaybookSlice = {
  format: DetectedPostFormat;
  sourcePath?: string;
  sections: Array<{ id: string; heading: string; content: string; charCount: number }>;
  content: string;
  charCount: number;
  truncated: boolean;
};

type VoiceSamplePost = {
  id: string;
  platformPostId: string;
  text: string;
  createdAt: string;
  kind: "original";
  source: "known_post_id" | "profile_sample" | "recent_original";
};

type GenerationContext = {
  request: GenerationGuidanceRequest;
  playbook: PlaybookSlice;
  voiceSamples: VoiceSamplePost[];
  renderedGuidance?: string;
};

type GenerationGuidanceResolver = (request: GenerationGuidanceRequest) => Promise<string | undefined>;
```

Constraints: `GenerationGuidanceRequest` is constructed only on the format-generation path; `useKnownPostIds` defaults to `[]`; missing mappings fail tests; runtime mapping misses or missing sections return empty context later, never a full-KB fallback.

## Integration Point

Producer: the engine LLM generation context module.

Known consumers: `createGenerationGuidanceResolver` and `GenerateIdeasService`.

User entry point: clicking a generate format category in the compose rail.

Terminal outcome: later tickets can build compact guidance without changing the existing generate request or response shape.

## Scope Boundaries / Out of Scope

In scope: engine-internal guidance types, exhaustive audited format mapping, founder-story anti-fabrication mapping metadata, and static/unit coverage proving mapping completeness.

Out of scope: no shared schema changes, no overlay/runner transport/API changes, no markdown parser implementation, no LLM-based section selection, and no whole-KB fallback.

## Test Strategy & Fixture Ownership

Coverage level: engine unit/static tests. Owning suite: engine LLM tests. Fixture strategy: use the actual detected format enum plus the mapping object. Dependency category: in-process only. Isolation boundary: no filesystem, no post library, no LLM.

## Definition of Done

- Every `DetectedPostFormat` value has an explicit mapping entry.
- Founder-story mapping carries the anti-fabrication policy.
- Tests fail when the enum changes without mapping updates.

## Acceptance Criteria

- Given the detected format enum, when mapping coverage is tested, then every enum value has an explicit mapping.
- Given an unknown runtime section in the knowledge base, when slicing is implemented later, then mapping absence is not hidden by fuzzy matching.
- Given `founder_story`, when mapping metadata is inspected, then it includes the no-emotional-generation guardrail.

## Edge Cases

- `other` maps only to general guidance if no specific section exists.
- KB-only labels are reachable only through the audited mapping.
- New detected format enum values fail tests until mapped.

## Pipeline Log

- 2026-06-27: Red tests approved after one fix cycle; Green implemented engine guidance contract and audited mapping.
- 2026-06-27: Blue Green validation APPROVE; Yellow intent validation APPROVE. Targeted `generation-guidance-contract` test passed 21/21. Related engine LLM suite and engine typecheck still fail on pre-existing shared/engine drift, with no `generation-guidance` diagnostics.
- 2026-06-27: Foundation architecture checkpoint APPROVE.
- 2026-06-27: Concern recorded for SGC-002: verify exact KB section-id normalization before consuming `formatPlaybookMapping`; this leaves SGC-001 AC/DoD untouched because SGC-001 only defines the audited contract and its tests pass.
- 2026-06-27: RGB pipeline started; ticket moved to in-progress.
- 2026-06-27: RGB audit tightened ticket contract before implementation.
