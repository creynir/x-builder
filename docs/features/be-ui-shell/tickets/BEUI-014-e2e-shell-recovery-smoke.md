# BEUI-014: [E2E] Shell Recovery Smoke

## Goal

Add Playwright smoke coverage for the shell's critical user paths and recovery promises.

## In Scope

- App opens at `/` and resolves to Writer.
- Sidebar navigation reaches Writer, Voice, Post Library, and Settings.
- Top Status Bar is visible.
- Route placeholders are not blank.
- Writer input is preserved across a simulated backend failure.
- Settings is reachable from recovery.
- No blank screen during backend unavailable state.
- Browser QA checkpoint for App Shell density, Settings layout, and Route Error Banner placement.

## Out Of Scope

- Full visual regression suite.
- Real Codex CLI.
- Full Post Library or Voice feature flows.

## Acceptance Criteria

- Given the app is opened at `/`, then Writer heading appears inside the shell.
- Given the user clicks each nav item, then the URL and active route update.
- Given backend failure is simulated for generation, then the typed idea remains and recovery actions are visible.
- Given Open Settings is clicked from recovery, then Settings renders without auto-return.
- Given Voice and Library are opened, then useful placeholder copy is visible.

## Test Strategy

- Suite: Playwright in `e2e-tests`.
- Fixture strategy: controlled test server/API stubbing according to existing E2E conventions; no real user config.
- Dependency category: local dev/test process only.

## Dependencies

- BEUI-008.
- BEUI-009.
- BEUI-010.
- BEUI-011.
- BEUI-012.
