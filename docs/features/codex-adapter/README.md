---
status: done
---

# Codex Adapter

Purpose: wrap CLI coding agents as engine-internal LLM providers behind one provider-neutral contract. First slice (CAD-001..006, shipped): `codex exec`. Extension (CAD-007..016): Claude Code CLI and Cursor CLI providers with settings-based selection.

## Architecture Context

Three layers, all engine-internal (no public raw LLM HTTP API):

1. **Provider-neutral contract** — `LlmProvider` (open string id) implementations registered into one `StructuredLlmService` (provider map, request validation, bounded retry ≤2 on retryable failures only, provider-result envelope validation, caller-parser re-run, `boundSafeDetails` output hygiene). The judge consumes it through the narrow `JudgeLlmGateway` view; the judge response's `model` field carries the provider id.
2. **Hardened process boundary** — `NodeProcessRunner`: `shell: false`, per-provider env allowlists (base list in the runner as fallback; provider lists in provider modules — CAD-009), startup-resolved workspace root as cwd, SIGTERM→SIGKILL→forced-settle termination, independent stdout/stderr byte caps, 60s default / 180s max timeout. Request payloads cannot choose provider, cwd, env, or argv.
3. **Per-provider modules** — each is a `CommandBuilder` + `OutputParser` + failure mapper + env allowlist + registry entry:
   - **Codex**: `exec --ephemeral --sandbox read-only --output-schema <tmpfile>`, prompt via stdin, strict single-JSON-object parser.
   - **Claude**: `-p --output-format json --json-schema <inline> --system-prompt <instructions> --tools "" --no-session-persistence --setting-sources ""` (never `--bare` — it breaks OAuth/keychain auth), envelope-tolerant parser, 100KB inline-arg guard.
   - **Cursor**: `-p --output-format json --mode ask --sandbox enabled --trust --workspace <root>` with the shared `buildStructuredPromptEnvelope` (no system-prompt/schema flags exist), always `stdin: ""` (open-pipe hang vector), lenient multi-tier output extraction.

**Selection**: the `judgeProvider` setting (shared enum, default `codex-cli`) read per-call by `createSettingsJudgeProviderResolver` (any failure → codex). `judgeProviderRegistry` is the single per-provider wiring point (provider factory + readiness spec + label); adding a provider = one module + one registry entry + one enum value.

**Readiness**: `SelectedJudgeReadinessProbe` (resolver → registry → workspace root → `CliReadinessProbe`) fills the single `llm` status slot for the **selected** provider only. Version-only probes for all providers (uniform semantics; "ready" ≠ authenticated); `overall: partial` means "the thing you configured isn't usable". The dead `LlmProvider.checkReadiness` surface is deleted.

**Labels**: single source `judgeProviderLabels` in shared ("Codex judge" / "Claude judge" / "Cursor judge") — consumed by the engine registry, the Settings select, and the verdict attribution ("Judged by …").

**Client**: provider select in Settings (native select, third model-driven field kind); one "Judge" status badge (4 badges total, label server-owned); judge panel renamed "Draft Judge" with per-verdict provider attribution from the response `model`; `judgeReady` gate derived from `status.llm.state` only. Copy must never match the e2e banned-jargon regex (`codex exec|raw llm|llm judge|judge retry|retry judge`).

## API Endpoints

- `GET /status` — `codex` slot renamed `llm`; reflects the selected provider; selected-provider `overall` semantics.
- `GET /settings` / `PATCH /settings` — gains `judgeProvider` (closed enum, 400 on invalid); `codexCommandLabel` and `runCodexJudgeAfterGeneration` removed.
- `POST /drafts/judge` — request unchanged (no provider field); response `model` = selected provider id; failure copy "The judge could not score this draft. Try again." (503 retryable / 500 not).

## Component Breakdown

`judgeProviderRegistry` (wiring point) · `createSettingsJudgeProviderResolver` (per-call selection, codex fallback) · `JudgeDraftService` (ctor accepts id or resolver thunk) · `CliReadinessProbe` / `SelectedJudgeReadinessProbe` (replace `CodexReadinessProbe`) · `ClaudeCliProvider` / `CursorCliProvider` (+ existing `CodexCliProvider`) · `buildStructuredPromptEnvelope` (shared by codex + cursor) · client: `renderSelectField` (settings), `JudgePanel` ("Draft Judge" + attribution), `judgeReady` threading.

## Dependencies

- CLIs (true external, never spawned in CI): codex ≥0.139, Claude Code CLI ≥2.1, Cursor CLI (`cursor-agent`) 2026.06+. All verified working headless on this machine.
- Trust note: selecting Claude or Cursor sends judged drafts to those third-party services (user's explicit choice via the setting); `ANTHROPIC_API_KEY` / `CURSOR_API_KEY` flow through per-provider env allowlists.
- Upstream epics: llm-judge (LJ-001..005) consumes the boundary unchanged; be-ui-shell settings/status patterns are extended, not replaced.

## Sub-Tickets Overview

Shipped: CAD-001 contract · CAD-002 process boundary · CAD-003 codex provider · CAD-004 readiness probe · CAD-005 [INT] backend coverage · CAD-006 [E2E] shell readiness smoke.

Extension, in build order: CAD-007 [FND] selection contract + resolver (+ dead-field removal, label catalog) · CAD-008 [FND] readiness/status generalization (`llm` slot, `judgeReady` rename) · CAD-009 [RFR] env-allowlist relocation · CAD-010 Claude provider · CAD-011 Cursor provider · CAD-012 Settings provider select · CAD-013 judge surface neutral naming + attribution · CAD-014 [INT] multi-provider backend coverage · CAD-015 [E2E] provider switch + judge flow · CAD-016 [DOC] how-to + epic notes.
