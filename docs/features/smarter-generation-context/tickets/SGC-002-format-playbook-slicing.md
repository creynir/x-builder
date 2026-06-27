---
status: done
---

# SGC-002: Implement format playbook slicing

## Implementation Details

Implement deterministic playbook slicing for the configured knowledge base path supplied by the generation guidance resolver. Parse markdown headings into stable section ids, select only the sections named by `FormatPlaybookMapping`, and render compact markdown within the prompt budget. This helper does not read settings directly; the resolver owns settings access and passes the configured `knowledgeBasePath` in.

Section-id normalization must be explicit and tested against current knowledge-base heading patterns, including numbered headings such as `## 2. Format taxonomy` and underscore headings such as `## 10. founder_story is real but amplifier-gated`. Mapping ids like `format-taxonomy` and `founder-story` must resolve only through this deterministic normalization, not fuzzy matching.

Expose the helper as `resolvePlaybookSlice(input: ResolvePlaybookSliceInput): Promise<PlaybookSlice>`, where `ResolvePlaybookSliceInput` carries `format: DetectedPostFormat` and optional `knowledgeBasePath?: string`. Duplicate normalized section ids are deterministic: the first heading wins and later duplicate headings are ignored for that id.

The selector must never append the full knowledge base. Missing files, unreadable files, empty content, parse misses, or missing mapped sections return an empty `PlaybookSlice` and allow generation to continue without playbook guidance.

## Data Models

Consumes `DetectedPostFormat` and `FormatPlaybookMapping`.

Produces:

```ts
type ResolvePlaybookSliceInput = {
  format: DetectedPostFormat;
  knowledgeBasePath?: string;
};

type PlaybookSlice = {
  format: DetectedPostFormat;
  sourcePath?: string;
  sections: Array<{ id: string; heading: string; content: string; charCount: number }>;
  content: string;
  charCount: number;
  truncated: boolean;
};
```

Budget: playbook content max `6000` chars; section content is trimmed before rendering; over-budget sections are clipped and set `truncated: true`.

## Integration Point

Producer: `resolvePlaybookSlice`. Consumer: `createGenerationGuidanceResolver`. User entry point: clicked generate format category. Terminal outcome: compact playbook guidance for only the requested format.

## Scope Boundaries / Out of Scope

In scope: markdown heading parsing for configured KB text, exact section selection from audited mapping, empty-slice fail-open behavior, and founder-story section support without emotional-content generation prompts.

Out of scope: no markdown document rewrite, semantic/fuzzy matching, LLM-based section selection, whole-KB fallback, or settings writes.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests. Owning suite: engine LLM tests. Fixture strategy: temp markdown KB files with general, target, neighboring, duplicate, empty, and over-budget sections. Dependency category: local-substitutable filesystem fixture. Isolation boundary: temp directory only; no user KB path.

## Definition of Done

- Requested format returns only mapped sections.
- Unreadable or missing KB returns an empty slice without throwing.
- Tests fail if unrelated KB section text appears in rendered guidance.

## Acceptance Criteria

- Given a KB with hot-take and story sections, when request format is `hot_take`, then rendered guidance contains hot-take content and not story content.
- Given an unreadable KB path, when the selector runs, then playbook guidance is empty and no exception escapes.
- Given an over-budget section, when the selector renders it, then content is clipped within the playbook budget and `truncated` is true.
- Given duplicate headings that normalize to the same id, when the selector runs, then the first matching section is used and later duplicates are ignored.
- Given numbered or underscore KB headings, when the selector normalizes headings, then mapping ids resolve deterministically without fuzzy matching.

## Edge Cases

- Empty section body.
- Duplicate headings.
- Nested headings under a mapped section.
- Missing general fallback section.
- Markdown text containing prompt-like instructions.
- Numbered headings whose visible text differs from the section id.
- Underscore headings such as `founder_story` that normalize to hyphenated ids.

## Pipeline Log

- 2026-06-27: Red tests approved after two fix cycles; final suite covers mapped selection, fail-open matrix, budget clipping, duplicate headings, and deterministic normalization.
- 2026-06-27: Green implemented `resolvePlaybookSlice` and `ResolvePlaybookSliceInput` in the engine LLM guidance module.
- 2026-06-27: Blue Green validation APPROVE; Yellow intent validation APPROVE. Targeted playbook slicing tests passed 9/9 and related SGC guidance tests passed 30/30. Engine typecheck still fails on pre-existing shared/engine drift, with no `generation-guidance.ts` diagnostics.
- 2026-06-27: Pre-Red clarification added `resolvePlaybookSlice` input signature and first-heading-wins duplicate policy.
- 2026-06-27: RGB pipeline started; ticket moved to in-progress after SGC-001 completion.
- 2026-06-27: SGC-001 Yellow concern folded in; Red must cover exact KB section-id normalization for numbered and underscore headings.
- 2026-06-27: RGB audit tightened ticket contract before implementation.
