# LJ-004: [INT/E2E] Judge Validation And E2E

## Goal

Prove the judge works end to end and degrades gracefully, with an integration test
across the client api boundary and an e2e screenshot of the verdict panel.

## In Scope

- An integration test exercising client `judgeDraft` against the engine route with
  an injected fake provider (happy path + `judge_failed`).
- An e2e check (Playwright) that, with the engine running and a deterministic fake
  or real verdict, the "Judge draft" button produces a rendered verdict panel; plus
  a screenshot artifact.
- An e2e/UX assertion that the button is disabled (with hint) when Codex readiness
  is not `ready`.

## Out Of Scope

- Load/perf testing of codex exec.
- Real codex CLI availability in CI (gate on readiness; fake the provider where
  the real CLI is absent).

## Requirements

- The happy-path integration test must assert the verdict fields end to end.
- The unavailable-path test must assert the button is disabled and no request is
  sent.
- No draft text or process internals appear in any error surface.

## Acceptance Criteria

- Integration: a valid draft yields a rendered verdict; a provider failure yields a
  visible `judge_failed` message with retry.
- E2E: screenshot shows the verdict panel populated; a second state shows the
  disabled button + hint when Codex is unavailable.

## Test Strategy

- Suites: client integration Vitest + e2e Playwright.
- Fixture strategy: inject fake judge provider through `buildServer` options for
  deterministic verdicts.
- Dependency category: in-process fakes for integration; real engine + faked
  provider for e2e.

## Dependencies

- LJ-001, LJ-002, LJ-003.
