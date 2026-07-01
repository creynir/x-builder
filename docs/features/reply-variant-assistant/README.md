---
status: in_review
---

# Reply Variant Assistant

Purpose: replace the current post-like reply generation behavior with a reply-specific assistant that drafts three to four parent-aware reply variants, lets the user choose one, and records generated replies for future exclusion.

## Architecture Context

Reply Variant Assistant adds a separate reply path instead of extending post idea generation. Normal post compose keeps the existing cockpit path. Reply mode branches early from `ComposeCockpit` when `replyContext` exists, so it must not mount or call the legacy post category rail, static score/Post Coach column, judge strip, apply-all, reach prediction, or feedback prediction recording.

The current reply split/merge behavior is a dependency and must be pinned first: authored body excludes X's structural leading target handle, duplicate generated target handles are stripped before write, the latest live composer split is re-read immediately before a write, and a user-deleted target handle is never restored. Native X composer editing remains the source of truth. x-builder never clicks X's Reply/Post button.

Shared contracts add `generateReplyVariants` and `recordGeneratedReply` as distinct transport methods. `generateReplyVariants` requires `replyContext`, accepts optional `currentAuthoredBody` capped at 1,000 characters, and returns three to four unscored body-only variants. The reply response must not contain `verdict`, `approved`, reach, Post Coach, judge annotations, apply suggestions, or post format/category fields. Grounded facts/beliefs and similar-situation voice examples remain separate internal planning lanes; context and grounding notes may be shown as diagnostics, never as reply scoring UI.

Generated replies are recorded through an exact normalized hash ledger. The normalizer is NFKC, whitespace collapse, trim, and hash namespace `sha256:rva-generated-reply:v1:`. The canonical corpus remains visible, but voice/RAG evidence readers must exclude exact generated hashes at these seams: archive voice profile corpus rows, voice index stale/count/orphan handling, SQLite voice sample known/vector/recent rows, and the generation-guidance fallback over `PostLibraryRepository.loadStore`.

## API Endpoints

- `POST /replies/variants/generate` - validates a reply generation request, enriches `replyContext` through the observed-only reply thread resolver, and returns three to four unscored reply variants.
- `POST /generated-replies/record` - records the chosen generated reply body and written text hashes for future exact generated-content exclusion.

## Component Breakdown

- `ReplyVariant` shared schema - body-only unscored reply option with reply move, grounding notes, and warnings.
- `GenerateReplyVariantsRequest` shared schema - requires `replyContext`, accepts optional `currentAuthoredBody`, and never accepts post format/category.
- `GeneratedReplyLedger` shared schema - records generated reply hashes and chosen variant metadata.
- `ReplyVariantGenerationService` - builds a reply plan from observed context, available grounded claims, and similar-situation voice guidance, then generates 3-4 variants without a candidate judge pass.
- `GeneratedReplyLedgerService` and `SqliteGeneratedReplyLedgerRepository` - own generated reply recording and exact hash lookup.
- `ComposeCockpit` reply branch - routes reply mode to a dedicated assistant before legacy post cockpit side effects run.
- `ReplyAssistantPin` - renders context summary, generate control, variant chooser, and ledger status using v2 primitives.
- Voice evidence exclusion hooks - filter generated hashes from archive voice profile, voice index, SQLite voice sample provider, and generation-guidance fallback selection.

## Dependencies

- Existing `ReplyComposerContext`, `ReplyThreadContextResolver`, and split/merge behavior.
- Existing shared Zod schema/export pattern and `EngineTransport` binding registry.
- Existing Fastify route parsing and runner expose-function transport patterns.
- Existing SQLite migration/repository pattern.
- Existing v2 overlay primitives under `overlay/src/ui/v2/`.

## Sub-Tickets Overview

1. `RVA-001: [RFR] Pin Reply Split/Merge Behavior`
2. `RVA-002: [FND] Reply Assistant Shared Contracts And Transport Surface`
3. `RVA-003: [FND] Generated Reply Ledger And Hash Projection`
4. `RVA-004: Reply Variant Generation Routes And Service`
5. `RVA-005: Generated Reply Exclusion From Voice Evidence`
6. `RVA-006: Reply Assistant Overlay Branch`
7. `RVA-007: Reply Variant Choose And Record Flow`
8. `RVA-008: [INT] Reply Assistant End-To-End Contract`

## What Exists Today

- Reply mode reuses the same compose cockpit and left generate category rail as post generation.
- Reply generation calls `generateIdeas({ format, replyContext })`.
- The service creates exactly three candidates, judges them, and the overlay auto-writes the best approved candidate or falls back to the first.
- Reply drafts can be analyzed and recorded in the feedback loop, but there is no generated replies table.

## Target Shape

Reply generation should have its own UI and generation contract. The user opens an X reply composer, sees parent/thread context, asks for reply help, reviews three to four variants, chooses one, and then edits it in the native composer.

The reply assistant should not show reach estimation, Post Coach scoring, or LLM judge verdicts. Reply quality is contextual and user-selected. The system should help write, not score.

Variants should be drafted from a reply plan that separates grounded claims from similar-situation voice guidance. The UI can show the parent/thread context and variants, but it should not expose a judge panel or score each variant.

When a reply variant is chosen, x-builder records it in a generated reply ledger. If the same text appears later in live capture or archive import, the memory layer should recognize it as generated and exclude it from voice/RAG training evidence.

## Boundaries

- No auto-posting or clicking X's Reply button.
- No reach estimate, LLM judge, apply-all, or post coach in the reply assistant.
- Do not reuse post generation category UI as the primary reply UI.
- Generated replies are excluded from RAG until/unless the user explicitly promotes them as examples in a later feature.
- User edits after choosing a variant remain user-authored content; the exclusion boundary should be conservative and content-hash based.
- Do not use similar-situation examples as factual claims unless the generation context provides a grounded fact/belief statement.

## Existing References

- `docs/features/reply-composer-context/README.md`
- `docs/features/reply-thread-context/README.md`
- `docs/features/labeled-corpus-memory/README.md`
- `overlay/src/compose/compose-cockpit.tsx`
- `engine/src/llm/generate-ideas-service.ts`
- `shared/src/schemas/shell.ts`
- Reference repo: `../XActions/docs/features/reply-rag-validator/README.md`
- Reference repo dual-RAG plan: `../XActions/docs/features/reply-drafter-dual-rag/README.md`

## Bookkeeper Prompt

```txt
Goal:
Build a reply-specific assistant UI and generation contract: parent-aware 3-4 reply variants, user chooses one, user can edit, no reach score and no LLM judge.

Existing files:
- docs/features/reply-variant-assistant/README.md
- docs/features/reply-composer-context/README.md
- docs/features/reply-thread-context/README.md
- docs/features/labeled-corpus-memory/README.md
- overlay/src/compose/compose-cockpit.tsx
- engine/src/llm/generate-ideas-service.ts
- shared/src/schemas/shell.ts
- ../XActions/docs/features/reply-rag-validator/README.md
- ../XActions/docs/features/reply-drafter-dual-rag/README.md

Intent:
Separate reply generation from post generation at the product and contract level. Show reply variants in a reply-specific UI, preserve native composer editing, and record chosen generated replies so the memory layer can exclude them from RAG when observed later. Generate variants from a reply plan that separates grounded facts/beliefs from similar-situation voice examples.

Boundaries:
No auto-posting. No post reach model, Post Coach, LLM judge, or apply-all in reply mode. Do not make generated replies voice evidence. Do not invent missing thread context. Do not surface grounding as reply scoring UI.

Workflow:
Run product-flow-map for the reply flow, then product-flow-spec for the reply UI, then arch-recon, tickets, and RGB/TDD. Start by pinning current reply compose behavior so the new reply assistant does not regress split/merge safety.
```
