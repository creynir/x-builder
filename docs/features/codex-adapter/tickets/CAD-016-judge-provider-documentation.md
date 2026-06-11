---
status: todo
---

# CAD-016: [DOC] Judge Provider Documentation

## Goal

Document the multi-provider judge for users of the app: how to choose a provider, what each provider requires, and how to read the readiness signals. User-facing task documentation gets a new `docs/how-to/` area — the `docs/features/` tree holds pipeline artifacts (specs, tickets), not user docs.

## Content

**Primary (new page): `docs/how-to/choose-judge-provider.md`** — Diataxis How-To. Covers:
- Changing the "Judge provider" select on the Settings page (save, then Test readiness).
- What each provider requires installed and authenticated: Codex CLI (`codex login`), Claude Code CLI (keychain/OAuth sign-in, or `ANTHROPIC_API_KEY` — reflect the CAD-010 keychain smoke outcome), Cursor CLI (`CURSOR_API_KEY` or `cursor-agent` login).
- What the status badge means per provider ("<Provider> judge ready/unavailable"), and the `partial` overall badge when the selected provider is unavailable.
- Readiness is binary-presence only ("ready" means the CLI is installed and responsive, not that auth is valid) — auth failures surface when judging, as retryable errors.
- The privacy note: the judge sends the draft to the selected provider's service; choosing Claude or Cursor sends drafts to those third parties, same trust class as Codex.
- What happens to judge requests when the provider is unavailable (button disabled, hint, recovery via Settings).
- **Choosing a model per provider** (the optional model fields): "Leave empty to use the provider's default." Model names differ per CLI and must match that CLI's catalog — Codex uses the `gpt-5.x-codex` family (and `-m`); Claude accepts aliases like `haiku`/`sonnet`/`opus` or full Anthropic ids (`--model`, honored — verified); Cursor uses its own catalog from `cursor-agent --list-models` (e.g. `auto`, `gpt-5.3-codex`). An invalid model name is not validated in-app — the CLI rejects it at judge time and it surfaces as the standard judge error (non-retryable).

**Secondary (update): the tickets build-order index README of this feature** — Diataxis Reference — extend with CAD-007..016 and update the epic notes: the provider-neutral boundary now has three CLI providers; selection is settings-only (request payloads cannot choose a provider); version-only readiness with selected-provider status semantics; the two Codex-era settings fields were retired (prior-epic docs that mention them are historical records and stay unedited).

## Integration Point

Reachable from the repo root docs tree; the How-To names the exact Settings field and status badges users see. Consumes the shipped CAD-007..015 behavior — written last so it documents reality.

## Scope Boundaries / Out of Scope

No code changes. No edits to archival feature docs from prior epics. No API reference for the engine-internal provider contract (engine-internal boundary stays undocumented for end users by design).

## Definition of Done

Both pages written; commands and field names verified against the shipped implementation; copy consistent with the shared label catalog ("Codex judge", "Claude judge", "Cursor judge").

## Acceptance Criteria

- Given a user with none of the CLIs installed, When they follow the How-To for their chosen provider, Then they reach a "ready" badge and a successful judged draft.
- Given the shipped Settings page, When the How-To names fields and badges, Then every name matches the UI verbatim.

## Pipeline Log

- 2026-06-11 — Created by arch-recon (multi-provider epic extension; validated APPROVE_WITH_CONCERNS, cycle 2).
