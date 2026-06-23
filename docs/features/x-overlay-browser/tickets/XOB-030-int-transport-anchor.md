---
status: done
labels: [test]
---

# XOB-030: [INT] Transport↔Engine Bindings (All 17) + AnchorLayer Reconciliation + Provenance Flip

Depends on: XOB-001 through XOB-029

> **LANE DECISION (2026-06-22, user-directed): run as the STANDARD pipeline (Red → Green → Blue+Yellow), not Purple-only [INT].** XOB-016 shipped `ExposeFunctionTransport.bindAll` as injectable/service-agnostic and `RunnerApp.bindTransport`/`attachObserver` with NO-OP defaults — the **real `BoundEngineServices` adapter + the default wiring deferred *into* this ticket** and do not exist yet. So the implementation the [INT] flows verify is the very piece XOB-030 must BUILD. Red writes the flows + invariants below as failing integration tests; **Green builds**:
> - the real **`BoundEngineServices` adapter bundle** (construct/inject every engine service the 17 bindings map to) consumed by `ExposeFunctionTransport.bindAll`;
> - **`RunnerApp` default wiring**: `bindTransport` default → `ExposeFunctionTransport.bindAll(page, services)`; `attachObserver` default → `GraphQlCaptureObserver.attach(context, batch => liveCapture.ingest(batch))`; register `getOverlayReadiness` (XOB-017) into the bundle;
> - **`getStatus`** composition (no `AppStatusService` class — compose from the engine `/status` logic) and **`getOverlayReadiness`** wrapping (engine `ReadinessService` exposes `getStatus()`, not `getSubsystems()` — wrap to the readiness shape);
> - **`judgeDraft` arg-shape**: `req → JudgeDraftService.judge(req.text, req.accountProfile)`, `JudgeDraftOutcome → JudgeDraftResponse`;
> - **`analyzePosts` per-item cooldown re-attach**: resolver-chain → `DeterministicAnalysisService.analyzePosts` → `RepetitionWindowService.compute(windowDays)` cooldown-attach (mirror `server.ts` `attachCooldownSignals`) and **assert it on round-trip** (`cooldown` is schema-optional so it silently vanishes otherwise).
>
> **Must prove capture→corpus ingest + the readiness round-trip in-process** (capture is inert until this lands). Then Blue+Yellow validate (incl. the 1:1-bindings, no-facade, capture-observed-not-injected invariants).
>
> **Stale-path reconcile:** the Modules list below references `overlay/src/anchor/anchor-layer.ts` and `overlay/src/anchor/provenance-controller.ts`; the shipped files are flat — `overlay/src/anchor-layer.tsx` (AnchorLayer + `ComposeContext` + register/reconcile, built in XOB-029) and `overlay/src/provenance/provenance-controller.tsx` (XOB-023). Use the real paths. The AnchorLayer `ComposeContext`/reconcile + `ProvenanceController` + generate-refine verdict-attach (XOB-011) + capture-no-egress (XOB-017) are already BUILT — those flows are verify-only; the binding adapter + RunnerApp wiring are the new build.

## User Flows to Verify

### Binding round-trips (in-process, no browser)

**Given** an `ExposeFunctionTransport` with all engine services wired and a `FakeEngineTransport`-shaped caller  
**When** each of the 17 `__xbuilder_*` bindings is invoked with a schema-valid request payload  
**Then** each binding returns a schema-valid response parsed by the corresponding Zod response schema, and the response is the actual output of the mapped in-process engine service (not a stub or cached value)

Binding → service map under test:

| Binding | Service |
|---|---|
| `__xbuilder_getOverlayReadiness` | Runner `getOverlayReadiness` (engine subsystems + `GraphQlCaptureObserver` state) |
| `__xbuilder_getStatus` | `DefaultReadinessService` / `/status` |
| `__xbuilder_getSettings` | `JsonFileAppSettingsRepository` |
| `__xbuilder_updateSettings` | `JsonFileAppSettingsRepository` |
| `__xbuilder_validateArchive` | `ArchiveImportService.validate` |
| `__xbuilder_importArchive` | `ArchiveImportService.import` |
| `__xbuilder_getActiveContext` | `ArchiveDerivedContextService` |
| `__xbuilder_activateContext` | `ArchiveDerivedContextService` |
| `__xbuilder_deactivateContext` | `ArchiveDerivedContextService` |
| `__xbuilder_analyzePosts` | `LiveContextResolver` → `ArchiveStudioContextResolver` → `DeterministicAnalysisService` + per-item cooldown |
| `__xbuilder_judgeDraft` | `JudgeDraftService.judge` |
| `__xbuilder_generateIdeas` | `GenerateIdeasService` (idea-only path for this test; format path in §generate-refine below) |
| `__xbuilder_suggestPost` | `SuggestPostService.suggest` |
| `__xbuilder_getCooldown` | `RepetitionWindowService.compute` |
| `__xbuilder_getCaptureSummary` | `LiveCaptureService.summary` |
| `__xbuilder_getGenerateCategories` | `GenerateCategoryService` |
| `__xbuilder_applyJudgeSuggestions` | `ApplyJudgeSuggestionsService` |

### Generate-refine path attaches verdict and approved

**Given** a seeded corpus (≥ 1 post) and a working LLM provider  
**When** `__xbuilder_generateIdeas` is called with `{format: "hot_take"}` (no `idea`)  
**Then** the response contains exactly 3 candidates, each with a `verdict` (full `judgeVerdictSchema` shape including `annotations`) and an `approved` boolean; `approved` equals `deriveApproved(verdict)` (i.e. `verdict.scores.overall >= 70`)

**Given** the LLM judge fails mid-refine for one candidate (injected fault)  
**When** `__xbuilder_generateIdeas({format})` completes  
**Then** the response still returns 3 candidates; the faulted candidate has `verdict` and `approved` absent; the others carry them

### AnchorLayer reconciliation against an X-shaped fixture DOM

**Given** a fixture HTML document that mirrors X's composer modal structure — including `div[data-testid="tweetTextarea_0"]`, `div[data-testid="tweetButton"]`, a `[role="dialog"]` wrapper, and several `article[data-testid="tweet"]` elements  
**When** `AnchorLayer` initialises and the `MutationObserver` reconciles against the fixture  
**Then** pins mount for each matched node; the anchor registry contains one `ComposeContext` entry keyed to the composer dialog and one entry per tweet article

**Given** the mounted fixture  
**When** the composer dialog node is removed from the DOM (simulating X closing the modal)  
**Then** the `ComposeAffordance` pin is removed from the registry; no error is thrown

**Given** the mounted fixture  
**When** a simulated SPA navigation fires (via `navigation.navigate` or the `[role="dialog"]` mutation fallback) that removes the current composer and adds a new one  
**Then** the old pin is unmounted and a new pin is mounted for the new dialog node, with no orphan entries in the registry

**Given** a fixture with no `tweetTextarea_0` element present (selector miss)  
**When** the `MutationObserver` fires  
**Then** `safeQuery()` returns `null`, `selectorMissCount` increments, the registry entry for the composer is absent, and no exception propagates to the caller

### ProvenanceController flips generated→user_written on a composer edit

**Given** a `ProvenanceController` with a pinned green anchor (exact text returned by a prior `generateIdeas` or `applyJudgeSuggestions` call)  
**When** the composer `.textContent` equals the pinned anchor byte-for-byte  
**Then** the derived provenance state is `"generated"` and `deriveApproved` from `@x-builder/shared` returns the approval status of the anchor's verdict

**Given** the same `ProvenanceController` with the anchor set  
**When** the user edits the composer text so that it differs from the anchor by even one character  
**Then** the derived provenance state is immediately `"user_written"`, the green anchor is not cleared from L3 storage (it may be re-used), and no `approved` flag is surfaced until a fresh `judgeDraft` completes

**Given** a `ProvenanceController` with no anchor (initial state, anchor = `null`)  
**When** any text is present in the composer  
**Then** provenance state is always `"user_written"` regardless of content

## Architectural Invariants

Each invariant is falsifiable: a facade or stub implementation will fail the corresponding assertion.

1. **Bindings are 1:1 with `EngineTransport`.** The `ExposeFunctionTransport.bindAll` call must register a handler for exactly each of the 17 method names in `EngineTransport`. A test that enumerates the `EngineTransport` interface (from `shared/src/schemas/engine-transport.ts`) and asserts that every method name has a corresponding `__xbuilder_<method>` registration will fail if any binding is missing or extra.

2. **No binding returns a stored boolean or a hardcoded schema-valid response.** Each binding under test is called twice with different valid inputs (e.g. two different `text` values for `judgeDraft`). The responses must differ in at least one schema field that is input-derived (e.g. `verdict.scores.overall`, `corpusSize`, `suggestions`). A facade that always returns a fixed response fails this invariant.

3. **Provenance is derived from anchor-vs-text comparison, not from a stored boolean.** A test that (a) pins anchor `"foo"`, (b) confirms state is `"generated"`, (c) sets composer text to `"foo"`, (d) confirms state remains `"generated"`, (e) mutates the internal anchor store directly to the same string `"foo"`, then (f) changes the composer text to `"fo"` — must observe that step (f) flips state to `"user_written"` immediately. An implementation that tracks provenance as a stored boolean (set once on pin, never re-derived) will fail at step (f).

4. **`approved` is not computed by the overlay independently.** Any test that calls `deriveApproved` from `@x-builder/shared` and compares the result to the `approved` field returned by `generateIdeas` or `applyJudgeSuggestions` must find them equal. An overlay that applies its own `>= 70` threshold directly (not via `deriveApproved`) will fail if `deriveApproved` ever changes its band boundaries.

5. **`AnchorLayer` selector misses pause, not crash.** A fixture that removes all X `data-testid` nodes must result in an empty anchor registry and a non-zero `selectorMissCount`. An implementation that throws on a failed selector query fails this invariant.

6. **Capture is observed, not injected.** The `GraphQlCaptureObserver` must not issue any outbound HTTP request to `x.com/graphql` or any other external host. The test validates by asserting that `page.route` (in a Playwright test harness) intercepts zero `POST` requests originating from the runner to `**/graphql`.

## Modules Under Test

- `runner/src/expose-function-transport.ts` (`ExposeFunctionTransport`, `bindAll`)
- `engine/src/capture/live-capture-service.ts` (`LiveCaptureService`)
- `engine/src/capture/repetition-window-service.ts` (`RepetitionWindowService`)
- `engine/src/capture/live-context-resolver.ts` (`LiveContextResolver`)
- `engine/src/suggest/suggest-post-service.ts` (`SuggestPostService`)
- `engine/src/suggest/generate-category-service.ts` (`GenerateCategoryService`)
- `engine/src/llm/generate-ideas-service.ts` (`GenerateIdeasService`)
- `engine/src/llm/apply-judge-suggestions-service.ts` (`ApplyJudgeSuggestionsService`)
- `engine/src/server/post-library-repository.ts` (v2 store, `upsertPosts`, `loadStore`)
- `shared/src/schemas/engine-transport.ts` (`EngineTransport` interface, 17 methods)
- `shared/src/schemas/judge.ts` (`deriveApproved`, `judgeVerdictSchema`, `judgeAnnotationSchema`)
- `overlay/src/anchor/anchor-layer.ts` (`AnchorLayer`, `XSelectors`, `safeQuery`)
- `overlay/src/anchor/provenance-controller.ts` (`ProvenanceController`)
- `runner/src/graphql-capture-observer.ts` (`GraphQlCaptureObserver`)

**Fixture ownership:** X-shaped fixture DOM (composer dialog + tweet articles + selector-miss variants) owned in this ticket's test directory. Canned binding request/response payloads (one per method, structurally valid under the shared Zod schemas) also owned here. All LLM calls mocked via injected `StructuredLlmService` fake (mirror `judge-draft-service.test.ts`). No live `x.com` contact.

**Suite location:** `e2e-tests/` integration suite (or the relevant package's `src/**/*.integration.test.ts` per workspace convention). Fixtures co-located with this suite.

## Pipeline Log

### 2026-06-23 — DONE (standard lane, 0 rejection cycles)
- **Red** (`f790f73`): two suites — Group A `runner/src/transport-engine-bindings.integration.test.ts` (new-build, must-fail) + Group B `overlay/src/compose-anchor-provenance.integration.test.tsx` (verify-only, passing). Blue **Validate Red: APPROVE** — invariants #1–#6 falsifiable; Group A fails on the absent `bound-engine-services.ts` (correct), Group B passes as scoped. Scope gate CLEAN; ticket-ids lead (XOB-* in a comment header) verified non-violation.
- **Green** (`1b0b7ae`): built `runner/src/bound-engine-services.ts` (`createBoundEngineServices` — 17-binding bundle, judgeDraft outcome-unwrap, analyzePosts per-item cooldown re-attach mirroring `server.ts attachCooldownSignals`, getStatus/getOverlayReadiness composition); flipped `RunnerApp` NO-OP defaults → real `bindAll` + observer→`liveCapture.ingest` wiring (capture was inert until this); `engine/src/index.ts` barrel re-exports; new exported `createDefaultReadinessService`; type-only precision fix to `ENGINE_TRANSPORT_BINDINGS`. Group A 11/11; full regression green (runner 86, engine 716, shared 207, overlay 316, client 268); typecheck 10/10, lint 7/7.
- **Validation:** Blue **Validate Green: APPROVE** (4 scrutiny points each evidence-resolved; shared retype runtime-identical; observer change is new-code not [RFR]-worthy; barrel/StructuredLlmService one-path mirrors `buildServer`). Yellow **APPROVE_WITH_CONCERNS** (both production traces wired; watch-point judged intent-aligned per epic Component Breakdown).
- **Concern (ledger C-030-1, non-blocking):** engine barrel carries unused **type-only** companion re-exports (`ArchiveImportServiceOptions`, `ArchiveDerivedContextServiceOptions`; Yellow also flagged `JudgeDraft`/`JudgeProviderResolver` — Blue found those two consumed). No AC/DoD touched, type-erased at runtime, build green, not lint-flagged (`tsc --noEmit`, no unused-modules rule). Triage at merge.
- **Watch-point fired & resolved (for user note at merge):** the 5 approved barrel exports were insufficient — GenerateIdeas/ApplyJudgeSuggestions/SuggestPost have no `createDefault*` factory, so Green re-exported 3 more provider primitives (`judgeProviderRegistry`, `createSettingsJudgeProviderResolver`, `resolveWorkspaceRoot`) + `ArchiveStudioContextResolver` and built one shared `StructuredLlmService` inline in `RunnerApp` (mirrors `buildServer`). Both validators judged this in-scope/one-path. Offered follow-up alternative: a `[RFR]` adding `createDefault{GenerateIdeas,ApplyJudgeSuggestions,SuggestPost}Service` factories.
