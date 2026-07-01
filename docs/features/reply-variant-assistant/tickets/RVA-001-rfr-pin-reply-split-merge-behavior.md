---
status: done
---

# RVA-001: [RFR] Pin Reply Split/Merge Behavior

## Implementation Details

Characterize the existing reply split/merge behavior around `ComposeCockpit`, `ReplyDraftSplit`, `writeIntoComposer`, and the compose context produced by `AnchorLayer`. Extracting small helpers is allowed only if behavior stays identical and the helpers remain consumed by the current cockpit path.

Required invariants:

- Authored reply body excludes X's structural leading `@target` handle.
- Duplicate generated target handles are stripped before composer write.
- The live composer split is re-read immediately before a programmatic write.
- A user-deleted target handle is never restored.
- Normal post mode treats a leading `@handle` as authored text when no `replyContext` exists.
- Partial same-dialog reply evidence does not fabricate `replyContext`.

## Data Models

No schema or storage changes.

## Integration Point

User entry point: opening an X reply composer or normal post composer with the overlay active.

Existing module consumer: `ComposeCockpit` consumes compose context and writes generated/applied text into the native X composer.

Terminal outcome: current reply split/merge behavior is pinned by tests before the reply assistant branch replaces reply generation.

## Scope Boundaries / Out of Scope

In scope: behavior-preserving test coverage and, only if needed, a behavior-preserving helper extraction.

Out of scope: new UI, new transport methods, new routes, generated reply ledger, reply variant generation, LLM prompt changes, and any change to normal post cockpit behavior.

Zero trace: no placeholder reply assistant components or schemas in this ticket.

## Refactor Scope

Allowed symbols/modules are the current compose split/merge logic around `ComposeCockpit`, the compose testing fixtures, and overlay tests that exercise reply composer behavior.

## Behavior-Preservation Invariants

- Existing post generation still calls the post generation path in normal post mode.
- Existing reply generation behavior remains unchanged in this ticket, even if later tickets replace it.
- No X Reply/Post button is clicked by the cockpit.
- Existing reply body analysis/judge/apply calls continue to receive authored body text only.

## Test Strategy & Fixture Ownership

Coverage level: overlay component/integration tests in the overlay workspace.

Fixture ownership: reuse X-shaped compose fixtures and fake transport helpers. Add focused cases to the current compose cockpit test suite rather than introducing a new browser harness.

Isolation boundary: fake transport and local DOM fixtures only; no live X, no real engine, no user profile.

## Definition of Done

- Characterization tests pass and fail against an intentional split/merge regression.
- Existing overlay compose cockpit tests still pass.
- No product behavior changes are introduced.

## Acceptance Criteria

- Given: a reply composer with `@alice ` structural prefix / When: a generated body starts with `@alice` / Then: only one target handle appears after write.
- Given: a reply composer where the user deleted `@alice` / When: generated or applied body is written / Then: the target handle is not restored.
- Given: a normal post composer containing `@alice hello` / When: analyze, judge, generate, or apply runs / Then: `@alice hello` is treated as authored post text and no `replyContext` is sent.
- Given: partial same-dialog reply evidence / When: compose context is produced / Then: no fake `replyContext` is sent downstream.

## Visual AC

No UI changes.

## Edge Cases

- Prefix-only reply body.
- Duplicate generated handle with mixed case.
- Composer text changes between generation request and write.

## Pipeline Log

- 2026-07-01: Implemented split/merge helper extraction and characterization coverage; overlay compose suite passed.
