---
status: todo
---

# RTC-001: [RFR] Pin Existing Same-Dialog Reply Behavior

## Implementation Details

Add or tighten characterization tests for the current same-dialog reply behavior before any thread-context fields are introduced. Pin the current `ReplyComposerContext`, draft split/merge, prompt framing, and 24-method transport boundary.

## Data Models

No data model changes.

## Integration Point

User entry point: opening an X reply composer and using the existing compose cockpit actions.

Existing module consumers: `AnchorLayer`, `ComposeCockpit`, `formatReplyContextPromptBlock`, and `ENGINE_TRANSPORT_BINDINGS`.

Terminal outcome: same-dialog reply payloads and normal post payloads behave exactly as they do before thread-context work starts.

## Scope Boundaries / Out of Scope

In scope:

- Characterization tests for current same-dialog reply behavior.
- Characterization tests for normal post behavior with leading handles.
- Transport binding-count and no-reply-binding invariants.

Out of scope:

- New schemas.
- New storage.
- Thread context.
- UI diagnostics.
- LLM prompt changes beyond pinning current output.

## Refactor Scope

No production refactor is required. Test-only organization changes may touch existing reply-context test helpers if needed.

## Behavior-Preservation Invariants

- Valid same-dialog reply target evidence produces the existing `replyContext` shape.
- Outside-dialog tweet evidence does not produce reply mode.
- Same-dialog target evidence without required status/text evidence withholds `replyContext`.
- Authored body text is sent without the structural target handle.
- Structural target handle is re-merged only when still present at action time.
- User-deleted leading handle wins.
- Normal post mode keeps leading `@handle` text as authored text.
- `ENGINE_TRANSPORT_BINDINGS` stays at the current method count and has no reply-context resolver binding.

## Test Strategy & Fixture Ownership

Coverage level: characterization/unit and integration tests.

Owning suites: shared schema tests, overlay reply-context tests, compose cockpit tests, engine reply-context prompt tests, runner transport binding tests.

Fixture strategy: reuse existing X-shaped compose fixtures and fake transport helpers.

Dependency category: in-process only.

Isolation boundary: jsdom/browser-mode overlay tests and in-process fake transport.

## Definition of Done

- Current same-dialog reply behavior is pinned before new thread fields are added.
- Current normal post behavior is pinned before new thread fields are added.
- Transport method count and absence of a reply-context binding are pinned.

## Acceptance Criteria

- Given: a valid same-dialog reply target / When: analyze, judge, generate, or apply runs / Then: the existing `replyContext` flows with authored body text only.
- Given: a normal composer beginning with `@alice` / When: generation runs / Then: no `replyContext` or thread context is sent.
- Given: the user deletes the structural target handle / When: generated or applied text is written / Then: the deleted handle is not restored.
- Given: an outside-dialog tweet article / When: the compose context is computed / Then: reply mode is not inferred.
- Given: transport bindings are inspected / When: tests run / Then: no new reply-thread resolver binding exists.

## Edge Cases

- Prefix-only reply body.
- Nested quote text inside the same dialog.
- Missing status URL.
- User-deleted leading handle.
- Normal post with leading mention.

## Pipeline Log
