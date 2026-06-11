---
status: done
---

# CAD-009: [RFR] Relocate Provider Env Allowlists Out of the Neutral Process Runner

## Refactor Scope

- The process runner module: `defaultProcessEnvAllowlist` → `baseProcessEnvAllowlist` (`PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `SSL_CERT_FILE`) as the fallback applied when a caller omits `envAllowlist`.
- The codex provider module: new `codexCliProcessEnvAllowlist` = base list plus `CODEX_HOME`, `CODEX_SQLITE_HOME`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`, `CODEX_CA_CERTIFICATE`, `RUST_LOG` — the same effective set the codex provider passes today — and the provider's run call switched to it explicitly.
- Engine package re-exports for the renamed/new constants.
- Direct importers and their tests.

Everything outside this list is untouchable — in particular the spawn/termination/output-bounding logic in the runner, the readiness probes, and the server wiring.

## Behavior-Preservation Invariants

- The effective child environment variable set for a codex generation run is identical before and after.
- The readiness probe's env allowlist stays exactly `["PATH"]`.
- `/status` and `/drafts/judge` responses are byte-identical for the same inputs.
- No runner caller without an explicit `envAllowlist` exists before or after (verified at design time: the codex provider and the readiness probe both pass explicit lists; nothing relies on the runner's fallback).

## Implementation Details

Rename and narrow the runner's fallback constant to the provider-agnostic base list; declare the codex-specific list in the codex provider module composed from the base; update imports/exports. Rationale: the neutral process boundary must not default to one provider's environment variables — CAD-010/011 add `claudeCliProcessEnvAllowlist` and `cursorCliProcessEnvAllowlist` beside it in their own modules.

## Data Models

Two exported `readonly string[]` constants (`baseProcessEnvAllowlist`, `codexCliProcessEnvAllowlist`). No schema changes.

## Integration Point

Internal: the runner's env construction and the codex provider's run options. User entry and terminal outcomes are unchanged judge/status flows — that is the point.

## Scope Boundaries / Out of Scope

Zero trace: no new providers, no allowlist entries for Claude/Cursor (those land with their providers), no behavior change of any kind, no runner logic edits beyond the constant rename.

## Test Strategy & Fixture Ownership

This ticket does not author a test plan — the characterization pipeline derives pinning tests from the Behavior-Preservation Invariants above (coverage inventory → pinning tests for gaps; all must pass before and after).

## Definition of Done

Constants relocated and renamed; repo-wide typecheck and full suite green; pinning tests pass unchanged before and after the restructuring.

## Acceptance Criteria

- Given a codex generation request, When the provider invokes the runner, Then the child env contains exactly the same variable set as before this change.
- Given a readiness probe run, When the runner builds the child env, Then only `PATH` passes through.
- Given any caller that omits `envAllowlist`, When the runner builds the child env, Then the base list applies — and no such caller exists in the codebase.

## Edge Cases

A future caller omitting `envAllowlist` gets the narrow base list rather than codex variables — intended hardening, preserved by the fallback semantics.

## Pipeline Log

- 2026-06-11 — Created by arch-recon (multi-provider epic extension; validated APPROVE_WITH_CONCERNS, cycle 2).
- 2026-06-11 — RGB [RFR] pipeline DONE (rgb-tdd): Red-RFR pinning `a233435` → Blue(RFR pinning) REJECT (2 survivability couplings: a pre-existing fallback-content test + an order-coupled codex assertion; Blue empirically simulated the refactor to prove both go red) → Red-RFR fix `561cc2d` (mechanic pinned via explicit allowlist; codex pin → set-membership) → Blue(RFR pinning) APPROVE (re-simulated: all green post-refactor) → pre-Green pinning gate 246/246 → Green refactor `d7fbcc4` → post-Green gates (pinning 246/246, no test files in station, gates.py all clean) → Blue(Green, RFR lane)+Yellow(facade) APPROVE. `defaultProcessEnvAllowlist` → narrowed `baseProcessEnvAllowlist` (6 names); new `codexCliProcessEnvAllowlist` (= base + 6 codex vars, same 12-name effective set) in the codex provider module; no compat re-export; readiness probe `["PATH"]` and `/status`+`/drafts/judge` untouched. 1 rejection cycle (pinning station). Enables per-provider allowlists for CAD-010/011.
