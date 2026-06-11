---
status: todo
---

# CAD-011: Cursor CLI Provider

## Implementation Details

1. Add `CursorCliProvider` (`id: "cursor-cli"`) mirroring the codex provider's internal structure: `CursorCommandBuilder`, `CursorCliOutputParser`, module-local failure mapper ("Cursor CLI request timed out." etc.; `request_timeout` retryable).
2. Invocation shape (binary `cursor-agent`):
   `-p --output-format json --mode ask --sandbox enabled --trust --workspace <workspace root> <prompt envelope>`
   `--mode ask` over `plan` (Q&A-shaped — closest to a judge; plan mode emits planning structure that fights JSON-only output), with `--sandbox enabled` as defense-in-depth because plain print mode has full write/shell tool access. `--trust` prevents workspace-trust prompts (a headless hang vector).
3. The Cursor CLI has **no system-prompt flag and no schema flag**, so the prompt envelope reuses the codex prompt shape: extract the codex prompt-building helper into a shared engine module as `buildStructuredPromptEnvelope` (instructions + role-tagged turns + structured-output restatement + inline JSON Schema) and have both providers consume it — codex behavior unchanged, asserted by a codex prompt snapshot in this ticket. The envelope passes as the final positional arg with the same 100 KB `unsafe_request` guard as the Claude provider.
4. **Always pass `stdin: ""`** in the run options — verified: the process runner leaves the child's stdin pipe open when the stdin option is undefined, a real hang vector for `cursor-agent`; an empty string closes the pipe. This is a hard acceptance criterion, with the runner's SIGTERM→SIGKILL termination path as backstop.
5. `CursorCliOutputParser` is the lenient tier: (1) whole stdout parses to an envelope object → extract the first present of `result` | `text` | `response` | `content` (object as-is; string → fence-strip → parse); (2) whole stdout parses directly to the schema-shaped object → use it; (3) fallback: scan the (already byte-bounded) stdout for the **last** balanced top-level `{...}` JSON object; (4) else `invalid_provider_response` (no JSON object found). Captured note: the real envelope carries the payload as a **JSON string in `result`** — tier 1, first candidate, string branch. Honor `is_error`/non-success `subtype` as `provider_reported_error` before extraction, mirroring the Claude parser.
6. Add `cursorCliProcessEnvAllowlist` = base list plus `CURSOR_API_KEY` in the provider module.
6a. Model flag: when `options.model` is present (sourced from the `cursorModel` setting via CAD-007's per-call resolution), the builder appends `--model <value>`; when absent, no model flag (provider default). Live-verified: `cursor-agent --list-models` returns the valid catalog (`auto`, `gpt-5.3-codex`, `gpt-5.2`, …) — model names differ from Codex/Claude, documented in CAD-016.
7. Register in `judgeProviderRegistry`: `judgeLabel` from the shared catalog, readiness spec `{ command: "cursor-agent", adapter: "cursor-cli", label: judgeProviderLabels["cursor-cli"], sandbox: "ask-mode" }`.
8. Create the `cursor-cli` fixture set (envelope success, direct schema-shaped stdout, prose-wrapped JSON, fenced string, no-JSON output, empty stdout) mirroring the codex fixture conventions.

**Captured reality (live verification completed 2026-06-11 on cursor-agent 2026.06.11 — fixtures MUST encode these envelopes, not guesses):**
- (a) Envelope: `{ type: "result", subtype: "success", is_error: false, duration_ms, duration_api_ms, result: "<JSON-as-string>", session_id, request_id, usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } }` — the payload is a JSON **string** in `result` (note camelCase usage keys, unlike Claude's snake_case).
- (b) The full designed argv `-p --output-format json --mode ask --sandbox enabled --trust --workspace <root>` runs cleanly in print mode (success envelope).
- (c) Latency: ~7–9s `duration_ms` (~18s wall including CLI startup) — comfortably inside the 60s generation budget.
- (d) Auth under the strict allowlist verified: succeeds with only `PATH+HOME+TMPDIR` (file-based `~/.cursor` config; no extra env vars required).

## Data Models

No shared schema changes. Provider-internal: builder options, parser tier union, the env allowlist constant. Shared engine helper: `buildStructuredPromptEnvelope`.

## Integration Point

The registry entry makes it reachable end-to-end: persisted `judgeProvider: "cursor-cli"` → `POST /drafts/judge` runs the Cursor CLI, response `model: "cursor-cli"`; `GET /status` probes `cursor-agent --version` with label "Cursor judge". User entry: the Settings provider select (CAD-012) or a settings PATCH; the writer judge button.

## Scope Boundaries / Out of Scope

Zero trace: **never invoke `cursor-agent status` or `cursor-agent about` anywhere in the readiness path** (the auth probe is a multi-second network round-trip that cannot fit the 750ms status window — version-only readiness is an architectural invariant asserted in CAD-014); no streaming (`--stream-partial-output` unused); no plain print mode without the ask+sandbox flags; no model-string validation (a bad name fails at judge time). (The `--model` flag IS in scope — driven by `options.model`, per CAD-007's plumbing.)

## Test Strategy & Fixture Ownership

- Unit (engine llm suite): fake process runner — the CLI is **true external**, never spawned in CI; fixtures under the new `cursor-cli` fixture dir; builder tests assert the exact argv vector AND that run options contain `stdin: ""`; envelope-extraction tests per tier; codex prompt snapshot asserts the extracted `buildStructuredPromptEnvelope` changed nothing for codex.
- Contract: judge route via Fastify inject with the provider registered and a fake runner.
- Readiness: probe unit test with the cursor spec (fake runner).
- Manual smoke: the verification steps above as ticket verification steps, not CI tests.

## Definition of Done

Provider + parser + builder + allowlist + registry entry + shared prompt-envelope helper implemented; codex prompt snapshot green; fixtures encode captured envelopes; verification steps executed and recorded in the Pipeline Log; unit/contract suites green; repo typecheck/lint/test/test:e2e green.

## Acceptance Criteria

- Given `judgeProvider: "cursor-cli"` and a fake runner returning the envelope fixture, When a draft is judged, Then a 200 verdict with `model: "cursor-cli"`.
- Given prose-wrapped JSON stdout, Then the last-balanced-object scan succeeds.
- Given output with no JSON anywhere, Then `invalid_provider_response` → generic judge_failed copy.
- Given the builder output, Then the argv contains `--mode ask`, `--sandbox enabled`, `--trust`, `--workspace <root>` and the run options contain `stdin: ""`.
- Given `options.model` is set, Then the argv contains `--model <value>`; given it is absent, Then no `--model` flag appears.
- Given a runner hang, Then the SIGTERM/SIGKILL termination path yields a retryable `request_timeout`.
- Given `judgeProvider: "cursor-cli"`, When `GET /status`, Then `cursor-agent --version` is probed and the slot label is "Cursor judge" — and no auth-status command is ever invoked.
- Given a codex judge request before and after this ticket, Then the codex prompt envelope is byte-identical (snapshot).

## Edge Cases

Envelope field names drifting on a future CLI build (tier-2 direct parse and tier-3 scan are the safety net; fixtures pinned to the captured 2026.06.11 envelope); multi-second latency (captured ~7–9s, within the 60s bound; surfaced as retryable timeout beyond it); untrusted-workspace prompt risk (suppressed by `--trust`, backstopped by the terminator).

## Pipeline Log

- 2026-06-11 — Created by arch-recon (multi-provider epic extension; validated APPROVE_WITH_CONCERNS, cycle 2).
- 2026-06-11 — Verification steps executed live (cursor-agent 2026.06.11): envelope captured (`result` JSON-string, camelCase usage keys); full designed argv verified in print mode; latency ~7–9s; auth works under the base env allowlist with no extra vars. Fixtures must encode the captured envelope.
