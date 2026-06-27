---
status: in-progress
---

# Smarter Generation Context

## Architecture Context

This epic trims the context sent to the LLM during format-based generation. The current runner guidance path sends the full configured reach knowledge base plus a loose voice sample. The target behavior is request-aware context assembly:

- use the existing `GenerateIdeaRequest.format` as the selector;
- send only the mapped playbook slice for that format;
- include a tight voice sample from local original posts;
- keep overlay transport, runner transport, and `GenerateIdeaResponse` unchanged;
- preserve the existing judge/refine behavior and idea-only behavior;
- fail open when the knowledge base or corpus cannot be read.

The reusable resolver belongs in the engine LLM layer and is exported from `engine/src/index.ts`. Both `buildServer` and `createBoundEngineServices` consume the same resolver for their default `GenerateIdeasService` construction. Hosts that inject `options.generateCandidates` keep full override ownership.

The founder-story guardrail is part of the context contract: generation may preserve genuine stakes the user already supplied, but it must never invent, suggest, or prompt for emotional content.

## API Endpoints

- `POST /ideas/generate` - unchanged request and response schemas. The default service construction uses compact request-aware guidance; injected generation overrides bypass this resolver.

## Component Breakdown

- `GenerateIdeasService` - builds a `GenerationGuidanceRequest` on the existing format path and appends compact guidance when available.
- `createGenerationGuidanceResolver` - engine-owned resolver that reads settings, resolves a playbook slice, selects voice samples, and renders the guidance block.
- `resolvePlaybookSlice` - module-local helper that extracts only audited mapped sections from the configured knowledge base.
- `selectVoiceSamples` - module-local helper that chooses local original posts, honoring known post ids first and then newest originals.
- `FormatPlaybookMapping` - exhaustive audited mapping from `DetectedPostFormat` values to knowledge-base section ids.

## Dependencies

- Existing `GenerateIdeaRequest` and `GenerateIdeaResponse` schemas.
- Existing `AppSettingsRepository` for `knowledgeBasePath`.
- Existing `PostLibraryRepository` / `PostLibraryStore` for original post samples.
- Existing structured LLM provider and judge flow.

## Sub-Tickets Overview

1. `SGC-001: [FND] Define request-aware generation guidance contract and audited format mapping`
2. `SGC-002: Implement format playbook slicing`
3. `SGC-003: Implement voice sample selection`
4. `SGC-004: Implement exported createGenerationGuidanceResolver`
5. `SGC-005: Wire GenerateIdeasService to request-aware guidance`
6. `SGC-006: Wire HTTP and runner parity`
7. `SGC-007: [INT] Verify generation context wiring across engine entry points`
8. `SGC-008: [DOC] Document smarter generation context`
