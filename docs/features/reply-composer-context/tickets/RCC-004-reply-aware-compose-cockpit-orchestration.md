---
status: todo
---

# RCC-004: Reply-Aware Compose Cockpit Orchestration

## Implementation Details

Wire existing `ComposeCockpit` flows to the reply context and split/merge helpers:

- Derive the current split state from `compose.composerText` and `compose.replyContext`.
- Use authored body text for static analyze, manual judge, generate feedback recording, and apply-all requests in reply mode.
- Include `replyContext` in transport requests only when detected context is present.
- Do not call analyze or judge for prefix-only reply text.
- Generate with the existing category/format request plus `replyContext`.
- Treat generated candidates as authored body text in reply mode.
- Strip duplicate target handles from generated or applied body text before writing.
- Merge current structural prefix plus returned body text before calling `writeIntoComposer`.
- Keep provenance anchor, `lastWriteRef`, stale-token checks, and green wash based on the full merged composer text.
- If the user deleted the structural prefix before generate/apply, write body only and do not restore the prefix.
- In normal post mode, keep current request shapes and never strip a leading `@handle`.

No new reply panel is introduced. A tiny status affordance is allowed only if it uses existing primitives and does not change the cockpit layout contract, but it is not required.

## Data Models

Consumes:

- `ReplyComposerContext`
- `ReplyDraftSplit`
- existing `GenerateIdeaRequest`
- existing `JudgeDraftRequest`
- existing `ApplyJudgeSuggestionsRequest`
- existing `AnalyzePostsRequest`

No new response models.

## Integration Point

Parent mount: `ComposeCockpit` remains mounted by the existing overlay runtime under `AnchorLayer`.

User entry point: the user opens X's existing post or reply composer while the overlay is active.

Terminal outcome: the existing cockpit can generate, judge, score, apply, and record feedback for reply drafts while preserving visible X reply prefix behavior.

## Scope Boundaries / Out of Scope

In scope:

- Compose cockpit request construction.
- Reply split/merge use in analyze, judge, generate, apply, and feedback recording.
- Duplicate target-handle stripping before composer writes.
- Prefix-only skip/disabled behavior.
- Existing stale-token protections preserved.
- Overlay tests with fake transport.

Out of scope, with zero code:

- New engine behavior beyond RCC-003.
- Shared schema changes beyond RCC-001.
- New panels, cards, reply previews, or separate reply product.
- X network lookup or fallback navigation.
- Auto-posting or clicking X's Post button.
- Normal-mode stripping of any leading mention.

## Test Strategy & Fixture Ownership

Coverage level: overlay browser/component tests.

Owning suite: existing `ComposeCockpit` browser integration tests and compose test fixtures.

Fixture strategy: extend synthetic composer DOM fixtures to represent reply dialogs with target article/status link/author/text and seeded prefix. Use `FakeEngineTransport` to capture requests and schema-shaped responses.

Dependency category: in-process overlay render and fake transport only. No real engine, runner, X session, local settings, network, or persisted user state.

Isolation boundary: browser test fixture with teardown after each test.

## Definition of Done

- In reply mode, analyze and judge receive authored body plus `replyContext`.
- Prefix-only reply text does not trigger misleading analyze or judge calls.
- Generate sends format plus `replyContext`.
- Generated body text is written with exactly one structural prefix when the prefix is still present.
- Apply sends authored body plus `replyContext`, writes prefix plus returned body, and anchors provenance to the merged text.
- User-deleted prefix is not restored.
- Normal compose behavior remains byte-compatible for existing request shapes.
- Targeted overlay tests and overlay typecheck pass for touched files.

## Acceptance Criteria

- Given reply composer text `@alice good point`, when the static analyze debounce fires, then `analyzePosts` receives item text `good point` and `replyContext`.
- Given reply composer text `@alice good point`, when the user runs judge, then `judgeDraft` receives text `good point` and `replyContext`.
- Given reply composer text `@alice ` with no body, when the cockpit settles, then analyze and judge do not run for the prefix alone.
- Given reply context and the user clicks a generation category, when `generateIdeas` is called, then the request contains the category format and `replyContext`.
- Given a generated candidate body `agree with this`, when the structural prefix is still present, then the composer receives `@alice agree with this`.
- Given a generated candidate body `@alice agree with this`, when the structural prefix is still present, then the composer receives exactly one `@alice ` prefix.
- Given the user deleted the structural prefix before generate/apply, when the cockpit writes the result, then it writes the body only.
- Given normal compose text `@alice good point`, when analyze/judge/generate/apply run, then the full text remains authored content and no `replyContext` is sent.
- Given apply returns original body through the never-worse guard, when the cockpit writes, then provenance and composer text still use the correct merged full text.

## Visual AC

- Existing cockpit pin layout remains unchanged.
- No new reply panel, target preview card, or extra route appears.
- Existing button focus order remains unchanged.
- If a small reply status badge is added, it uses existing `Badge` and design tokens and is static, non-focusable text.
- Confirmation sheet stand-down behavior remains unchanged.

## Edge Cases

- Prefix-only reply.
- Duplicate returned target handle.
- User-deleted prefix.
- In-flight generate/judge/apply resolved after edit.
- Generated candidate without verdict.
- Apply returns original body.
- Missing or stale reply context after SPA churn.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
