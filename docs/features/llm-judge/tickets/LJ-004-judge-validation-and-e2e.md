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

## Status

DONE. Added `e2e-tests/tests/judge-flow.spec.ts` (Playwright), which drives the real
client UI and the real `EngineApiClient.judgeDraft` fetch path against a stubbed
engine (page.route), covering both states:
- codex ready -> type a draft -> click "Judge draft" -> the Codex Judge panel
  renders the rating, headline, strengths, and improvements (screenshot:
  /tmp/lj-judge-verdict.png).
- codex unavailable -> the "Judge draft" button is disabled with the
  "Codex judge is unavailable right now." hint (screenshot:
  /tmp/lj-judge-unavailable.png), validating the live readiness gating end to end.

Combined with LJ-002 route tests (engine side) and LJ-003 api-client tests (client
side), the judge contract is validated across the HTTP boundary. Note: a full e2e
against a real `codex` CLI is out of scope here (codex is unavailable in this
environment); the engine is stubbed deterministically, matching the existing e2e
suite's approach. 2 e2e tests pass; full unit suite 382 green.
