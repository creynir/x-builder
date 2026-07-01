---
status: todo
---

# RTC-006: Reply Thread Resolver

## Implementation Details

Add `ReplyThreadContextResolver` to merge `replyContext.replyThreadDomEvidence` with observed-thread storage. The resolver attaches `replyThreadContext` and canonical `replyThreadContextDiagnostics` inside existing analyze/generate/judge/apply service entry points.

## Data Models

Inputs:

- `ReplyComposerContext.replyThreadDomEvidence`
- observed `ReplyThreadPost` rows from the observed-thread repository
- local own-post evidence for previous own replies

Output:

- `ReplyThreadContext`
- `ReplyThreadContextDiagnostics`

## Integration Point

User entry point: existing reply analyze/generate/judge/apply actions.

Existing module consumers: engine analyze, generation, judge, apply, prompt formatter, and transport-bound services.

Terminal outcome: engine consumers receive resolved observed-only thread context or explicit diagnostics before prompt/analyze behavior runs.

## Scope Boundaries / Out of Scope

In scope:

- Resolve current target from DOM evidence.
- Follow observed parent/root edges through local observed storage.
- Order ancestors root to parent.
- Identify previous own replies when observed.
- Produce diagnostics for missing root/parent/ancestor/text/author/timestamp fields.
- Bound graph assembly.

Out of scope:

- Network fetches.
- Browser navigation.
- Synthetic GraphQL.
- Invented root/parent text.
- Writing prompt or UI rendering.
- Normal post behavior changes.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests.

Owning suite: engine resolver tests.

Fixture strategy: fake observed-thread repository with complete graph, same-dialog-only graph, missing parent, missing root, cycle, and previous own reply fixtures.

Dependency category: in-process repository fake.

Isolation boundary: pure resolver tests; storage behavior covered by RTC-005.

## Definition of Done

- Resolver returns `thread_ready` for complete observed chains.
- Resolver returns `same_dialog_only` when only current target is observed.
- Resolver returns `blocked_missing_required_parent` when required parent context is absent.
- Resolver never invents missing root/parent text.
- Resolver protects against cycles and excessive graph size.

## Acceptance Criteria

- Given: DOM target plus observed parent and root posts / When: resolving / Then: `replyThreadContext` contains current target, immediate parent, root, ordered ancestors, ordered ids, and `thread_ready` diagnostics.
- Given: only same-dialog target evidence / When: resolving / Then: context contains current target and diagnostics status `same_dialog_only`.
- Given: parent reference exists but parent text is not observed / When: required parent context is requested / Then: diagnostics status is `blocked_missing_required_parent`.
- Given: observed graph contains a cycle / When: resolving / Then: resolver stops, emits diagnostics, and does not hang.
- Given: DOM target text conflicts with stored text / When: resolving / Then: current DOM target wins for the active composer.

## Edge Cases

- Target status id missing.
- Root present without parent.
- Parent present without root.
- Previous own reply with missing parent text.
- More than the bounded ancestor count.

## Pipeline Log
