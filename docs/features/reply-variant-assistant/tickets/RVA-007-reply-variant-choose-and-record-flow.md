---
status: done
---

# RVA-007: Reply Variant Choose And Record Flow

## Implementation Details

Implement the interactive reply assistant flow.

Required behavior:

- Generate button calls `generateReplyVariants({ replyContext, currentAuthoredBody: latest.bodyText })`.
- Generation success fills a 3-4 item variant chooser and does not auto-write or auto-select.
- Each variant has a real "Use this" action.
- Choosing a variant re-reads the latest live composer split, strips duplicate target handle from the chosen body, preserves user-deleted target handle state, writes only the authored body into the native composer, and returns focus to the composer.
- After write, call `recordGeneratedReply` with chosen variant metadata and generated body/written text.
- Ledger failure shows a non-blocking warning after composer write.
- x-builder never clicks X's Reply/Post button.

## Data Models

Consumes:

- `GenerateReplyVariantsRequest`
- `GenerateReplyVariantsResponse`
- `RecordGeneratedReplyRequest`
- `RecordGeneratedReplyResponse`
- Existing `ReplyComposerContext`

## Integration Point

User entry point: reply assistant pin in an X reply composer.

Existing module consumer: overlay transport and `writeIntoComposer` consume the selected variant and current split state.

Terminal outcome: the selected generated reply body is written to the native X composer for user editing, and generated content is recorded for future exclusion.

## Scope Boundaries / Out of Scope

In scope: generate/loading/error states, variant chooser, native composer write, ledger status, focus return.

Out of scope: route/service implementation, storage implementation, normal post cockpit changes, auto-posting, judge/reach/Post Coach/apply-all, generated reply promotion.

Zero trace: no automatic write on generation success and no X Reply/Post click.

## Test Strategy & Fixture Ownership

Coverage level: overlay component/integration tests with fake transport.

Fixture ownership: existing X reply composer fixtures and fake transport payload builders for reply variants and ledger responses.

Isolation boundary: fake transport and local DOM fixtures only; no real engine or live X.

## Definition of Done

- Reply users can generate, choose, edit, and see ledger status.
- Duplicate target handles are not written.
- User-deleted target handle is respected.
- Stale generation responses are ignored after composer/dialog changes.
- Ledger failure is visible and non-blocking.

## Acceptance Criteria

- Given: a reply composer with authored body text / When: Generate replies is clicked / Then: `generateReplyVariants` receives `currentAuthoredBody` equal to the split authored body.
- Given: variants return / When: generation completes / Then: native composer text is unchanged until the user chooses one.
- Given: a variant body starts with `@alice` / When: the user chooses it for an `@alice` reply / Then: the composer contains only one structural target handle.
- Given: the user deleted the structural handle before choosing / When: the user chooses a variant / Then: the handle is not restored.
- Given: ledger recording fails / When: composer write succeeds / Then: the selected text stays in the composer and the UI shows a warning.
- Given: reply mode is active / When: a variant is chosen / Then: X's Reply/Post button is not clicked.

## Visual AC

- Loading uses stable skeleton/disabled button affordance.
- Variants are button rows with wrapping text and accessible names.
- Ledger status uses `Badge` or `Alert` and `aria-live`.

## Edge Cases

- User closes composer while generation is pending.
- User edits composer after generation but before choosing.
- LLM returns warnings/grounding notes.
- Variant list contains 4 items.

## Pipeline Log

- 2026-07-01: Implemented generate, choose, native composer write, focus, and non-blocking ledger recording flow.
