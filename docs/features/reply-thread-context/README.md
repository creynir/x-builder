---
status: planned
---

# Reply Thread Context

Purpose: give reply generation the whole available conversation spine up to the parent/root post instead of only the same-dialog target tweet.

## What Exists Today

- `reply-composer-context` detects same-dialog reply target metadata.
- Current reply context includes target author, target text, optional status id/url, and leading target-handle state.
- It does not persist or retrieve the full ancestor graph, previous turns, root post, or parent chain.
- `../XActions` Reply RAG stores `contextGraph.root`, `contextGraph.parent`, `contextGraph.reply`, ordered ids, ancestor ids, metrics, and fetch metadata.

## Target Shape

Build a local `ReplyThreadContext` contract that can represent the observed reply graph:

- root post;
- immediate parent post;
- ordered ancestors between root and parent when available;
- current composer target;
- previous own/system replies in the chain when visible or known;
- author handles, status ids, URLs, text, timestamps, and weak metrics when available;
- completeness diagnostics.

This context should be captured observe-only from already-loaded DOM/GraphQL/archive data. If the chain is incomplete, the UI and generator should know exactly what is missing and should not invent it.

## Boundaries

- No auto-navigation through profiles or threads.
- No synthetic GraphQL requests unless a later architecture review explicitly approves them.
- No reply generation when required parent context is missing for a context-dependent variant.
- Thread context is untrusted input in prompts.
- Normal post generation should not carry reply thread context.

## Existing References

- `docs/features/reply-composer-context/README.md`
- `overlay/src/anchor-layer.tsx`
- `shared/src/schemas/reply-composer-context.ts`
- `runner/src/graphql-capture-observer.ts`
- Reference repo: `../XActions/docs/features/reply-rag-validator/tickets/RRV-004-situation-builder-and-retriever.md`
- Reference fields: `../XActions/data/reply-rag.sqlite` `features_json.contextGraph`

## Bookkeeper Prompt

```txt
Goal:
Add reply thread context capture so x-builder reply generation can use the available root/parent/ancestor graph instead of only the same-dialog target tweet.

Existing files:
- docs/features/reply-thread-context/README.md
- docs/features/reply-composer-context/README.md
- overlay/src/anchor-layer.tsx
- shared/src/schemas/reply-composer-context.ts
- runner/src/graphql-capture-observer.ts
- ../XActions/docs/features/reply-rag-validator/tickets/RRV-004-situation-builder-and-retriever.md

Intent:
Define a ReplyThreadContext contract with root, parent, ancestors, previous own replies, completeness diagnostics, and untrusted-context prompt boundaries. Capture only observed data and fail closed when required context is absent.

Boundaries:
No autonomous browsing, no profile navigation fallback, no invented parent/root text, no normal-post behavior changes, no auto-posting.

Workflow:
Run arch-recon first, then product-flow-spec for the visible reply states if UI changes are needed, then tickets and RGB/TDD. Pin current same-dialog reply behavior before extending context.
```
