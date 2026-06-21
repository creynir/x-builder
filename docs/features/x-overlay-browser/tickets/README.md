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

**Status legend per ticket:** maintained in each ticket file's frontmatter `status:`. This epic's status lives in `../README.md` frontmatter.
