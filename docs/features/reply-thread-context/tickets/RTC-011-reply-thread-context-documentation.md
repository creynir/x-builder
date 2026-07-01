---
status: todo
---

# RTC-011: [DOC] Reply Thread Context Documentation

## Goal

Update the local feature documentation so the shipped behavior, contract names, and boundaries match the implementation.

## Changes

Target pages:

- `docs/features/reply-thread-context/README.md`
- `docs/features/reply-thread-context/tickets/README.md`

Diataxis quadrant: Explanation plus Reference.

Document:

- What the user sees in complete, partial, and blocked reply-thread diagnostics.
- Canonical contract names: `replyThreadDomEvidence`, `replyThreadContext`, `replyThreadContextDiagnostics`, `reply_context_incomplete`.
- Observed-only data sources: same-dialog DOM, passive GraphQL, local archive/live evidence.
- Boundaries: no autonomous browsing, no profile/thread navigation fallback, no invented parent/root text, no normal post-generation behavior changes.
- Fail-closed behavior for context-required parent context.
- That all thread text is treated as untrusted prompt input.

## Verification

- Documentation uses only canonical contract names.
- Documentation matches the final ticketed implementation.
- Documentation includes the issue/PR closure requirement that the PR body must include `Closes #5`.

## Pipeline Log
