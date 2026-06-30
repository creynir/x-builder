---
status: planned
---

# Unified Generation Context

Purpose: make both post generation and reply generation consume the same derived voice skill and labeled corpus memory while still using different task-specific retrieval rules.

## What Exists Today

- Post format generation uses format playbook slices, optional external pattern guidance, and own original-post voice samples.
- Reply generation currently rides the same `generateIdeas` path with optional `replyContext`.
- Voice RAG indexes original posts only.
- External X signals are generation-only weak constraints and are not part of the user's voice.
- There is no unified context policy that decides which memory sources post generation vs reply generation may use.

## Target Shape

Create a generation context policy layer that assembles prompt context by task:

- Post generation uses the archive-derived voice skill, format playbook slice, labeled original-post examples, relevant non-generated historical posts, selected external pattern constraints, and feedback learnings when available.
- Reply generation uses the archive-derived voice skill, reply thread context, grounded fact/belief statements, labeled non-generated reply examples with parent/root context, and optional post examples only as voice support.
- Both paths should share the voice skill, generated-content exclusion rules, label taxonomy, and local-first privacy boundaries.

The policy should make source attribution explicit so prompts do not blur voice examples, external patterns, parent thread facts, and feedback outcomes.

Reply context assembly should use a dual retrieval plan:

1. Fact/belief retrieval returns compact supported statements about what the user has claimed, used, preferred, disliked, rejected, compared, or expressed uncertainty about.
2. Similar-situation voice retrieval returns grouped examples for how the user tends to reply in the same situation, intent, tone, atmosphere, semantic topic, and parent/root context shape.

The reply plan should separate grounded claims from voice/reply-move guidance before drafting variants.

## Boundaries

- Do not collapse post and reply generation into one UI or one prompt.
- Do not use external account text as the user's voice.
- Do not include generated replies/posts as retrieval examples.
- Reply generation should not use reach estimation or LLM judge.
- Context assembly must be bounded and fail open when optional projections are unavailable.
- Similar-situation examples must not be treated as factual support unless the fact/belief projection promotes them with evidence and confidence.
- Grounding/relevance checks may shape the internal reply plan, but must not become user-facing reply scoring or judge UI.

## Existing References

- `docs/features/archive-voice-skill/README.md`
- `docs/features/labeled-corpus-memory/README.md`
- `docs/features/reply-thread-context/README.md`
- `docs/features/reply-variant-assistant/README.md`
- `docs/features/smarter-generation-context/README.md`
- `docs/features/external-feedback-loop/README.md`
- `engine/src/llm/generation-guidance.ts`
- `engine/src/llm/generate-ideas-service.ts`
- `engine/src/llm/external-pattern-guidance.ts`
- `../XActions/docs/features/reply-drafter-dual-rag/README.md`

## Bookkeeper Prompt

```txt
Goal:
Unify generation context assembly so posts and replies both use the archive-derived voice skill and labeled corpus memory, while keeping task-specific retrieval and UI behavior separate.

Existing files:
- docs/features/unified-generation-context/README.md
- docs/features/archive-voice-skill/README.md
- docs/features/labeled-corpus-memory/README.md
- docs/features/reply-thread-context/README.md
- docs/features/reply-variant-assistant/README.md
- docs/features/smarter-generation-context/README.md
- docs/features/external-feedback-loop/README.md
- engine/src/llm/generation-guidance.ts
- engine/src/llm/generate-ideas-service.ts
- engine/src/llm/external-pattern-guidance.ts
- ../XActions/docs/features/reply-drafter-dual-rag/README.md

Intent:
Create a bounded context policy for post generation and reply generation. Posts use format/playbook/voice/post-memory/feedback/external constraints. Replies use thread context plus a dual retrieval plan: fact/belief grounding for supported claims, and similar-situation voice retrieval for reply move and style. Both paths share source attribution, generated-content exclusion, and local privacy rules.

Boundaries:
No external voice contamination. No generated-content RAG. No reply reach scoring or reply judge. Do not treat retrieved voice examples as factual proof. Do not remove existing fail-open generation behavior.

Workflow:
Run arch-recon after the prerequisite docs are accepted. Implement only after archive voice skill, labeled corpus memory, and reply thread context have stable contracts.
```
