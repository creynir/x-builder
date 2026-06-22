# X Overlay Browser v1 — Tickets (build order)

Epic context: `../README.md` (Architecture Context — re-read before each ticket). Architecture outputs: `../architecture/`. Ticket ID prefix `XOB-`. Status values: `todo | in-progress | done | escalated`.

Build order is dependency-driven: foundations first, schemas before consumers, the overlay highlight layer before provenance/blue, tests after implementation, docs last. `[FND]` tickets get an architectural checkpoint after completion.

| # | ID | Prefix | Title | Depends on |
|---|---|---|---|---|
| 1 | XOB-001 | `[CHORE]` | Workspace: add `playwright` runtime + `@x-builder/runner` + `@x-builder/overlay` packages | — |
| 2 | XOB-002 | `[FND]` | Shared contracts — `EngineTransport` (17) + all v1 delta schemas + `deriveApproved` | XOB-001 |
| 3 | XOB-003 | `[FND]`/`[RFR]` | Post-library store **v2** — widen source unions, `profileSnapshots`, forward migration | XOB-002 |
| 4 | XOB-004 | — | `LiveCaptureService.ingest` — accumulate live posts + profile | XOB-002, XOB-003 |
| 5 | XOB-005 | — | `RepetitionWindowService` — real rolling-window cooldown over the merged corpus | XOB-002, XOB-003 |
| 6 | XOB-006 | — | `GenerateCategoryService` + `GET /generate/categories` — dynamic categories from the corpus | XOB-002, XOB-005 |
| 7 | XOB-007 | — | `LiveContextResolver` + `/posts/analyze` wiring — auto followers/median/repeatHistory + per-item cooldown | XOB-002, XOB-005 |
| 8 | XOB-008 | — | `LiveCaptureService.summary` + `GET /capture/summary` — capture summary / auto-followers source | XOB-002, XOB-003, XOB-004 |
| 9 | XOB-009 | — | `GET /capture/cooldown` route | XOB-002, XOB-005 |
| 10 | XOB-010 | — | Judge **span-annotations** output — prompt + `verdictOutputSchema` (`.default([])`) | XOB-002 |
| 11 | XOB-011 | — | `GenerateIdeasService` — by-format LLM generation + **generate→judge refine** (`/ideas/generate`) | XOB-002, XOB-010 |
| 12 | XOB-012 | — | `ApplyJudgeSuggestionsService` + `POST /drafts/apply-suggestions` — auto-improve, never-worse guard | XOB-002, XOB-010 |
| 13 | XOB-013 | — | `SuggestPostService` + `POST /posts/suggest` — deterministic rank + one LLM pass, cooldown-aware | XOB-002, XOB-005 |
| 14 | XOB-014 | — | `XGraphQlNormalizer` — tolerate-and-skip GraphQL → capture DTOs | XOB-002 |
| 15 | XOB-015 | — | `BrowserController` + `RunnerApp` bootstrap — persistent context, `addInitScript`, one-command, first-run install | XOB-001, XOB-002 |
| 16 | XOB-016 | — | `ExposeFunctionTransport` — bind all 17 `__xbuilder_*` to engine services in-process | XOB-002, XOB-004–013, XOB-015 |
| 17 | XOB-017 | — | `GraphQlCaptureObserver` wiring + `getOverlayReadiness` composition (runner-side) | XOB-004, XOB-014, XOB-015 |
| 18 | XOB-018 | `[FND]` | Overlay shadow-DOM injection host + **Aurora Glass** neon tokens | XOB-001 |
| 19 | XOB-019 | `[FND]` | Transport-consuming client seam (`useTransport`) + `XSelectors` + `AnchorLayer` skeleton | XOB-002, XOB-018 |
| 20 | XOB-020 | — | `SettingsAffordance` + `SettingsPanel` — archive→voice, provider, readiness, context toggle | XOB-019 |
| 21 | XOB-021 | — | `MetricExplainer` — 13 judge dims + deterministic checks + reach | XOB-019 |
| 22 | XOB-022 | `[FND]` | `CompositionHighlightLayer` — Range→`getClientRects` positioning, graceful degrade | XOB-019 |
| 23 | XOB-023 | — | `ProvenanceController` — two-state derived model + green anchor store | XOB-019, XOB-022 |
| 24 | XOB-024 | — | `ComposeGenerateRail` — dynamic categories from `getGenerateCategories()` | XOB-019, XOB-023 |
| 25 | XOB-025 | — | Compose detection + `StaticEngineColumn` — static fill (fast) + Post Coach recommendations; auto-followers | XOB-019, XOB-021, XOB-023 |
| 26 | XOB-026 | — | `JudgeStrip` — waiting→pulse→fill + **generate-refine** entry path | XOB-021, XOB-023, XOB-024, XOB-025 |
| 27 | XOB-027 | — | `JudgeStrip` auto-improve (`applyJudgeSuggestions`) + approved state + green/blue provenance render | XOB-022, XOB-023, XOB-026 |
| 28 | XOB-028 | — | `SuggestAffordance` + `SuggestCard` — cooldown-aware | XOB-019, XOB-021 |
| 29 | XOB-029 | — | `ComposeCockpit` assembly + responsive collapse | XOB-024, XOB-025, XOB-026, XOB-027 |
| 30 | XOB-030 | `[INT]` | Transport↔engine bindings (all 17) + `AnchorLayer` reconciliation + provenance flip | XOB-001–029 |
| 31 | XOB-031 | `[E2E]` | Runner vs local mock x.com — compose flow, capture→corpus, apply→re-pin, generated entry, highlight degrade | XOB-001–029 |
| 32 | XOB-032 | `[DOC]` | Overlay architecture + X-policy boundary + one-command setup + provenance/approval/explainer | XOB-030, XOB-031 |

**Carried P2 concerns (from delta validation) to honor in the relevant tickets:** (a) a per-chain LLM **timeout/budget** + clean failure surfacing for the 3-call apply chain and 4-call generate-refine (XOB-011, XOB-012); (b) **edit-while-applying cancellation** for the apply chain (XOB-027); (c) **rect-thrash visual budget** during rapid typing (XOB-022 Visual AC).

**Carried from XOB-016 → XOB-030 [INT] (the real `BoundEngineServices` adapter + RunnerApp wiring):** the `ExposeFunctionTransport` binder is structurally decoupled (shared types only), so XOB-030 owns building the real adapter bundle. It MUST: (1) map `judgeDraft` `req → JudgeDraftService.judge(req.text, req.accountProfile)` and `JudgeDraftOutcome → JudgeDraftResponse`; (2) **re-attach per-item `cooldown` in the `analyzePosts` adapter** (resolver-chain → `DeterministicAnalysisService.analyzePosts` → `RepetitionWindowService.compute(windowDays)` cooldown-attach, mirroring `server.ts` `attachCooldownSignals`) **and assert it on round-trip** — `cooldown` is schema-optional so it silently vanishes otherwise, breaking XOB-025's per-item cooldown UX; (3) wire RunnerApp `bindTransport` default → `ExposeFunctionTransport.bindAll` + construct the full bundle incl. `getStatus` composition (no `AppStatusService` class — compose from the engine `/status` logic) and `getOverlayReadiness` (from XOB-017); (4) **wire RunnerApp `attachObserver` default → `GraphQlCaptureObserver.attach(context, batch => liveCaptureService.ingest(batch))`** and register `getOverlayReadiness(<engine readiness wrapped to a `getSubsystems()` shape — the engine `ReadinessService` exposes `getStatus()`, not `getSubsystems()`>, observer)` into the bundle. Capture is **inert end-to-end until this wiring lands** — XOB-030 must prove capture→corpus ingest + the readiness round-trip in-process.

**Carried from XOB-019 → XOB-025 (AnchorLayer pin lifecycle API):** XOB-019's `AnchorLayer` ships as a read-only/empty registry skeleton (`Map<Element, AffordanceHandle>` + `useAnchorRegistry()`). The **pin register/reconcile mutation API** (pins mount/unmount on DOM churn; a composer-keyed `ComposeContext` entry) that XOB-030's [INT] DOM-churn invariants require is unbuilt and was not explicitly scoped by any ticket. **XOB-025 (compose detection, "owned by AnchorLayer") must additively extend `AnchorLayer`** with that register/reconcile + `ComposeContext` API; XOB-029 mounts the 3 zone pins through it; XOB-030 proves no-orphans on SPA nav. The seam is extended additively, not re-opened. (Also: `getSettings()` returns the `AppSettingsResponse` envelope — XOB-020 unwraps `.settings`. And XOB-030 references `overlay/src/anchor/anchor-layer.ts` while XOB-019 shipped flat `overlay/src/anchor-layer.tsx` — reconcile the import path at XOB-030.)

**Carried from XOB-018 → XOB-019 (overlay token substrate): RESOLVED in XOB-019** — the overlay shadow root seeds only the 25 `--xb-*` tokens. Downstream components also consume `--space-*`/`--type-*`/`--radius-*`/`--score-*` (defined `:root`-scoped in `docs/design-system/product-tokens.css`), which **do not resolve inside the shadow root** because the overlay is isolated and x.com has no `:root` design tokens. **XOB-019 must seed the consumed design-system primitive tokens onto the shadow `:host`** (extend the neon sheet or add a base-tokens sheet). First bites at XOB-021 (`--type-caption`/`--radius-md`), XOB-024 (`--space-2`), XOB-025 (`--score-*`). The overlay test harness is **Vitest browser mode → Playwright Chromium** (established in XOB-018); later overlay tickets inherit it.

**Status legend per ticket:** maintained in each ticket file's frontmatter `status:`. This epic's status lives in `../README.md` frontmatter.
