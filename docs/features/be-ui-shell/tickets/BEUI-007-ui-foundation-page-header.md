# BEUI-007: [FND] UI Foundation And PageHeader

## Goal

Implement the minimum design-system-backed UI primitives needed by the shell, including the missing `PageHeader` convention.

## In Scope

- Implement to design-system contract: `Button`, `IconButton`, `Badge`, `Tooltip`, `Alert`, `EmptyState`, `Skeleton`, `Toast` region as needed for shell.
- `PageHeader` with exactly one `h1`, optional description, optional back action, optional actions.
- CSS tokens or classes aligned with documented design-system tokens.
- Accessible labels for icon-only controls.

## Out Of Scope

- Full design-system component library.
- CandidateCard, JudgePanel, DataTable, VoiceProfileEditor, ImportPreviewTable.
- Stage 3 mockups.

## Acceptance Criteria

- Given `PageHeader` renders, then exactly one route `h1` is present.
- Given an `IconButton` renders without visible text, then it has an accessible name and tooltip.
- Given an `Alert` renders as warning or danger, then it includes text and recovery slot support.
- Given a button is loading, then its label remains visible and busy state is exposed.
- Given shell UI is inspected in browser, then it uses documented density and avoids decorative card/landing-page treatment.

## Test Strategy

- Suite: client Vitest component tests and browser QA during implementation.
- Fixture strategy: simple component render fixtures.
- Dependency category: in-process only.

## Dependencies

- Design-system docs.
