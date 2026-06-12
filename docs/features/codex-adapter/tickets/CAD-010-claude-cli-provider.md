---
status: done
---

# CAD-010: Claude CLI Provider

## Implementation Details

1. Add `ClaudeCliProvider` (`id: "claude-cli"`) mirroring the codex provider's internal structure: a `ClaudeCommandBuilder`, a `ClaudeCliOutputParser`, and a module-local failure mapper with fixed safe message strings ("Claude CLI request timed out." etc.; `request_timeout` retryable).
2. Invocation shape (binary `claude`, cwd = the startup-resolved workspace root):
   `-p --output-format json --json-schema <inline serialized structured-output schema> --system-prompt <request instructions> --tools "" --no-session-persistence --setting-sources ""`
   The conversation turns ride stdin as the role-tagged block only — no schema restatement in the prompt, since schema enforcement is native via `--json-schema`.
3. **Do NOT use `--bare`**: it restricts auth to `ANTHROPIC_API_KEY` only and breaks OAuth/keychain users (verified against the live CLI). Isolation is composed from `--setting-sources ""` + `--no-session-persistence` + `--tools ""` instead. `--bare` must have zero trace.
3a. Model flag: when `options.model` is present (sourced from the `claudeModel` setting via CAD-007's per-call resolution), the builder appends `--model <value>`; when absent, no model flag (provider default). Live-verified: `--model haiku` is honored (the result envelope's `modelUsage` reports the resolved model).
4. Inline-arg guard: if the serialized schema plus instructions exceed 100,000 bytes, fail fast with `unsafe_request` ("Claude CLI cannot accept a structured output request this large.", non-retryable) before any spawn. (Linux `MAX_ARG_STRLEN` is 128 KiB per arg; 100 KB is a safe deterministic bound; judge payloads are ~2 KB.)
5. `ClaudeCliOutputParser` tolerates the print-mode envelope: trim → `empty_stdout`; `JSON.parse` → `invalid_json`; an envelope object with `is_error: true` or a non-success subtype → `provider_reported_error`; extract the result candidate in order `structured_output` (object) → `result` (object as-is; string → trim, strip a single ```json fence pair, parse) → `missing_result`; a non-object final value → `result_not_object`. Map `usage.input_tokens` / `usage.output_tokens` into the structured usage type when present. Captured note: when `--json-schema` is used, `result` can be an empty string while `structured_output` carries the object — the candidate order above handles this.
6. Add `claudeCliProcessEnvAllowlist` = base list plus `ANTHROPIC_API_KEY` **and `USER`** (captured: macOS keychain OAuth fails with only PATH/HOME/TMPDIR — "Not logged in" — and succeeds once `USER` is present) in the provider module.
7. Register in `judgeProviderRegistry`: `judgeLabel` from the shared catalog, readiness spec `{ command: "claude", adapter: "claude-cli", label: judgeProviderLabels["claude-cli"], sandbox: "tools-disabled" }`.
8. Create the `claude-cli` test fixture set (success envelope, error envelope, string result, fenced result, missing result, empty stdout) mirroring the codex fixture conventions.

**Captured reality (live verification completed 2026-06-11 on claude 2.1.111 — fixtures MUST encode these envelopes, not guesses):**
- (a) Result-bearing field under `--json-schema`: **`structured_output`** (object), inside the envelope `{ type: "result", subtype: "success", is_error: false, result: "", num_turns, session_id, usage: { input_tokens, output_tokens, ... }, modelUsage, permission_denials: [], ... }`. The `result` field was an empty string in the structured-output capture.
- (b) `--json-schema` is **inline-only**: a file-path argument does not error fast — it hangs indefinitely (killed after 3+ minutes; the inline form completes in ~5s). The temp-file contingency is dead: stay inline and keep the 100 KB arg guard. A file-path value must have zero trace in the builder.
- (c) `--tools ""` verified: no tool execution occurs (`num_turns: 1`, empty `permission_denials`; the model may emit tool-like prose in `result`, which is harmless because `structured_output` enforcement applies).
- (d) Keychain smoke resolved: auth **fails** under `PATH+HOME+TMPDIR` ("Not logged in") and **succeeds** with `USER` added — hence `USER` in the allowlist (step 6). `--setting-sources ""` + `--no-session-persistence` + `--tools ""` ran cleanly throughout. `ANTHROPIC_API_KEY` remains the documented alternative auth path (CAD-016).

## Data Models

No shared schema changes. Provider-internal: command-builder options, parser result union, the env allowlist constant.

## Integration Point

The registry entry makes it reachable end-to-end: persisted `judgeProvider: "claude-cli"` → `POST /drafts/judge` runs the Claude CLI and the response carries `model: "claude-cli"`; `GET /status` probes `claude --version` with label "Claude judge". User entry: the Settings provider select (CAD-012) or a settings PATCH; the writer judge button.

## Scope Boundaries / Out of Scope

Zero trace: no `--effort`/`--fallback-model` flags, no model-string validation (a bad name fails at judge time as `nonzero_exit`), no cursor work, no client changes, no auth-status probing in `/status`, no `--bare`. (The `--model` flag IS in scope — driven by `options.model`, per CAD-007's plumbing.)

## Test Strategy & Fixture Ownership

- Unit (engine llm suite): fake process runner — the CLI is **true external** and is never spawned in CI; checked-in stdout fixtures under the new `claude-cli` fixture dir; command-builder tests assert the exact argv vector and the stdin turn block; arg-guard test asserts no spawn occurs over the bound; parser tests cover every fixture.
- Contract: judge route via Fastify inject with the provider registered and a fake runner (failure-code → HTTP mapping).
- Readiness: probe unit test with the claude spec (fake runner).
- Manual smoke (true external, local opt-in only): the verification commands above, recorded as ticket verification steps — not CI tests.

## Definition of Done

Provider + parser + builder + allowlist + registry entry implemented; fixtures encode captured envelopes; all four verification steps executed and their outcomes recorded in the Pipeline Log; unit/contract suites green; repo typecheck/lint/test/test:e2e green.

## Acceptance Criteria

- Given `judgeProvider: "claude-cli"` and a fake runner returning the success-envelope fixture, When a draft is judged, Then a 200 verdict with `model: "claude-cli"`.
- Given an envelope with `is_error: true`, Then `invalid_provider_response` → generic judge_failed copy.
- Given a string `result` wrapped in a json fence, Then it parses successfully.
- Given schema + instructions over 100 KB, Then `unsafe_request` with no spawn.
- Given a runner timeout, Then one bounded retry, then 503 retryable.
- Given `judgeProvider: "claude-cli"`, When `GET /status`, Then `claude --version` is probed and the slot label is "Claude judge".
- Given the command builder output, Then the argv contains `--tools ""`, `--no-session-persistence`, `--setting-sources ""` and does not contain `--bare` or any file-path `--json-schema` value.
- Given `options.model` is set, Then the argv contains `--model <value>`; given it is absent, Then no `--model` flag appears.
- Given the provider's env allowlist, Then it contains `USER` (keychain requirement) and `ANTHROPIC_API_KEY` on top of the base list.

## Edge Cases

Stderr-only output (stdout empty → `empty_stdout`); usage fields absent (usage omitted, success still returned); `result` empty string alongside a populated `structured_output` (captured normal case); version string matching the no-leak regex in the probe (dropped, ready preserved).

## Pipeline Log

- 2026-06-11 — Created by arch-recon (multi-provider epic extension; validated APPROVE_WITH_CONCERNS, cycle 2).
- 2026-06-11 — Verification steps executed live (claude 2.1.111): envelope captured (`structured_output` field); `--json-schema` inline-only (file path hangs — contingency removed); `--tools ""` confirmed no-execution; keychain requires `USER` in the env allowlist (added to spec). Fixtures must encode the captured envelope.
- 2026-06-12 — RGB pipeline DONE (rgb-tdd): Red tests `2bb382c` → Blue(Red) REJECT (unit fixtures vs route fixtures contract collision: provider-unit tests parsed judge-shaped fixtures against a `{draft,confidence}` contract — 4 unsatisfiable-at-Green cases) → Red fix (decoupled draft-shaped unit fixtures from captured judge-shaped route fixtures) → Blue(Red) APPROVE → Green impl `003bade` → gates.py all clean → Blue(Green)+Yellow APPROVE. New `ClaudeCliProvider`+`ClaudeCommandBuilder`+`ClaudeCliOutputParser`; `claude -p --output-format json --json-schema <inline> --system-prompt <instr> --tools "" --no-session-persistence --setting-sources ""` (no `--bare`, no file-path schema), `--model` iff configured, 100KB inline-arg guard, envelope-tolerant parser (`structured_output`→`result`→fence-strip), `claudeCliProcessEnvAllowlist = base + ANTHROPIC_API_KEY + USER`, registry entry (readiness `{command:"claude",sandbox:"tools-disabled"}`, label from shared catalog). Engine suite 281/281, typecheck+lint clean; failure `details` leak nothing (sentinel-verified). 1 rejection cycle (Red station) + 1 infra retry (first Red agent hit an org spend limit; restarted clean). Fixtures encode the live-captured envelopes (verification recorded above); CLIs never spawned in CI.
