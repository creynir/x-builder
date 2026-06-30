---
status: planned
---

# Reply Variant Assistant

Purpose: replace the current post-like reply generation behavior with a reply-specific assistant that drafts three to four parent-aware reply variants, lets the user choose one, and records generated replies for future exclusion.

## What Exists Today

- Reply mode reuses the same compose cockpit and left generate category rail as post generation.
- Reply generation calls `generateIdeas({ format, replyContext })`.
- The service creates exactly three candidates, judges them, and the overlay auto-writes the best approved candidate or falls back to the first.
- Reply drafts can be analyzed and recorded in the feedback loop, but there is no generated replies table.

## Target Shape

Reply generation should have its own UI and generation contract. The user opens an X reply composer, sees parent/thread context, asks for reply help, reviews three to four variants, chooses one, and then edits it in the native composer.

The reply assistant should not show reach estimation, Post Coach scoring, or LLM judge verdicts. Reply quality is contextual and user-selected. The system should help write, not score.

When a reply variant is chosen, x-builder records it in a generated reply ledger. If the same text appears later in live capture or archive import, the memory layer should recognize it as generated and exclude it from voice/RAG training evidence.

## Boundaries

- No auto-posting or clicking X's Reply button.
- No reach estimate, LLM judge, apply-all, or post coach in the reply assistant.
- Do not reuse post generation category UI as the primary reply UI.
- Generated replies are excluded from RAG until/unless the user explicitly promotes them as examples in a later feature.
- User edits after choosing a variant remain user-authored content; the exclusion boundary should be conservative and content-hash based.

## Existing References

- `docs/features/reply-composer-context/README.md`
- `docs/features/reply-thread-context/README.md`
- `docs/features/labeled-corpus-memory/README.md`
- `overlay/src/compose/compose-cockpit.tsx`
- `engine/src/llm/generate-ideas-service.ts`
- `shared/src/schemas/shell.ts`
- Reference repo: `../XActions/docs/features/reply-rag-validator/README.md`

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

Intent:
Separate reply generation from post generation at the product and contract level. Show reply variants in a reply-specific UI, preserve native composer editing, and record chosen generated replies so the memory layer can exclude them from RAG when observed later.

Boundaries:
No auto-posting. No post reach model, Post Coach, LLM judge, or apply-all in reply mode. Do not make generated replies voice evidence. Do not invent missing thread context.

Workflow:
Run product-flow-map for the reply flow, then product-flow-spec for the reply UI, then arch-recon, tickets, and RGB/TDD. Start by pinning current reply compose behavior so the new reply assistant does not regress split/merge safety.
```
