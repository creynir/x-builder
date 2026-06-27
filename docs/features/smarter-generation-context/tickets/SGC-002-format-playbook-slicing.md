---
status: todo
---

# SGC-002: Implement format playbook slicing

## Implementation Details

Implement deterministic playbook slicing for the configured knowledge base path supplied by the generation guidance resolver. Parse markdown headings into section ids, select only the sections named by `FormatPlaybookMapping`, and render compact markdown within the prompt budget. This helper does not read settings directly; the resolver owns settings access and passes the configured `knowledgeBasePath` in.

The selector must never append the full knowledge base. Missing files, unreadable files, empty content, parse misses, or missing mapped sections return an empty `PlaybookSlice` and allow generation to continue without playbook guidance.

## Data Models

Consumes `DetectedPostFormat` and `FormatPlaybookMapping`.

Produces:

```ts
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
- Given duplicate headings, when the selector runs, then deterministic section ids decide which content is included.

## Edge Cases

- Empty section body.
- Duplicate headings.
- Nested headings under a mapped section.
- Missing general fallback section.
- Markdown text containing prompt-like instructions.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
