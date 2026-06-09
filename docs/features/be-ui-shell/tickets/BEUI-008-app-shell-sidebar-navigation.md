# BEUI-008: [FE] AppShell, Sidebar, And URL Navigation

## Goal

Replace the current root `WriterPage` render with the persistent App Shell, Sidebar Nav, route outlet, and URL-backed navigation.

## In Scope

- `AppShell`.
- `SidebarNav`.
- skip link.
- route outlet.
- route heading focus target.
- browser history navigation through owned route helpers.
- active route marker and `aria-current`.
- sidebar collapse control and accessible labels.

## Out Of Scope

- Top Status Bar data integration.
- Settings form implementation.
- Writer API integration.

## Acceptance Criteria

- Given the app opens at `/`, then Writer renders inside App Shell.
- Given the user navigates to `/settings`, then Settings route is active and Sidebar Nav remains mounted.
- Given Sidebar is collapsed, then visual labels may hide but accessible route labels remain.
- Given a route component fails, then the shell remains mounted and route outlet can show recovery.
- Given navigation completes, then focus moves to the destination route heading.

## Test Strategy

- Suite: client Vitest integration tests.
- Fixture strategy: route harness with memory/history mocking.
- Dependency category: in-process only.

## Dependencies

- BEUI-006.
- BEUI-007.
