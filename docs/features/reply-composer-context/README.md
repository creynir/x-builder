---
status: done
---

# Reply Composer Context

Purpose: make the existing X compose cockpit reply-aware when the active X composer is a reply, without creating a separate reply product or changing normal post generation.

## Architecture Context

`reply-composer-context` extends the current overlay compose path centered on `ComposeContextValue`, `ComposeCockpit`, and the existing `EngineTransport` methods: `generateIdeas`, `judgeDraft`, `analyzePosts`, and `applyJudgeSuggestions`. It does not add a new transport method, persistence layer, X API call, profile-navigation fallback, standalone reply panel, or autonomous X action.

Reply mode is detected only from same-dialog DOM evidence: an active composer, a replied-to tweet/article in the same dialog, target author handle, target text, and optional status id/url. A leading `@target` in the composer is never sufficient on its own. Ordinary composers with no reply evidence remain normal compose. A reply-looking dialog with insufficient target evidence must withhold `replyContext` and avoid reply-aware writes, so the system fails closed instead of inventing target context.

The core invariant is split/merge. In reply mode the overlay separates X's structural leading target handle from the authored reply body. Engine calls receive and return authored body text plus `replyContext`; the overlay re-merges the structural prefix only when it is still present at action time. If the user deleted the prefix, deletion wins. In normal post mode no split runs, and a leading `@handle` remains normal authored text.

Scoring v1 is real but narrow. When `AnalyzePostsRequest.items[].replyContext` exists, deterministic scoring evaluates the authored body, protects against duplicate structural target handles, skips or fails prefix-only replies before misleading scoring, and gates all reply-only checks on per-item `replyContext`. No broad new score dimension or response contract is introduced.

Generation stays category/idea driven. `GenerateIdeaRequest` still requires `idea` or `format`; `replyContext` only enriches an otherwise valid generation request. The deterministic idea-only path remains behavior-compatible and does not become an LLM or judge path just because `replyContext` is present.

## API Endpoints

No new endpoints.

- `POST /ideas/generate` - add optional `replyContext` to the existing request; `idea` or `format` remains required.
- `POST /drafts/judge` - add optional `replyContext`; the route passes it into `JudgeDraftService` options.
- `POST /drafts/apply-suggestions` - add optional `replyContext`; the service rewrites and re-judges authored body text.
- `POST /posts/analyze` - add optional per-item `replyContext`; deterministic analysis gates reply checks per item.

## Component Breakdown

- `ReplyComposerContext` - shared JSON contract for same-dialog X reply target metadata and leading target-handle state.
- `ComposeContextValue` - overlay-produced compose state, extended with optional reply context and split/merge metadata.
- `ReplyDraftSplit` helpers - overlay-local helpers that derive authored body text, structural prefix state, duplicate-handle stripping, and merge behavior.
- `ComposeCockpit` - existing cockpit orchestrator; sends authored body plus `replyContext` through generate, judge, analyze, and apply flows.
- `JudgeDraftService` - consumes `replyContext` through options and adds reply-aware prompt framing.
- `GenerateIdeasService` - uses `replyContext` on the format path and passes it into candidate judge calls; idea-only behavior remains deterministic.
- `ApplyJudgeSuggestionsService` - rewrites authored body text with reply context and returns body-only text.
- `DeterministicAnalysisService` - applies minimal reply-only scoring guards when an item has `replyContext`.

## Dependencies

- Existing overlay browser-test harness and fake transport.
- Existing shared Zod schemas and `EngineTransport` request types.
- Existing engine server route tests and fake LLM/judge test patterns.
- Existing runner/overlay E2E harness using mock X DOM and schema-shaped transport fakes.

## Sub-Tickets Overview

1. `RCC-001: [FND] Shared Reply Composer Context Contract`
2. `RCC-002: [FND] Overlay Reply Detection And Draft Split Helpers`
3. `RCC-003: Reply-Aware Engine Consumers`
4. `RCC-004: Reply-Aware Compose Cockpit Orchestration`
5. `RCC-005: [INT] Reply Context Integration Coverage`
6. `RCC-006: [E2E] Reply Composer Overlay Flow`

## Pipeline Log

- 2026-06-29: Arch recon approved with concerns folded into this context: ordinary compose remains normal when reply evidence is absent; reply-looking partial target evidence withholds `replyContext`; `replyContext` never satisfies generation without `idea` or `format`; idea-only generation remains deterministic.
