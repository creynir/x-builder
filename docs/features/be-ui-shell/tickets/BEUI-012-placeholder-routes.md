# BEUI-012: [FE] Voice And Post Library Placeholder Routes

## Goal

Implement shell-owned Voice and Post Library placeholder routes without implying their full feature workflows exist.

## In Scope

- `/voice` placeholder route.
- `/library` placeholder route.
- Active nav state.
- Honest placeholder copy.
- Primary Back to Writer action on both placeholders.
- No backend data query from either placeholder.

## Out Of Scope

- Voice extraction.
- Voice profile editing.
- Post import.
- Known posts table.
- Storage-backed library rows.

## Acceptance Criteria

- Given `/voice` is opened, then Voice placeholder renders and Voice nav is active.
- Given `/library` is opened, then Post Library placeholder renders and Library nav is active.
- Given backend is unavailable, then placeholders still render.
- Given Voice placeholder primary action is clicked, then it navigates to Writer.
- Given Post Library placeholder primary action is clicked, then it navigates to Writer.
- Given screen reader reads placeholder content, then it is not announced as an error or empty data query.

## Contract Decision

Both placeholder primary actions go Back to Writer for this epic.

- Voice primary action: `Back to Writer`.
- Post Library primary action: `Back to Writer`.

Do not require an Open Settings action for placeholder routes. A Settings action can be added later only if storage/readiness context is already visible in the route.

## Test Strategy

- Suite: client Vitest route integration tests.
- Fixture strategy: route harness with status ready and unavailable states.
- Dependency category: in-process only.

## Dependencies

- BEUI-006.
- BEUI-008.
- BEUI-007.
