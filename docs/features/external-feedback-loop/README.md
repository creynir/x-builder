---
status: in-progress
---

# External Feedback Loop

Purpose: convert evidence-backed external performance patterns into writer constraints without importing another account into the user's own corpus, voice samples, feedback actuals, active context, or local post history.

## Architecture Context

External Feedback Loop is an engine-private generation guidance extension on top of the delivered External X Signals ledger. It consumes only persisted `ExternalXSignalPattern` snapshots, never raw `ExternalXSignalEvidence`, and renders a bounded external-constraints section inside the existing generation guidance path.

The hard consumer boundary is:

1. `ExternalXSignalsService` remains the only writer of persisted external patterns.
2. `ExternalPatternSnapshotReader` is read-only and is constructed from the same `ExternalXSignalsRepository` instance used by `ExternalXSignalsService`.
3. `ExternalPatternGuidanceProvider` sanitizes snapshots into generation-safe guidance items.
4. `createGenerationGuidanceResolver` appends the rendered section to the existing playbook and own-voice guidance.
5. `GenerateIdeasService` keeps its public request and response contract unchanged.

No external pattern data may be written to `PostLibraryRepository`, `CanonicalOwnPost`, voice sample selection, feedback actuals, archive import, live capture, category ranking, cooldown, active scoring context, judge prompts, apply prompts, or local post history. External patterns are derived constraints, not the user's voice.

V1 intentionally does not add a new public API route, `EngineTransport` method, overlay UI, or `generateIdeaRequestSchema` field. The existing Generate rail remains the user entry point. `JudgeDraftService` and `ApplyJudgeSuggestionsService` stay unchanged; they may evaluate text generated under external constraints, but they do not receive external pattern context directly.

## API Endpoints

- `POST /ideas/generate` - unchanged. The request remains `generateIdeaRequestSchema`; the response remains `generateIdeaResponseSchema`.

There is no External Feedback Loop endpoint. `/external-x/signals/overview` remains a settings/read-only source-management surface and is not a generation consumer contract.

## Component Breakdown

- `ExternalPatternGuidanceItem` - engine-private sanitized pattern shape for generation prompts. It contains pattern metadata and statement only, not source ids, evidence ids, evidence previews, handles, platform post ids, metrics, or raw external text.
- `renderExternalPatternGuidance` - deterministic bounded renderer for the external constraints section.
- `ExternalPatternSnapshotReader` - read-only pattern snapshot boundary over persisted `ExternalXSignalPattern` rows.
- `ExternalPatternGuidanceProvider` - converts pattern snapshots into sanitized guidance for generation.
- `createGenerationGuidanceResolver` - existing guidance composition point; gains an optional external pattern provider.
- `GenerateIdeasService` - existing writer entry point; public contract remains unchanged.

## Dependencies

- `external-x-import-signals` is complete. It provides the separate local external ledger, persisted pattern snapshots, observe-only runner ingestion, source-gated capture, and own-corpus isolation tests.
- `generation-and-judge-surface` is implemented. It provides `GenerateIdeasService`, `createGenerationGuidanceResolver`, the Generate rail, and the existing judge/apply loop.
- `my-feedback-loop` is complete and remains own-corpus-only; external patterns must not affect feedback actuals.
- Local SQLite storage remains local-only under the existing engine storage root.

## Sub-Tickets Overview

1. `EFL-001: [FND] Define external pattern guidance contracts and renderer`
2. `EFL-002: [FND] Add pattern-only snapshot reader`
3. `EFL-003: Wire external pattern guidance into generation`
4. `EFL-004: Enforce no-contamination boundaries`
5. `EFL-005: [INT] Cover external pattern generation integration`
6. `EFL-006: [DOC] Document External Feedback Loop`

## Pipeline Log

- 2026-06-29: Arch recon approved after validator-required construction contract fix: generation guidance must share the exact same `ExternalXSignalsRepository` instance as `ExternalXSignalsService`, or external guidance stays disabled for that host construction.
- 2026-06-29: RGB ticket audit approved after correcting two Red-blocking details: `generateIdeaRequestSchema` strips unknown external fields rather than rejecting the whole payload, and malformed pattern payloads follow the repository's existing parse-and-throw validation behavior.
- 2026-06-29: EFL-001 through EFL-004 completed. Generation guidance now consumes sanitized external pattern snapshots, and EFL-004 regression guards enforce the no-contamination boundary across own corpus, voice samples, feedback, category ranking, active context, archive/capture, judge/apply prompts, and public request schemas.
- 2026-06-29: EFL-005 completed. The integration path proves persisted eligible external patterns reach generation guidance through existing server/runner generation paths, and removed-source-only patterns are filtered out before prompt rendering.
