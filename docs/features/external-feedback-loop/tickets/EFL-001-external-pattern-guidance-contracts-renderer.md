---
status: in-progress
---

# EFL-001: [FND] Define external pattern guidance contracts and renderer

## Implementation Details

Add engine-private external pattern guidance contracts and a deterministic renderer for generation prompts.

Define:

- `ExternalPatternGuidanceRequest`
- `ExternalPatternGuidanceItem`
- `ExternalPatternGuidanceProvider`
- `renderExternalPatternGuidance`

The renderer returns an optional section headed `# External performance patterns (derived constraints, not voice)`. It must describe external patterns as weak writing constraints only, not as the author's voice. The section defaults to at most four rendered items and must stay within a 1,200 character budget.

## Data Models

```ts
type ExternalPatternGuidanceRequest = GenerationGuidanceRequest & {
  maxPatterns?: number;
  minConfidence?: number;
  minSupportCount?: number;
};

type ExternalPatternGuidanceItem = {
  id: string;
  patternType: ExternalXSignalPattern["patternType"];
  format?: DetectedPostFormat;
  statement: string;
  confidence: number;
  supportCount: number;
  generatedAt: string;
  version: string;
};

type ExternalPatternGuidanceProvider = (
  request: ExternalPatternGuidanceRequest,
) => Promise<ExternalPatternGuidanceItem[]>;
```

`ExternalPatternGuidanceItem` is sanitized. It must not include `sourceIds`, `evidenceIds`, evidence previews, handles, platform post ids, metrics, or raw external text.

## Integration Point

Producer: engine LLM guidance module.

Known consumers: `createGenerationGuidanceResolver` in later tickets.

User entry point: later tickets expose the behavior through the existing Generate rail and `GenerateIdeasService`.

Terminal outcome: downstream generation can render a bounded external constraints section without any raw evidence crossing into the writer prompt.

## Scope Boundaries / Out of Scope

In scope: engine-private types, renderer, sanitizer behavior, and unit tests.

Out of scope: no SQLite reads, no repository changes, no generation resolver wiring, no `generateIdeaRequestSchema` change, no transport method, no overlay UI, no judge/apply integration.

Zero-trace: do not add placeholder Fastify routes, shared package schemas, runner bindings, settings controls, or unused future pattern-type handlers.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests. Owning suite: engine LLM guidance tests. Fixture strategy: small test-owned pattern guidance item builders, including intentionally populated forbidden fields at the source fixture layer to prove they are dropped before rendering. Dependency category: in-process only. Isolation boundary: no SQLite, filesystem, browser, network, or developer-local state.

## Definition of Done

- Guidance contracts compile and are exported only where engine code needs them.
- Rendering is deterministic and bounded.
- Empty input returns no external section.
- Forbidden evidence/source/metric fields cannot appear in rendered output.
- The section text states that external patterns are derived constraints, not voice.

## Acceptance Criteria

- Given a pattern source with evidence, evidence ids, source ids, handles, metrics, and preview text / When guidance items are rendered / Then only sanitized statement metadata appears.
- Given more than four eligible guidance items / When the renderer runs with default options / Then only four items are rendered in deterministic order.
- Given zero guidance items / When the renderer runs / Then it returns no external section.
- Given a long statement / When the renderer runs / Then the section stays within the configured character budget.
- Given a pattern without a format / When rendered / Then the item still renders without inventing a format.

## Edge Cases

- Long statements are clipped without splitting the section structure.
- Future pattern types render only if they are already represented by sanitized guidance items.
- Confidence and support values render as metadata, not as raw metrics.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
- 2026-06-29: RGB pipeline started.
