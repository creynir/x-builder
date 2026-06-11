---
status: todo
---

# CAD-007: [FND] Judge Provider Selection Contract and Resolver

## Implementation Details

1. Shared schema: add `judgeProviderIdSchema` (`z.enum(["codex-cli", "claude-cli", "cursor-cli"])`), `judgeProviderLabels` (a `Record<JudgeProviderId, string>` — `"codex-cli"` → `"Codex judge"`, `"claude-cli"` → `"Claude judge"`, `"cursor-cli"` → `"Cursor judge"`; `Record` over the closed enum makes omission of a future id a compile error), and `appSettingsSchema.judgeProvider` (default `"codex-cli"`). Add three optional per-provider model fields `codexModel`, `claudeModel`, `cursorModel` (flat top-level keys — empty/absent means "use the provider's default model"). Delete `codexCommandLabel` and `runCodexJudgeAfterGeneration` entirely — no rename, no successor field.
2. Engine: update `JsonFileAppSettingsRepository` defaults to the new field set (remove the two dead literals; `judgeProvider` fills via schema default).
3. Engine: add `judgeProviderRegistry` with the single codex entry `{ id: "codex-cli", createProvider }`. The `judgeLabel` and `readiness` entry fields arrive in CAD-008 — keep the entry minimal here.
4. Engine: add `createSettingsJudgeProviderResolver(repository)` returning `() => Promise<JudgeProviderId>`. Reads `repository.load()` per call (no caching — a settings PATCH takes effect on the very next judge call); any failure of any kind returns `"codex-cli"`; never throws.
5. Engine: widen the second `JudgeDraftService` constructor parameter to `string | (() => string | Promise<string>)` (default `"codex-cli"` retained — existing string-passing tests stay valid); `judge()` resolves it per call before calling `generateStructured`.
6. Engine — model plumbing: add an optional `model?: string` to `StructuredLlmExecutionOptions` (the request `options` bag, alongside `timeoutMs`/`outputByteLimit`/`attempts`). It is **optional with no default** — an absent model must normalize to `undefined`, never a default value, so the "no flag = today's argv" invariant holds. `JudgeDraftService.judge()` reads the active provider's configured model from the same per-call settings load (resolver) and sets `options.model` when non-empty; each provider's `CommandBuilder` reads `options.model`.
7. Engine — codex builder model flag (shipped-code touch owned by this ticket, NOT the CAD-009 [RFR]): `CodexCommandBuilder.build` appends `-m <model>` **only when `options.model` is present**. When absent, the produced argv is byte-identical to today's. (Claude/Cursor builders consume `options.model` in CAD-010/011, where those builders are created fresh.)
8. Engine: `createDefaultJudgeDraftService` instantiates providers from `judgeProviderRegistry` and passes the settings-backed resolver; `buildServer` constructs one shared `JsonFileAppSettingsRepository` consumed by both the settings routes and the resolver.
9. Engine: generalize the `judgeFailedError` message to "The judge could not score this draft. Try again." (the 503-retryable / 500-non-retryable mapping is unchanged).
10. Client — atomic dead-field removal end-to-end (this ticket owns every trace of the two removed fields): remove the "Codex command label" field and the run-after-generation toggle from the settings route model literals, rendering, and form driver; update the client settings unit suite assertions and API-client test fixtures; update e2e settings fixtures and the shell-recovery smoke spec's dead-field expectations (the "Codex command label" visibility assertion is removed; the negative jargon-regex assertion is retained verbatim). The three new model fields are persisted by the schema here but get NO settings UI in this ticket — the model inputs are CAD-012, settable via `PATCH /settings` until then.
11. Engine/shared test fixtures referencing the removed fields are updated in this ticket (settings, settings-repository, status, engine-shared integration, shared shell suites). The full suite is green at ticket close.

No new settings UI is added here — the "Judge provider" select is CAD-012; until then `judgeProvider` is settable via `PATCH /settings` only.

## Data Models

```ts
// shared — owner: this ticket
export const judgeProviderIdSchema = z.enum(["codex-cli", "claude-cli", "cursor-cli"]);
export type JudgeProviderId = z.infer<typeof judgeProviderIdSchema>;

export const judgeProviderLabels: Record<JudgeProviderId, string> = {
  "codex-cli": "Codex judge",
  "claude-cli": "Claude judge",
  "cursor-cli": "Cursor judge",
};

export const appSettingsSchema = z.object({
  engineBaseUrl: localEngineUrlSchema,
  storagePath: storagePathSchema,
  judgeProvider: judgeProviderIdSchema.default("codex-cli"), // NEW
  codexModel: z.string().optional(),   // NEW — empty/absent = provider default model
  claudeModel: z.string().optional(),  // NEW
  cursorModel: z.string().optional(),  // NEW
  showDeterministicDetails: z.boolean().default(true),
  // codexCommandLabel: REMOVED (dead — only the settings form read it)
  // runCodexJudgeAfterGeneration: REMOVED (inert flag with no consumer)
});

// request options bag — model is OPTIONAL with NO default (normalizes to undefined)
export const structuredLlmExecutionOptionsSchema = z.object({
  timeoutMs: /* unchanged, has default */,
  outputByteLimit: /* unchanged, has default */,
  attempts: /* unchanged, has default */,
  model: z.string().min(1).optional(), // NEW — absent ⇒ provider default ⇒ no model flag
});
```

Flat per-provider model keys (shape A) — chosen over a nested `Record<JudgeProviderId, string>` because the settings UI machinery (`TextSettingsFieldName = Extract<keyof AppSettings, ...>`, `updateTextField`'s `{ ...draft, [field]: value }` top-level spread) is keyed to top-level string keys; flat keys drop into CAD-012 with zero new UI plumbing. Adding a 4th provider later is the same one-line-per-site edit as adding the enum value.

Migration safety: non-strict `z.object` strips both removed keys from persisted settings files; defaults fill `judgeProvider`; the three model keys are optional and simply absent in legacy files. Engine-internal: `JudgeProviderRegistryEntry` (minimal form `{ id, createProvider }` at this ticket), `JudgeProviderResolver = () => Promise<JudgeProviderId>`.

Contract ownership: `judgeProviderLabels` is produced here; consumers are the engine registry (`judgeLabel` derivation, from CAD-008), the client provider-select options (CAD-012), and the client verdict attribution mapping (CAD-013). The engine never declares its own label strings.

## Integration Point

- `PATCH /settings` validates and persists `judgeProvider`; `GET /settings` returns it.
- `POST /drafts/judge` → `JudgeDraftService.judge` → resolver → `StructuredLlmService` provider lookup. User entry: the judge button in the writer (existing); settings via API until CAD-012 ships the select.
- Terminal outcome: default users see byte-identical judge behavior; selecting an unshipped provider yields an honest non-retryable judge failure with the generalized copy.

## Scope Boundaries / Out of Scope

- May change: shared shell schema (incl. the three model keys + `options.model`) + tests; engine settings repository, registry/resolver modules, judge service constructor + per-call model resolution, **`CodexCommandBuilder.build` (the conditional `-m <model>` model flag)**, server wiring, judge error copy, engine tests; the client settings route + tests **only to delete the two dead fields**; e2e specs **only where they assert or fixture the two dead fields**.
- Out of scope, zero trace: new providers, the Claude/Cursor builder model flags (CAD-010/011), status/readiness changes, `appStatusSchema`, a client provider picker or model inputs or any new UX (CAD-012), per-provider labels in the engine (the catalog lives in shared; engine consumption starts in CAD-008), any successor to the removed run-after-generation flag, any app-side validation of model strings.

## Test Strategy & Fixture Ownership

- Unit: shared shell suite (enum, defaults, catalog covers every enum value with the exact three labels, removed keys stripped from legacy payloads, the three model keys parse as optional and absent in legacy files, `options.model` normalizes to `undefined` when omitted); engine settings/settings-repository suites (temp-root repositories — local-substitutable; never the real `~/.x-builder`); resolver unit tests (temp root + corrupt-file fallback); judge-draft-service suite (resolver-function path + model-resolution path with an in-process fake gateway); `CodexCommandBuilder` argv tests (asserts `-m <model>` present iff `options.model` set; byte-identical to today's argv when absent).
- Contract: engine server suites via Fastify inject (in-process).
- **Unshipped-provider ACs pin their test surface to injection**: `buildServer` accepts an injected judge draft service — assert the unshipped-provider behavior against a service whose provider set lacks the selected id, not against default wiring, so the assertion stays valid after CAD-010/011 register the real providers. The registry-completeness invariant in CAD-014 supersedes these temporal checks.
- E2E edits are deletions/fixture trims only (Playwright route-fulfilled stubs, remote-owned contract fixtures).
- No CLI is spawned anywhere in this ticket (the true-external boundary is untouched).

## Definition of Done

Shared schema exports the enum, catalog, and new field; both dead fields have zero occurrences repo-wide in code and tests (`rg "codexCommandLabel|runCodexJudgeAfterGeneration"` over `client/ engine/ shared/ e2e-tests/` → empty; archival docs are exempt); the judge resolves its provider per call via settings; default behavior is unchanged; full repo typecheck, unit, and e2e suites green.

## Acceptance Criteria

- Given default settings, When `GET /settings`, Then `judgeProvider` is `"codex-cli"` and neither removed key appears in the response.
- Given a persisted pre-epic settings file containing both old keys, When `GET /settings`, Then parsing succeeds, the old keys are absent, and `judgeProvider` defaults to `"codex-cli"`.
- Given a judge service injected with a provider set lacking the selected id, When a draft is judged with `judgeProvider: "claude-cli"` persisted, Then `judge_failed` 500 non-retryable with the message "The judge could not score this draft. Try again." (`provider_unconfigured` internally).
- Given `PATCH /settings` with `judgeProvider: "gpt-cli"`, Then 400 `validation_failed` with a field error on `judgeProvider`.
- Given an unreadable settings file, When a draft is judged, Then the codex provider id is resolved (fallback) and the request succeeds against a fake gateway.
- Given the shared catalog, When iterated over the enum options, Then every id maps to a non-empty label and the three labels are exactly "Codex judge", "Claude judge", "Cursor judge".
- Given the Settings page (e2e), When rendered, Then no "Codex command label" field exists and the negative jargon regex still matches zero elements.
- Given `codexModel` is absent (or empty), When a draft is judged with codex selected, Then the built argv contains no `-m` flag and is byte-identical to today's codex argv.
- Given `PATCH /settings` with `codexModel: "gpt-5.2-codex"`, When a draft is judged with codex selected, Then `options.model` is `"gpt-5.2-codex"` and the built argv contains `-m gpt-5.2-codex`.
- Given a judge request with no `model` in `options`, When normalized, Then `options.model` is `undefined` (no default value substituted).

## Edge Cases

Settings file present but `judgeProvider` missing (legacy) → default fills; model keys absent → no model flag. A settings PATCH body still containing removed keys (stale client) → keys stripped, 200. Resolver called concurrently (judge + readiness later) → stateless, safe. Repository load throwing non-Zod errors → resolver still returns the default. An empty-string model value is treated as absent (no flag), not as a literal empty model name.

## Pipeline Log

- 2026-06-11 — Created by arch-recon (multi-provider epic extension; validated APPROVE_WITH_CONCERNS, cycle 2).
- 2026-06-11 — Amended for per-provider model selection (validated APPROVE_WITH_CONCERNS, delta): flat `codexModel`/`claudeModel`/`cursorModel` keys + optional-no-default `options.model`; this ticket owns the codex `-m` builder touch (kept out of the CAD-009 [RFR] to preserve its byte-identical invariant). Model flags live-verified: codex `-m/--model`, claude `--model` (honored), cursor `--model` (catalog via `--list-models`).
