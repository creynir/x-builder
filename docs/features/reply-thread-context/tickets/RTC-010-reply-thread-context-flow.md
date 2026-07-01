---
status: todo
---

# RTC-010: [E2E] Reply Thread Context Flow

## User Flows to Verify

- Given: a reply composer with observed same-dialog target and recorded GraphQL root/parent evidence / When: the user analyzes or generates a reply / Then: the prompt path receives resolved `replyThreadContext` and the UI can show complete diagnostics.
- Given: a reply composer with only same-dialog target evidence / When: analyze completes / Then: UI shows missing parent/root diagnostics and no root/parent text is invented.
- Given: a context-required generation path with missing parent context / When: the user triggers it / Then: generation fails closed and the composer text is unchanged.
- Given: a normal post composer beginning with `@handle` / When: generation runs / Then: no reply thread diagnostics appear and normal behavior is unchanged.

## Architectural Invariants

- Test fixtures are local and checked in.
- No live x.com navigation, profile navigation, thread navigation, scrolling fallback, or synthetic GraphQL request is used.
- Observed GraphQL evidence enters through the existing response observer path.
- Non-own root/parent evidence is not stored in the canonical own-post corpus.
- Generated/applied reply text remains body-only and respects the structural prefix split/merge behavior.

## Modules Under Test

- Overlay compose cockpit flow.
- Runner GraphQL observer and transport harness.
- Engine observed-thread storage and resolver.
- Engine prompt consumer path.
- Shared schemas for request/response/error contracts.

## Pipeline Log
