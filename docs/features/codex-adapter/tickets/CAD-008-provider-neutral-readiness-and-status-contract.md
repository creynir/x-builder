---
status: done
---

# CAD-008: [FND] Provider-Neutral Readiness and Status Contract

## Implementation Details

1. Shared: rename `appStatusSchema.codex` → `llm` (the slot reflects the **selected** provider; `subsystemStatusSchema` untouched — its `details` stays primitive-only, and per-provider details fit flat keys).
2. Engine: introduce `ProviderReadinessSpec` and `CliReadinessProbe` — a parameterized generalization of `CodexReadinessProbe` with identical behavior for the codex spec: `<command> --version` through the process runner, env allowlist `["PATH"]`, 750ms timeout, 512-byte output caps, the no-leak version regex, 80-char version cap, identical details keys (`adapter`, `command`, `commandAvailable`, `sandbox`, `executionTimeoutMs`, `version?`).
3. Engine: extend `judgeProviderRegistry` entries with `judgeLabel` (derived `judgeProviderLabels[id]` — the engine declares no label strings) and `readiness: ProviderReadinessSpec`; populate for codex: `{ command: "codex", adapter: "codex-cli", label: judgeProviderLabels["codex-cli"], sandbox: "read-only" }`.
4. Engine: add `SelectedJudgeReadinessProbe` — per check: resolver → registry lookup (missing entry → `unavailable`, message "Judge provider is not available in this build.", label "Judge") → workspace-root check (label from the registry `judgeLabel`) → `CliReadinessProbe`.
5. Engine: rename `ReadinessDependencies.codex` → `llm`; parameterize `unresolvedWorkspaceRootStatus(label)`; set the probe timeout/crash fallback label `probeLabels.llm = "Judge"` (provider-agnostic, and deliberately not "LLM judge" — that phrase is banned by the e2e jargon regex and the status bar renders on the settings route); `overallFromSubsystems` keeps positional semantics with the `llm` slot — **selected-provider semantics**: the user-visible `partial` badge answers "can I use what I configured", not "are all three CLIs installed".
6. Engine: delete the dead readiness surface — `LlmProvider.checkReadiness`, `LlmProviderReadiness`, and the `checkReadiness` stub on `CodexCliProvider` (zero call sites since CAD-001); update engine package re-exports (the probe module now exports `CliReadinessProbe` / `ProviderReadinessSpec`).
7. Client — absorbed shell rename, one shot to the final name: `codexReady` → **`judgeReady`** across all production occurrences (10 in the app shell module, 11 in the writer page module, plus test fixtures — repo-wide typecheck forces completeness); thread `status.llm` in place of `status.codex` (the single derivation site in the app shell, plus `statusItems` and `readinessItems`); the checking-state placeholder label "Codex judge" → "Judge". Badge text continues to derive from `status.llm.label` — the client status path hardcodes no provider names. No copy/UX changes beyond these renames and the placeholder.
8. E2E: rename fixture keys `codex:` → `llm:` across all three specs. Keep these edits minimal-mechanical — the CAD-015 parameterized fixture builder replaces these literals later, so do not restructure them here. Default-flow badge assertions ("Codex judge ready"/"unavailable") remain valid because the codex spec emits the same label.

## Data Models

`ProviderReadinessSpec { command, adapter: JudgeProviderId, label, sandbox }`; registry entries gain `judgeLabel: string` and `readiness: ProviderReadinessSpec`; shared `appStatusSchema.llm` (rename only).

## Integration Point

`GET /status` → `DefaultReadinessService` → `ReadinessDependencies.llm` → `SelectedJudgeReadinessProbe`. User entry: app boot status check, status-bar refresh, settings Test readiness. Terminal outcome: the status badge reads "<Provider> judge ready/unavailable" for the selected provider; default users see the identical "Codex judge ready" badge.

## Scope Boundaries / Out of Scope

- May change: shared `appStatusSchema` + tests; engine probe/registry/server readiness modules + package exports + tests; `CodexCliProvider` only to delete `checkReadiness`; the client **only** for the `judgeReady` rename, `status.llm` threading, and the checking placeholder; e2e specs only for fixture key renames and the two new edge ACs.
- Out of scope, zero trace: new providers, auth probes, probing non-selected providers, `cursor-agent status`/`about` anywhere, per-provider readiness rows in the UI, client copy changes ("Codex Judge" headings move in CAD-013), env-allowlist relocation (CAD-009).

## Test Strategy & Fixture Ownership

- Unit: the probe suite re-pointed at `CliReadinessProbe` with the codex spec (fake process runner, in-process), asserting byte-identical details/labels; `SelectedJudgeReadinessProbe` unit tests with fake resolver/registry/runner (selected dispatch, missing-entry, unresolved-root label). The missing-entry AC pins to an injected registry lacking the id — the CAD-014 registry-completeness invariant supersedes it once all providers ship.
- Contract: engine status suite via Fastify inject — `llm` key shape, selected-provider `overall` semantics, timeout fallback label.
- Shared shell suite: `llm` key present, `codex` key absent.
- Client unit: status-bar/app-shell/route-error-recovery suites — mechanical fixture renames plus the edge cases below; settings readiness fixtures follow the key (the readiness row keeps its existing order: engine, storage, judge slot third, deterministic).
- E2E: fixture key renames only (route-fulfilled stubs); no real CLI.

## Definition of Done

Zero production occurrences of `status.codex` or `codexReady`; `checkReadiness` absent from the provider contract and engine exports; the default-settings `/status` response is identical except the slot key name; full repo typecheck, unit, and e2e suites green.

## Acceptance Criteria

- Given default settings and codex available, When `GET /status`, Then `llm.state` is `ready` with label "Codex judge" and details identical to the pre-change `codex` slot.
- Given a selected provider id absent from an injected registry, When `GET /status`, Then `llm` is `unavailable` with "Judge provider is not available in this build." and `overall` is `partial`.
- Given an unresolvable workspace root, When `GET /status`, Then the `llm` slot label is the selected provider's catalog label and details include `reason: "workspace_root_unresolved"`.
- Given a hanging probe, When `GET /status`, Then within 750ms the `llm` slot is `unavailable` with label "Judge" and the timeout message.
- Given a status fixture whose `llm.label` is a novel string (e.g. "Quorum judge"), When the shell renders, Then the badge shows that label verbatim (no client-side provider-name mapping).
- Given a status fixture whose `llm.state` is a value with no explicit badge mapping, When the badge renders, Then it falls through to the `uncertain` variant, `judgeReady` is false, the judge surface is gated, and nothing crashes.
- Given status still loading (snapshot null, phase checking), When placeholders render, Then the judge placeholder reads exactly "Judge checking" — never "Codex judge", never "LLM judge".
- Given the selected provider's slot unavailable with a message, When the bar renders, Then danger badge + inline message + the "Open Settings" affordance, and the Writer route remains usable with deterministic scoring intact.
- Given a settings save or Test readiness publishes a refreshed status, When `publish` fires, Then the badge and the `judgeReady` gate update without a page reload.
- Given `judgeReady` is false, When the writer page renders, Then the judge button is disabled — gate semantics byte-identical to the pre-rename behavior.

## Edge Cases

Resolver failure during a status check → codex default probed normally. Registry entry present but binary missing → `process_failed` → `unavailable` with `commandAvailable: false`. Version string matching the no-leak regex → dropped, slot still ready. Status null + phase unavailable/invalid → existing single-badge paths unchanged (no judge item). A refresh superseded mid-flight → the existing `isActive` guard drops the stale result (no badge flicker to a stale provider label).

## Pipeline Log

- 2026-06-11 — Created by arch-recon (multi-provider epic extension; validated APPROVE_WITH_CONCERNS, cycle 2).
- 2026-06-11 — RGB pipeline DONE (rgb-tdd): Red tests `0bb09f6` → Blue(Red) APPROVE → Green impl `ee0a47d` → Blue(Green)+Yellow APPROVE → [FND] architecture checkpoint APPROVE. New `CliReadinessProbe`+`ProviderReadinessSpec` (parameterized; byte-identical for codex) and `SelectedJudgeReadinessProbe` (resolver→registry→workspace→probe); `appStatusSchema.codex→llm`; registry entries gain `judgeLabel`+`readiness`; `LlmProvider.checkReadiness`/`LlmProviderReadiness`/`CodexReadinessProbe` deleted; client `codexReady→judgeReady` (10+11) + `status.llm` threading + "Judge checking" placeholder. Suites green (shared 43 / engine 243 / client 155), typecheck+lint clean.
  - Mid-ticket: Green's impl surfaced 2 stale fixtures Red missed renaming + 1 `as const` on a new test; Red fixed them in `61c2b75` (the Green baseline), keeping Green's commit source-only — firewall preserved.
  - Note (non-blocking, not a concern): `CliReadinessProbe` templates the *unavailable*-path message on `spec.command`, so failure copy reads lowercase "codex version check…" vs the old "Codex…". Ready-state details byte-identical; no test/UI depends on failure-message casing. Carry to post-epic triage as optional polish.
- 2026-06-12 — **NOTE RESOLVED** (user chose fix-now at triage): `CliReadinessProbe` now capitalizes the command in its unavailable-path messages via `capitalize(spec.command)` (`e31fed7`) → "Codex/Claude/Cursor-agent version check timed out./failed." / "… command is not available." Engine suite 344/344 green (verified no test asserted the prior lowercase text — the `status.test.ts` "Codex …" string is a fake-probe fixture input, not an assertion on this probe).
