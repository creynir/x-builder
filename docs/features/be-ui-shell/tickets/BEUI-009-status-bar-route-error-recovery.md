# BEUI-009: [FE] Status Bar And Route Error Recovery

## Goal

Implement Top Status Bar, status refresh behavior, Route Error Boundary, and Route Error Banner.

## In Scope

- `TopStatusBar`.
- `useAppStatus`.
- status refresh with stale previous value.
- retry and Settings actions.
- polite live region for status changes.
- `RouteErrorBoundary`.
- `RouteErrorBanner` using `Alert`.
- assertive announcement for blocking route errors.

## Out Of Scope

- Backend `/status` implementation.
- Settings form implementation.
- Full toast system beyond needed recovery feedback.

## Acceptance Criteria

- Given `/status` returns ready, then status labels show ready states with text.
- Given `/status` returns partial, then the route remains interactive and Settings action is available.
- Given status refresh is pending, then the prior status remains visible with refresh feedback.
- Given a route throws, then Route Error Banner appears and Sidebar Nav remains usable.
- Given Retry succeeds, then the banner clears.
- Given a field validation error occurs, then it is not promoted to a route banner.

## Test Strategy

- Suite: client Vitest with mocked API client.
- Fixture strategy: ready, partial, unavailable, invalid response, and route-throw fixtures.
- Dependency category: local mocks; no live engine.

## Dependencies

- BEUI-005.
- BEUI-007.
- BEUI-008.
