---
status: planned
---

# Reply Thread Context

Purpose: give reply generation the whole available conversation spine up to the parent/root post instead of only the same-dialog target tweet.

## Architecture Context

`reply-thread-context` extends the existing same-dialog `ReplyComposerContext` flow. It does not add a new transport binding, endpoint, thread browser, fetch-more button, profile navigation fallback, or synthetic GraphQL request. The existing 24-method `EngineTransport` surface stays stable.

The canonical contract names are `replyThreadDomEvidence`, `replyThreadContext`, `replyThreadContextDiagnostics`, and `reply_context_incomplete`.

`AnchorLayer` remains the same-dialog DOM producer. When it can already create today's valid `replyContext`, it also attaches `replyContext.replyThreadDomEvidence` with the current target evidence. Incomplete same-dialog evidence remains local diagnostics only and must not be sent as a fake reply context.

Thread context is resolved inside the existing analyze/generate/judge/apply method paths from:

- same-dialog DOM evidence carried by `replyContext.replyThreadDomEvidence`;
- already-fetched GraphQL evidence passively observed by `GraphQlCaptureObserver`;
- imported archive/live own-post evidence already stored locally.

Observed non-own root/parent posts live in a separate observed-thread projection, not in the canonical own-post corpus. Missing root, parent, author, timestamp, URL, or text fields are represented as diagnostics. Root or parent text is never invented.

`AnalyzePostsResponse.items[]` is the only success diagnostics surface. Generate, judge, and apply success responses stay unchanged. When a context-required generation/judge/apply path needs parent context and it was not observed, the engine fails closed with `reply_context_incomplete`, carrying `replyThreadContextDiagnostics` in the structured error details.

All thread text is untrusted prompt input. Prompt rendering must label root, parent, ancestors, current target, and previous own replies as context, not instructions.

## API Endpoints

No new endpoints.

- `POST /posts/analyze` - accepts existing item-level `replyContext`; returns optional `replyThreadContext` and `replyThreadContextDiagnostics` on analyzed items.
- `POST /ideas/generate` - accepts existing `replyContext`; success response stays unchanged; may return `reply_context_incomplete`.
- `POST /drafts/judge` - accepts existing `replyContext`; success response stays unchanged; may return `reply_context_incomplete`.
- `POST /drafts/apply-suggestions` - accepts existing `replyContext`; success response stays unchanged; may return `reply_context_incomplete`.

## Component Breakdown

- `ReplyThreadDomEvidence` - shared evidence envelope attached to valid same-dialog `replyContext`.
- `ReplyThreadContext` - shared resolved observed-only thread context with current target, optional parent/root, ordered ancestors, previous own replies, status ids, weak metrics, and diagnostics.
- `ReplyThreadContextDiagnostics` - canonical UI/prompt diagnostics and missing-context status.
- `ObservedThreadPost` - observed graph node from same-dialog DOM, passive GraphQL, or local archive/live evidence.
- `XGraphQlNormalizer` - extracts observed thread posts only from already-fetched timeline GraphQL responses.
- `ObservedThreadRepository` - SQLite-backed observed graph store separate from `PostLibraryRepository`.
- `ReplyThreadContextResolver` - merges same-dialog target evidence with observed graph storage and returns resolved context plus diagnostics.
- `ReplyThreadContextDiagnostics` UI - compose-cockpit static-pin section for partial/blocking context diagnostics.
- `ReplyContextIncompleteError` - engine error mapped to `reply_context_incomplete` for context-required action failures.

## Dependencies

- Existing `ReplyComposerContext` and compose split/merge behavior.
- Existing shared Zod schema/export pattern.
- Existing `GraphQlCaptureObserver` response-only capture boundary.
- Existing SQLite migration pattern in the engine package.
- Existing overlay compose cockpit and fake transport tests.

## Sub-Tickets Overview

1. `RTC-001: [RFR] Pin Existing Same-Dialog Reply Behavior`
2. `RTC-002: [FND] Add Canonical Reply Thread Shared Contracts`
3. `RTC-003: [FND] Attach Same-Dialog DOM Evidence To ReplyComposerContext`
4. `RTC-004: Passive GraphQL Evidence Producer`
5. `RTC-005: Observed Thread Storage`
6. `RTC-006: Reply Thread Resolver`
7. `RTC-007: Analyze Response Reply Thread Diagnostics`
8. `RTC-008: Fail Closed Context-Required LLM Actions`
9. `RTC-009: [INT] Existing Transport Boundary Contract`
10. `RTC-010: [E2E] Reply Thread Context Flow`
11. `RTC-011: [DOC] Reply Thread Context Documentation`

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
