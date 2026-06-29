---
status: in_progress
---

# RCC-002: [FND] Overlay Reply Detection And Draft Split Helpers

## Implementation Details

Extend the overlay compose context and add pure split/merge helpers without changing transport calls.

`ComposeContextValue` should expose:

```ts
type ComposeMode = "post" | "reply";

type ReplyDraftSplit = {
  mode: ComposeMode;
  authoredBody: string;
  structuralPrefix: string;
  leadingHandleState: "present" | "user_deleted";
  merge(body: string): string;
};
```

Add reply detection inside the existing `AnchorLayer` compose reconcile path:

- Detect the active composer and its containing dialog as today.
- Prefer a same-dialog target tweet/article that does not contain the composer.
- Extract target text from the centralized tweet text selector.
- Extract target status id and author handle from a same-dialog status URL where available.
- Use centralized selectors only; do not hardcode X selectors in consumers.
- Never infer reply mode from a leading `@handle` alone.
- Ordinary composers with no reply evidence remain normal compose.
- Reply-looking dialogs with insufficient target evidence must not emit `replyContext`.

Add helpers that split the live composer text into structural prefix and authored body only when a valid reply context exists. In normal mode, the full composer text is authored text.

## Data Models

Consumes `ReplyComposerContext` from shared.

Overlay-local helper output:

- `mode`: `"post"` or `"reply"`.
- `authoredBody`: text excluding the structural leading handle only in reply mode.
- `structuralPrefix`: exact current leading handle prefix when present.
- `leadingHandleState`: `"present"` or `"user_deleted"`.
- `merge(body)`: returns the full text to write into X's composer for the current prefix state.

## Integration Point

Parent producer: `AnchorLayer` owns compose detection and publishes `ComposeContextValue`.

Consumer: later `ComposeCockpit` orchestration reads `useComposeContext`.

User entry point: the user opens X's existing post or reply composer.

Terminal outcome: reply metadata and split/merge helpers are available to the cockpit, but no engine call or visible UI behavior changes in this ticket.

## Scope Boundaries / Out of Scope

In scope:

- Extend `ComposeContextValue`.
- Centralize any additional X selectors needed for reply target metadata.
- Add same-dialog reply detection.
- Add split, merge, and duplicate-leading-handle helper behavior.
- Overlay tests for detection and helpers.

Out of scope, with zero code:

- Calling transport with `replyContext`.
- Changing `ComposeCockpit` generation, judge, analyze, apply, or feedback flows.
- Engine prompt or scoring behavior.
- New visible reply UI, panels, cards, or badges.
- X network calls, profile navigation, crafted GraphQL, or fallback scraping outside the current dialog.

## Test Strategy & Fixture Ownership

Coverage level: overlay unit/browser tests for DOM detection and pure helper behavior.

Owning suite: existing overlay compose/context tests or a behavior-named overlay test beside the compose/anchor surface.

Fixture strategy: extend test-only X composer fixtures to support a same-dialog target article with status link, author handle, display name, tweet text, and seeded composer prefix.

Dependency category: in-process DOM and React context; no engine, runner, live X session, local settings, network, or persisted state.

Isolation boundary: synthetic DOM fixtures inserted and removed per test.

## Definition of Done

- `useComposeContext` exposes reply context only when same-dialog target evidence exists.
- A normal composer starting with `@alice` remains normal compose.
- Split/merge preserves exact structural prefix when present.
- User deletion of the structural prefix is represented and never auto-restored by helper logic.
- No transport request changes occur in this ticket.
- Targeted overlay tests and overlay typecheck pass for touched files.

## Acceptance Criteria

- Given a reply dialog with a target article, target text, status link, author handle, and composer seeded with `@alice `, when compose context reconciles, then `replyContext` is present and `mode` is `"reply"`.
- Given a normal compose dialog whose text begins `@alice good point`, when compose context reconciles, then `replyContext` is absent and the mode is `"post"`.
- Given a reply dialog where the target article is missing or lacks enough target evidence, when compose context reconciles, then `replyContext` is absent and reply-aware behavior cannot be triggered.
- Given reply text `@alice good point`, when split runs, then `authoredBody` is `good point` and merge returns `@alice <body>`.
- Given the user deletes the structural prefix in a detected reply dialog, when split runs, then `leadingHandleState` is `"user_deleted"` and merge returns body only.
- Given normal post mode with a leading `@alice`, when split runs, then the full text remains authored body.

## Visual AC

No visible UI changes.

## Edge Cases

- Multiple tweet-like articles in the same dialog.
- Quoted tweet nested inside the target article.
- Target article removed during SPA churn.
- Composer inactive.
- Confirmation sheet active.
- Multiple leading handles seeded by X.
- Prefix deletion followed by user typing.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
- 2026-06-29: Started RGB-TDD implementation after RCC-001 foundation approval.
