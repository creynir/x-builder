---
status: planned
---

# Labeled Corpus Memory

Purpose: turn the local corpus into a labeled memory layer for both posts and replies, including reply parent context, generated-content exclusions, and cheap LLM labels for retrieval.

## What Exists Today

- The canonical SQLite corpus stores posts with `kind` values: `original`, `reply`, `repost_reference`, and `unknown`.
- Existing Voice RAG indexes only `kind = "original"` posts.
- Reply context exists only as live same-dialog context for compose calls.
- Feedback predictions are stored separately from canonical posts.
- There is no generated replies ledger and no advanced LLM label projection in x-builder.

## Target Shape

Create a derived labeled memory layer over the canonical corpus. It should support retrieval over real user-authored originals and replies, while excluding generated content that the system created and later sees again.

Reply examples should preserve parent/root/thread context when available. The label projection should integrate current deterministic labels where possible and add cheap LLM labels for retrieval and generation control.

Suggested first label set, borrowed from `../XActions` Reply RAG:

- `intent`: what the post/reply does, such as `agreement_addition`, `qualified_pushback`, `concrete_suggestion`, `strategic_advice`, `clarifying_question`, `reframe`, `warning`, `brief_ack`, `humor_or_play`.
- `situation`: what context it responds to, such as `technical_take`, `ai_agents`, `developer_tools`, `product_building`, `distribution_question`, `growth_strategy`, `feedback_request`, `launch`, `build_update`, `founder_reflection`, `content_strategy`, `generic_social`.
- `tone`: one to four values such as `calm`, `direct`, `curious`, `warm`, `skeptical`, `playful`, `concise`, `analytical`, `encouraging`.
- `atmosphere`: optional context feel such as `technical_debate`, `launch_energy`, `founder_struggle`, `growth_strategy`, `feedback_loop`, `networking`, `hype`, `critique`, `casual_banter`.
- `contextDependency`: `none`, `parent_helpful`, `parent_required`, `root_required`, or `full_chain_required`.
- `voiceUsefulness`, `qualityTier`, `semanticTags`, `confidence`, and `reason`.

## Boundaries

- The canonical corpus remains source of truth; labels and embeddings are rebuildable projections.
- Generated drafts/replies are not training evidence.
- Do not make labels required for normal generation; missing labels fail open.
- Do not merge external X signals into the user's own corpus or voice.
- Parent/root text is context for retrieval and generation, not factual truth to invent from.

## Existing References

- `docs/features/local-persistence-foundation/README.md`
- `docs/features/voice-rag-generation/README.md`
- `docs/features/reply-composer-context/README.md`
- `engine/src/server/open-engine-database.ts`
- `engine/src/server/post-library-repository.ts`
- Reference repo labels: `../XActions/src/agents/replyRagLlmLabeler.js`
- Reference repo store: `../XActions/data/reply-rag.sqlite`

## Bookkeeper Prompt

```txt
Goal:
Add a labeled corpus memory layer for x-builder posts and replies, with parent/root context for replies, generated-content exclusion, and cheap LLM labels for retrieval.

Existing files:
- docs/features/labeled-corpus-memory/README.md
- docs/features/local-persistence-foundation/README.md
- docs/features/voice-rag-generation/README.md
- docs/features/reply-composer-context/README.md
- engine/src/server/open-engine-database.ts
- engine/src/server/post-library-repository.ts
- ../XActions/src/agents/replyRagLlmLabeler.js
- ../XActions/data/reply-rag.sqlite

Intent:
Keep canonical posts/replies unchanged, then add rebuildable label and retrieval projections. Integrate existing deterministic format/kind labels, add LLM labels for intent/situation/tone/context dependency, and exclude generated replies/posts from RAG if they later appear in capture/import.

Boundaries:
No external-account contamination. No generated output as voice evidence. Labels must be optional and fail open. Do not block existing post generation when labels are missing.

Workflow:
Run arch-recon first, then tickets, then RGB/TDD. Start with schema/projection contracts and label taxonomy tests before wiring retrieval or generation.
```
