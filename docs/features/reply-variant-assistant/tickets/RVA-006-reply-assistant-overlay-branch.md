---
status: done
---

# RVA-006: Reply Assistant Overlay Branch

## Implementation Details

Branch `ComposeCockpit` early when `replyContext` exists so reply mode mounts a dedicated reply assistant shell and avoids legacy post cockpit side effects.

Required behavior:

- No `ComposeGenerateRail` in reply mode.
- No `StaticEngineColumn`, reach estimate, or Post Coach in reply mode.
- No `JudgeStrip`, judge annotations/highlights, or apply-all in reply mode.
- No feedback prediction recording in reply mode.
- No background analyze/judge/generate/apply effects from the legacy post cockpit branch.
- Normal post mode remains unchanged.

This ticket may add `ActiveReplyCockpit`, `ReplyAssistantAssembly`, and `ReplyAssistantPin` shell components with context summary and disabled/empty generate area, but it should not implement full variant choose/write yet.

## Data Models

Consumes existing `ReplyComposerContext` plus shared reply variant contracts from RVA-002 where needed for prop typing.

No new storage.

## Integration Point

User entry point: opening an X reply composer with valid `replyContext`.

Existing module consumer: `ComposeCockpit` chooses between normal post cockpit and reply assistant branch.

Terminal outcome: reply users see the reply assistant shell instead of post scoring/generation surfaces; post users keep the existing cockpit.

## Scope Boundaries / Out of Scope

In scope: overlay branch, reply assistant shell, context summary, forbidden legacy surface absence tests.

Out of scope: route/service implementation, ledger recording, variant choose/write flow, full generated result rendering, storage, and transport binding work beyond consuming already-defined transport types.

Zero trace: no hidden legacy side effects in reply mode.

## Test Strategy & Fixture Ownership

Coverage level: overlay component/integration tests.

Fixture ownership: existing X reply/post compose fixtures and fake transport. Tests should spy on forbidden transport methods.

Isolation boundary: fake transport and local DOM fixtures only.

## Definition of Done

- Reply mode renders reply assistant shell and context summary.
- Reply mode does not render legacy post cockpit surfaces.
- Reply mode does not call legacy background analyze/judge/generate/apply/feedback methods.
- Normal post mode still renders current cockpit and passes existing tests.

## Acceptance Criteria

- Given: a valid reply composer / When: `ComposeCockpit` mounts / Then: the reply assistant shell appears.
- Given: reply mode is active / When: the overlay settles / Then: category rail, reach estimate, Post Coach, judge strip, apply-all, and feedback recording controls are absent.
- Given: reply mode is active / When: fake transport spies are inspected / Then: `generateIdeas`, `judgeDraft`, `applyJudgeSuggestions`, and `recordFeedbackPrediction` are not called by the reply branch.
- Given: normal post mode / When: `ComposeCockpit` mounts / Then: the existing post cockpit path still renders and behaves as before.

## Visual AC

- Use existing v2 primitives and token names only.
- Dense overlay panel; no nested cards; long context wraps.
- Reply assistant `aside` has an accessible label.

## Edge Cases

- Confirmation/discard sheet still suppresses all cockpit UI.
- Reply context is present but thread diagnostics are partial.
- Very long target text wraps without widening the pin.

## Pipeline Log

- 2026-07-01: Implemented reply-mode cockpit branch that hides legacy post/judge/apply/category surfaces.
