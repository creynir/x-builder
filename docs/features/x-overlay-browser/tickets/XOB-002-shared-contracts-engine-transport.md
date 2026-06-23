---
status: done
---

# XOB-002: [FND] Shared contracts — `EngineTransport` (17) + all v1 delta schemas + `deriveApproved`

## Implementation Details

Add to `@x-builder/shared` every new schema the overlay/runner/engine seam needs, the
17-method `EngineTransport` interface with its binding-name constants, and the
`deriveApproved` helper. Export all new public symbols from the package barrel
(`shared/src/index.ts`). **Contracts and the helper only — no consumer logic, no engine
wiring, no producers.** This is the foundation the entire epic (XOB-004…013 engine,
XOB-016/017 runner, XOB-018…029 overlay) consumes.

New schema modules (one Zod file each, mirroring the existing `schemas/*.ts` style —
`z.object`, explicit `.min/.max`, ISO `z.string().datetime()` for dates,
discriminated unions where a `status`/`source` tag exists):

- `schemas/x-live-capture.ts` — live-capture + capture-summary contracts.
- `schemas/cooldown.ts` — cooldown status/signal/report.
- `schemas/suggest-post.ts` — suggest-post request/response/item.
- `schemas/generate-category.ts` — dynamic generate categories.
- `schemas/apply-judge-suggestions.ts` — auto-improve request/response.
- `schemas/overlay-readiness.ts` — overlay readiness composite.
- `schemas/engine-transport.ts` — the `EngineTransport` interface + binding-name constants.

Additive edits to existing modules:

- `schemas/judge.ts` — add `judgeAnnotationSchema`; add `annotations` to
  `judgeVerdictSchema` with `.default([])`; add `deriveApproved`.
- `schemas/shell.ts` — extend `generateIdeaRequestSchema` (`idea` optional + `format?` +
  refine); extend `generatedIdeaCandidateSchema` (`verdict?`/`approved?`).
- `schemas/deterministic-analysis.ts` — add optional `cooldown?` to the internal
  `scoredPostItemSchema` (note: that const is module-internal/not exported; the edit is
  inside this module; `cooldownSignalSchema` is imported from `schemas/cooldown.ts`).

`EngineTransport` (in `engine-transport.ts`): a TypeScript `interface` whose 17 methods
take/return the `z.infer` types of the referenced schemas (all args/returns must be
structured-clone-safe plain JSON — dates as ISO strings). For **each** method, export a
`__xbuilder_<method>` binding-name **string constant** (the names the runner registers
via `page.exposeFunction` and the overlay calls as `window.__xbuilder_<method>`).
Provide them as named constants and a frozen `ENGINE_TRANSPORT_BINDINGS` record keyed by
method name → binding string, so the runner (XOB-016) iterates one source of truth.

The 17 methods + binding names (spellings are LOCKED; consumers must not drift):

| # | method | binding | request → response |
|---|---|---|---|
| 1 | `getOverlayReadiness` | `__xbuilder_getOverlayReadiness` | `()` → `OverlayReadiness` |
| 2 | `getStatus` | `__xbuilder_getStatus` | `()` → `AppStatus` |
| 3 | `getSettings` | `__xbuilder_getSettings` | `()` → `AppSettingsResponse` |
| 4 | `updateSettings` | `__xbuilder_updateSettings` | `AppSettings` → `AppSettingsResponse` |
| 5 | `validateArchive` | `__xbuilder_validateArchive` | `ArchiveTweetsValidateRequest` → `ArchiveTweetsValidateResponse` |
| 6 | `importArchive` | `__xbuilder_importArchive` | `ArchiveTweetsImportRequest` → `ArchiveTweetsImportResponse` |
| 7 | `getActiveContext` | `__xbuilder_getActiveContext` | `()` → `ActiveArchiveContext` |
| 8 | `activateContext` | `__xbuilder_activateContext` | `()` → `ArchiveContextActivationResponse` |
| 9 | `deactivateContext` | `__xbuilder_deactivateContext` | `()` → `ArchiveContextActivationResponse` |
| 10 | `analyzePosts` | `__xbuilder_analyzePosts` | `AnalyzePostsRequest` → `AnalyzePostsResponse` (items carry optional `cooldown`) |
| 11 | `judgeDraft` | `__xbuilder_judgeDraft` | `JudgeDraftRequest` → `JudgeDraftResponse` |
| 12 | `generateIdeas` | `__xbuilder_generateIdeas` | `GenerateIdeaRequest` → `GenerateIdeaResponse` |
| 13 | `suggestPost` | `__xbuilder_suggestPost` | `SuggestPostRequest` → `SuggestPostResponse` |
| 14 | `getCooldown` | `__xbuilder_getCooldown` | `(windowDays?: number)` → `CooldownReport` |
| 15 | `getCaptureSummary` | `__xbuilder_getCaptureSummary` | `()` → `CaptureSummary` |
| 16 | `getGenerateCategories` | `__xbuilder_getGenerateCategories` | `()` → `GenerateCategory[]` |
| 17 | `applyJudgeSuggestions` | `__xbuilder_applyJudgeSuggestions` | `ApplyJudgeSuggestionsRequest` → `ApplyJudgeSuggestionsResponse` |

Locked spellings (do NOT drift): `analyzePosts` (not `analyzePost`), `suggestPost`
(not `getSuggestion`), `updateSettings` (not `patchSettings`), `generateIdeas`
(not `generate`/`generateCandidates`), `getCaptureSummary`, `getOverlayReadiness`,
`getGenerateCategories`, `applyJudgeSuggestions`.

`deriveApproved` (in `judge.ts`, next to `deriveJudgeVerdict`):

```
export const deriveApproved = (verdict: JudgeVerdict): boolean =>
  verdict.verdict === "post_now" || verdict.verdict === "slight_rework";
```

Equivalent to `scores.overall >= 70` via the existing `deriveJudgeVerdict` bands
(≥85 `post_now`, ≥70 `slight_rework`). Single source of "approved" — producers and
overlay must derive identically; the overlay must NOT implement its own ≥70 threshold.

Reuse existing symbols verbatim where referenced — do **not** redefine: import
`detectedPostFormatSchema` from `deterministic-analysis.ts`; reference
`subsystemStatusSchema` from `shell.ts`; reuse `appStatusSchema`,
`appSettingsResponseSchema`, the `archiveTweets*` schemas, `judgeDraft*` schemas,
`generateIdea*` schemas — these already exist and are exported.

Export every new schema + inferred type + the `EngineTransport` interface + every
`__xbuilder_*` binding constant + `ENGINE_TRANSPORT_BINDINGS` + `deriveApproved` from
`shared/src/index.ts`, following the existing barrel's value/type split.

## Data Models

`detectedPostFormatSchema` (existing 17-value `PostFormat` enum) is reused throughout;
no new format enum. All datetimes are ISO `z.string().datetime()`.

**`x-live-capture.ts`:**

- `liveCapturedPostSchema` `{ platformPostId: str≤160, text: 1..8000, createdAt:
  datetime, kind: enum(original|reply|repost_reference|unknown), language?: str,
  replyReferences: { inReplyToPostId?, inReplyToUserId? } default {}, entityFlags:
  { hasUrls, hasMedia, hasHashtags, hasMentions: bool }, liveMetrics: { impressions?,
  likes?, reposts?, replies?, quotes?, bookmarks?: int≥0 } default {}, capturedAt: datetime }`.
- `liveCapturedProfileSchema` `{ platformUserId, screenName, followers?: int≥0, capturedAt: datetime }`.
- `captureIngestRequestSchema` `{ posts: liveCapturedPost[] .max(200) .default([]),
  profile?: liveCapturedProfile }`.
- `captureIngestResponseSchema` `{ insertedCount, updatedCount, unchangedCount,
  duplicateCount: int≥0, profileApplied: bool, corpusSize: int≥0 }`.
- `captureSummarySchema` `{ postsCaptured: int≥0, lastCaptureAt?: datetime,
  followers?: int≥0, screenName?: str≤80, profileCapturedAt?: datetime }` — the single
  source of auto-followers consumed by the overlay metric card (XOB-025).

**`cooldown.ts`:**

- `cooldownStatusSchema` = `enum(clear|warming|cooldown)`.
- `cooldownSignalSchema` `{ format: detectedPostFormatSchema, countInWindow: int≥0,
  windowDays: 1..90, lastPostedAt?: datetime, status: cooldownStatusSchema,
  message: str≤240 }`. **Canonical shape — one schema, two consumers**:
  `AnalyzePostsResponse.items[].cooldown` and `CooldownReport.signals[]` both use it.
  Field names are LOCKED: `format` (not `topic`), `countInWindow` (not `count`).
- `cooldownReportSchema` `{ windowDays: 1..90, generatedAt: datetime, corpusSource:
  enum(live|archive|merged|empty), signals: cooldownSignal[] .max(40) }`.

**`suggest-post.ts`:**

- `suggestPostRequestSchema` `{ windowDays: 1..90 default 7, excludeFormats:
  detectedPostFormat[] default [], count: 1..4 default 3 }`.
- `suggestedPostSchema` `{ id, format: detectedPostFormat, angle:
  enum(curious|caution|constructive|observational), text: 1..8000, rationale: str≤280,
  cooldownStatus: cooldownStatusSchema, sourceExamplePostIds: str[] .max(5),
  generatedBy: enum(llm|deterministic_fallback) }`.
- `suggestPostResponseSchema` `{ status: enum(ready|insufficient_corpus), suggestions:
  suggestedPost[] .max(4), cooldown: cooldownReportSchema, minimumCorpusSize: literal 10 }`.

**`generate-category.ts`:**

- `generateCategorySchema` `{ id: str≤120, label: str≤40, format:
  detectedPostFormatSchema, basis: enum(top_performer|frequent|default), cooldownStatus:
  cooldownStatusSchema, sampleCount: int≥0 }`.

**`apply-judge-suggestions.ts`:**

- `applyJudgeSuggestionsRequestSchema` `{ text: trim 1..8000 }`.
- `applyJudgeSuggestionsResponseSchema` `{ text: 1..8000 (improved OR original per the
  never-worse guard), verdict: judgeVerdictSchema (of the RETURNED text), approved: bool
  (= deriveApproved(verdict)), improvedOverOriginal: bool }`.

**`overlay-readiness.ts`:**

- `captureReadinessStateSchema` = `enum(ok|paused|layout_changed)`.
- `overlayReadinessSchema` `{ staticEngine: subsystemStatusSchema (from shell.ts),
  llm: subsystemStatusSchema, capture: { state: captureReadinessStateSchema, label:
  str≤80, message?: str≤240, lastCaptureAt?: datetime, checkedAt: datetime } }`.

**Additive edits (must preserve legacy parse — see Test Strategy):**

- `judgeAnnotationSchema` `{ quote: str 1..280 (exact substring), severity:
  enum(suggestion|warning), recommendation: str 1..240 }`.
- `judgeVerdictSchema` += `annotations: z.array(judgeAnnotationSchema).max(12).default([])`.
  `.default([])` is the compatibility mechanism — a legacy verdict object without an
  `annotations` field parses to `annotations: []`.
- `generateIdeaRequestSchema`: `idea` → `z.string().trim().min(1).max(4000).optional()`;
  add `format: detectedPostFormatSchema.optional()`; add
  `.refine((v) => v.idea !== undefined || v.format !== undefined, ...)` so at least one
  is present. `voiceProfileId`/`useKnownPostIds` unchanged.
- `generatedIdeaCandidateSchema`: += `verdict: judgeVerdictSchema.optional()`
  (present when refine succeeded) + `approved: z.boolean().optional()` (absent when
  unjudged). `format` (`one-liner|mini-framework|debate-question`) and arity
  (`generateIdeaResponseSchema` `.length(3)`) UNCHANGED.
- internal `scoredPostItemSchema` (in `deterministic-analysis.ts`): +=
  `cooldown: cooldownSignalSchema.optional()`. `analyzedPostItemSchema`/
  `analyzePostsResponseSchema` shapes otherwise unchanged.

## Integration Point

Reached by importing `@x-builder/shared`. Consumed by: the engine producers
(XOB-004…013) that return these response shapes; the runner (XOB-016 binds every
`__xbuilder_*` constant; XOB-017 produces `OverlayReadiness`); the overlay
(XOB-018…029 `useTransport()` calls the methods by name). Terminal outcome: a single
typed seam — `EngineTransport` + the referenced Zod schemas + `deriveApproved` — that
runner (`ExposeFunctionTransport`) and the future `FetchEngineTransport` both implement,
and the overlay consumes verbatim.

## Scope Boundaries / Out of Scope

- **May change:** the seven new `schemas/*.ts` files; the three additive edits
  (`judge.ts`, `shell.ts`, `deterministic-analysis.ts`); `shared/src/index.ts` exports.
- **Excluded:** any engine service, route, runner, or overlay code. No change to
  `apiErrorSchema` (existing codes `generation_failed`/`library_storage_failed` are
  reused by later tickets; no new error code or scope is added here).
- **ZERO-TRACE:** no `LiveCaptureService`/`RepetitionWindowService`/`SuggestPostService`/
  `GenerateCategoryService`/`GenerateIdeasService`/`ApplyJudgeSuggestionsService`/
  `LiveContextResolver` implementations; no `ExposeFunctionTransport`/
  `FetchEngineTransport` class; no Fastify route; no judge-prompt change; no
  `post-library-repository` change (that is XOB-003). `EngineTransport` ships as an
  interface with **no implementation**. The internal `scoredPostItemSchema` edit adds
  only the optional field — it does not compute or attach a cooldown.

## Test Strategy & Fixture Ownership

- **Coverage level:** unit (Zod round-trip + reject) — mirror the existing
  `deterministic-analyze`/schema test convention in `@x-builder/shared`.
- **Owning suite/workspace:** `@x-builder/shared` (`vitest run`); new `*.test.ts`
  colocated with the new schema files per the package's existing layout.
- **Fixture/helper strategy:** inline literal objects per schema (valid + malformed
  variants) and inline literal **legacy** objects (a pre-annotations `JudgeVerdict`, a
  pre-cooldown `AnalyzePostsResponse` item, an idea-only `GenerateIdeaRequest`).
- **Dependency category:** in-process (pure schema/library code; zero I/O).
- **Isolation boundary:** none needed — no filesystem, network, or process; pure
  in-memory parsing.

Required cases:
- Valid `CaptureIngestRequest`/`CaptureIngestResponse`, `CaptureSummary`,
  `CooldownReport`/`CooldownSignal`, `SuggestPostRequest`/`SuggestPostResponse`,
  `GenerateCategory`, `ApplyJudgeSuggestionsRequest`/`Response`, `OverlayReadiness`,
  `judgeAnnotation` all round-trip (`parse(x)` deep-equals `x` modulo applied defaults).
- Malformed variants reject (e.g. `cooldownSignal` with `count` instead of
  `countInWindow`; `quote` > 280; `windowDays` = 0 or 91; `suggestions` length 5).
- **CRITICAL legacy-parse-unchanged (additivity):**
  - a legacy `JudgeVerdict` object with no `annotations` key parses and yields
    `annotations: []` with all other fields byte-identical;
  - a legacy `AnalyzePostsResponse` whose scored item has no `cooldown` key parses
    unchanged (no `cooldown` injected);
  - a legacy idea-only `GenerateIdeaRequest` (`{ idea: "..." }`, no `format`) parses
    unchanged and passes the refine;
  - a `format`-only `GenerateIdeaRequest` (`{ format: "hot_take" }`, no `idea`) parses;
  - a `GenerateIdeaRequest` with neither `idea` nor `format` is REJECTED by the refine.
- `deriveApproved` boundary: a verdict with `scores.overall === 70` (band
  `slight_rework`) → `true`; with `overall === 69` (band `major_rework`) → `false`.

## Definition of Done

- All seven new schema modules + the three additive edits + `deriveApproved` exist and
  compile; everything public is exported from `shared/src/index.ts`.
- `EngineTransport` declares exactly 17 methods with the locked names; each has its
  `__xbuilder_<method>` constant; `ENGINE_TRANSPORT_BINDINGS` covers all 17.
- All Zod round-trip + reject + legacy-parse-unchanged + `deriveApproved` boundary tests
  pass; `pnpm -F @x-builder/shared test` and `pnpm typecheck` green.
- Zero consumer/producer/wiring code (zero-trace list holds).

## Acceptance Criteria

- **Given** a valid `CaptureIngestRequest`, `SuggestPostResponse`, and `CooldownReport`,
  **When** parsed by their schemas, **Then** each round-trips to a deep-equal value
  (modulo declared defaults).
- **Given** a malformed payload (e.g. `cooldownSignal` using `count` not `countInWindow`,
  or `judgeAnnotation.quote` length 281), **When** parsed, **Then** it is rejected.
- **(Legacy)** **Given** a legacy `JudgeVerdict` object with no `annotations` field,
  **When** parsed by the extended `judgeVerdictSchema`, **Then** it parses to
  `annotations: []` and every other field is identical.
- **(Legacy)** **Given** a legacy `AnalyzePostsResponse` whose scored item omits
  `cooldown`, **When** parsed, **Then** it parses unchanged with no `cooldown` added.
- **(Legacy)** **Given** an idea-only `GenerateIdeaRequest` `{ idea: "x" }`, **When**
  parsed by the extended `generateIdeaRequestSchema`, **Then** it parses unchanged.
- **(Negative/refine)** **Given** a `GenerateIdeaRequest` with neither `idea` nor
  `format`, **When** parsed, **Then** the refine rejects it.
- **(Boundary)** **Given** a verdict with `scores.overall === 70`, **When**
  `deriveApproved(verdict)` is called, **Then** it returns `true`; **Given**
  `overall === 69`, **Then** it returns `false`.
- **Given** `ENGINE_TRANSPORT_BINDINGS`, **When** its keys are enumerated, **Then**
  there are exactly 17 entries, each value equals `__xbuilder_<methodName>`, and the
  set of method names equals the locked 17.

## Edge Cases

- `getCooldown(windowDays?)` — the optional numeric arg must be structured-clone-safe
  and the binding signature must tolerate omission (defaults to 7 at the producer, not here).
- `getGenerateCategories` returns a bare `GenerateCategory[]` (array, not a wrapper
  object) — the binding return type must be the array.
- Dates are ISO strings only (no `Date` objects) so payloads survive `exposeFunction`
  structured-clone.
- `judgeVerdictSchema.annotations.max(12)` — a 13-annotation verdict is rejected (caps
  UI highlight volume).
- `generatedIdeaCandidateSchema.verdict`/`approved` are independently optional, but the
  intended pairing (both present when judged, both absent when judge failed) is enforced
  by the producer (XOB-011), not this schema — both-absent and both-present must parse here.
- The internal `scoredPostItemSchema` edit must not perturb the `analyzedPostItemSchema`
  discriminated union (`status` discriminant unchanged); a `score_failed` item never
  carries `cooldown`.

## Pipeline Log

Lean Red-first lane.

- **Red** (`3e46d53` + rename `aa65a82`): 93 failing contract tests across `overlay-seam-schemas.test.ts` (60) + `judge-and-transport-contracts.test.ts` (33) — Zod round-trip/reject, legacy-parse-unchanged, `deriveApproved` boundary (70→true/69→false), binding-count=17, locked names, frozen `ENGINE_TRANSPORT_BINDINGS`. Self-validated, behavior-named files (no ticket-IDs).
- **Green** (`1cc60e2`): 7 new `schemas/*.ts` (incl. `post-formats.ts` extracted to break the `cooldown ↔ deterministic-analysis` import cycle — enums re-exported verbatim, public barrel byte-identical), three additive edits (`judge.ts` `judgeAnnotationSchema`/`annotations.max(12).default([])`/`deriveApproved`; `shell.ts`; `deterministic-analysis.ts` optional `cooldown`), full barrel exports. 207/207 shared tests.
- **Red cycle 2** (`e1e30b0`): guarded indexed access in own test file for `noUncheckedIndexedAccess` (TS18048); surfaced that `.default([])` makes `annotations` required on the inferred *output* type, breaking 10 pre-existing client/engine verdict fixtures.
- **Green fix** (`c785898`): added `annotations: []` to the 10 pre-existing fixtures (justified ripple from the changed shared contract; core rule "update old code, no shims"). Zero `shared/` test files touched. Workspace typecheck green; 207 shared / 268 client / 577 engine.
- **Gates** (`all --base aa65a82`): `[suppressions]`/`[ticket-ids]`/`[stubs]`/`[slop]`/`[ui-tokens]` all CLEAN.
- **Blue (Validate Green)**: APPROVE — typecheck honest (`--force`, no stale cache; `noUncheckedIndexedAccess` still true), 17 methods/bindings/registry with locked spellings, reuse-not-redefine, focused diff. `post-formats.ts` ruled justified circular-dep break, not scope creep.
- **Yellow (intent)**: APPROVE — all deliverables real, zero-trace holds (no service/route/runner/overlay impl; `EngineTransport` interface-only), no orphans, 5-segment traces verified for `analyzePosts`/`applyJudgeSuggestions`/`getCaptureSummary`/`suggestPost`. snug skipped (no UI).
- **[FND] Architectural checkpoint (Blue)**: APPROVE — seam covers every epic affordance; canonical cross-consumer shapes (`cooldownSignalSchema` one-shape-two-consumers, `captureSummarySchema` single auto-followers source, `deriveApproved` single ≥70 threshold) hold; extension points for XOB-003/010/011 correctly shaped; no structure-vs-intent drift.
- Concerns ledger: none. Status → **done**.
