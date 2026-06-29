---
status: in_progress
---

# RCC-005: [INT] Reply Context Integration Coverage

## User Flows to Verify

- Given an HTTP caller posts to `/ideas/generate` with `format` and `replyContext`, when the route handles the request, then the generation service receives the context and the response contract remains valid.
- Given an HTTP caller posts to `/drafts/judge` with `text` and `replyContext`, when the route handles the request, then the judge service receives the context through options.
- Given an HTTP caller posts to `/drafts/apply-suggestions` with `text` and `replyContext`, when the route handles the request, then the apply service receives the context.
- Given an HTTP caller posts to `/posts/analyze` with an item-level `replyContext`, when the route handles the request, then deterministic analysis receives the item context.
- Given the compose cockpit runs in a reply fixture, when analyze, judge, generate, and apply are triggered, then transport requests carry authored body plus `replyContext`.
- Given the compose cockpit runs in a normal compose fixture whose text begins with `@alice`, when the same flows run, then no reply context is sent and text is not stripped.

## Architectural Invariants

- `replyContext` is an additive field on existing request bodies, not a new transport method or endpoint.
- `GenerateIdeaRequest` still requires `idea` or `format`; `replyContext` alone is not a generation trigger.
- Reply-context route parsing must preserve context into the service boundary; a route that parses then drops context fails this ticket.
- Cockpit reply orchestration must be one existing component tree; a separate reply-only cockpit or product surface fails this ticket.
- Reply-mode transport text is authored body; normal-mode transport text is full composer text.
- Prefix merge happens at the composer write boundary, not inside engine response contracts.

## Modules Under Test

- Shared request schemas.
- Engine server route handlers for generate, judge, apply, and analyze.
- `ComposeCockpit` with `AnchorLayer` and `OverlayTransportProvider`.
- `FakeEngineTransport` test harness.

## Integration Point

User entry point: existing X compose or reply dialog with overlay active, plus existing HTTP fallback endpoints for the engine.

Terminal outcome: reply context is preserved end to end across route and overlay boundaries without changing normal compose behavior.

## Scope Boundaries / Out of Scope

In scope:

- Integration tests across schema, route, service boundary, and overlay transport boundary.
- Test-only fixtures and schema-shaped fakes.
- Small production fixes only if an integration test exposes missed pass-through wiring from prior tickets.

Out of scope, with zero code:

- New feature behavior not covered by RCC-001 through RCC-004.
- Live X, live LLM provider, real posting, persistence changes, or new UI.
- Ticket-id named test files, suites, fixtures, or snapshots.

## Test Strategy & Fixture Ownership

Coverage level: integration tests.

Owning suites: engine server integration tests for HTTP pass-through and overlay browser tests for cockpit transport wiring.

Fixture strategy: schema-shaped `ReplyComposerContext` fixture builder; fake services capturing request/options; synthetic reply and normal compose DOM fixtures.

Dependency category: in-process server injection and browser-test render with fake transport. No live LLM, no live X, no network, no runtime settings except isolated test repositories where existing route patterns require them.

Isolation boundary: explicit test fixtures and per-test teardown.

## Definition of Done

- Route pass-through tests prove `replyContext` reaches service boundaries.
- Overlay integration tests prove reply mode sends authored body plus context and normal mode remains unchanged.
- `replyContext`-only generation is rejected through shared schema or route validation.
- Existing related route and overlay tests remain green.

## Acceptance Criteria

- Given `/ideas/generate` receives `{ format, replyContext }`, when an injected generation service captures input, then the captured request contains `replyContext`.
- Given `/ideas/generate` receives `{ replyContext }`, when the route parses the request, then the response is a validation error.
- Given `/drafts/judge` receives `{ text, replyContext }`, when an injected judge captures options, then `options.replyContext` matches the request context.
- Given `/drafts/apply-suggestions` receives `{ text, replyContext }`, when an injected apply service captures input, then the captured request contains `replyContext`.
- Given `/posts/analyze` receives item-level `replyContext`, when an injected analyzer captures input, then the item context is preserved.
- Given reply cockpit text `@alice body`, when the overlay triggers analyze/judge/generate/apply, then fake transport calls receive `body` plus `replyContext`.
- Given normal cockpit text `@alice body`, when the overlay triggers the same flows, then fake transport calls receive `@alice body` and no `replyContext`.

## Visual AC

No new visual behavior is introduced by this test ticket. Existing cockpit layout must remain stable in tested fixtures.

## Edge Cases

- Omitted `replyContext`.
- Invalid reply context rejected by schema.
- Prefix-only body.
- Duplicate generated handle.
- Normal compose with leading mention.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
- 2026-06-29: Started RGB-TDD integration coverage after RCC-004 Blue/Yellow approval.
