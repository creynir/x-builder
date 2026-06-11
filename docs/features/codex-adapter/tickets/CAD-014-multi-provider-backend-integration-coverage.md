---
status: todo
---

# CAD-014: [INT] Multi-Provider Backend Contract Integration Coverage

## User Flows to Verify

- Given a running server with all three providers registered and a fake process runner / When `PATCH /settings` selects each provider in turn and a draft is judged / Then the judge request routes to that provider's distinct argv shape (codex `exec --output-schema` form; claude `-p --json-schema --tools ""` form; cursor `-p --mode ask --sandbox enabled` form with `stdin: ""`).
- Given a provider selection change via `PATCH /settings` / When `GET /status` is called next, without an engine restart / Then the `llm` slot reflects the newly selected provider's probe and label.
- Given a settings file that fails to load / When a draft is judged and status is checked / Then both paths fall back to the codex provider end-to-end.
- Given each provider failure mode through the fake runner (timeout, nonzero exit, oversized output, malformed stdout, schema-mismatch output) / When a draft is judged / Then the failure-code → HTTP mapping holds per provider (retryable → 503 after the bounded retry; non-retryable → 500) with the generalized judge copy and no stdout/stderr leakage in details.

## Architectural Invariants

Each must be falsifiable — a facade implementation must fail the test:

1. **Registry completeness**: every value of the shared provider-id enum has a registry entry with both a provider factory and a readiness spec. (This invariant supersedes the temporal "unshipped provider" ACs in CAD-007/CAD-008 once all providers land.)
2. **Read-only argv**: no provider's built argv contains write- or shell-granting flags; the cursor argv always contains `--mode ask` and `--sandbox enabled`; the claude argv always contains `--tools ""`; the codex argv always contains `--sandbox read-only`.
3. **No secret/output leakage**: no `details` payload on any failure path contains stdout, stderr, or environment variable values.
4. **Version-only readiness**: the readiness path never invokes any CLI subcommand other than `--version` (in particular, never the cursor auth/status subcommands).
5. **Label single-source**: every readiness label and registry `judgeLabel` is sourced from the shared catalog — no engine-declared label strings.
6. **Model flag iff configured**: for each provider, the built argv contains the model flag (`-m` for codex, `--model` for claude/cursor) if and only if a non-empty model is configured for that provider in settings; with no configured model, no model flag is emitted and the provider runs its default.

## Modules Under Test

Settings repository ↔ provider resolver ↔ `JudgeDraftService` ↔ `StructuredLlmService` ↔ all three providers (fake process runner — CLIs are true external and never spawn in CI) ↔ HTTP handlers via Fastify inject; readiness dispatch (`SelectedJudgeReadinessProbe`, `CliReadinessProbe`, registry) ↔ `GET /status`. Fixtures: the per-provider stdout fixture sets created in CAD-010/CAD-011; temp-root settings repositories.

## Pipeline Log

- 2026-06-11 — Created by arch-recon (multi-provider epic extension; validated APPROVE_WITH_CONCERNS, cycle 2).
