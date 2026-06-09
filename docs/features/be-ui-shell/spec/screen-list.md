# BE + Simple UI Shell Flow Spec - Screen List

Stage: product-flow-spec / Stage 1 EXTRACT

Status: approved for Stage 2 SPEC

## Inputs

### Flow Map

- [Feature Inventory](../map/01-feature-inventory.md)
- [Flow Index](../map/02-flow-index.md)
- [App Boot And Readiness Check](../map/02-flows/app-boot-readiness.md)
- [Route Navigation](../map/02-flows/route-navigation.md)
- [Backend Unavailable Recovery](../map/02-flows/backend-unavailable-recovery.md)
- [Settings Readiness Repair](../map/02-flows/settings-readiness-repair.md)
- [Flow Map Validation Report](../map/03-validation-report.md)

### Design System

- [Design System Index](../../../design-system/README.md)
- [Product Design Brief](../../../design-system/product-design-brief.md)
- [Product Foundations](../../../design-system/product-foundations.md)
- [Product Tokens CSS](../../../design-system/product-tokens.css)
- [Product Components](../../../design-system/product-components.md)
- [Product Patterns](../../../design-system/product-patterns.md)
- [Product Screens](../../../design-system/product-screens.md)
- [Design Validation Report](../../../design-system/validation-report.md)

### Backend And Client Code

- `engine/src/server/server.ts`
- `engine/src/writer/writer-engine.ts`
- `engine/src/scoring/deterministic-scorer.ts`
- `engine/src/codex-adapter/codex-adapter.ts`
- `engine/src/voice/voice-extractor.ts`
- `shared/src/index.ts`
- `shared/src/schemas/candidates.ts`
- `shared/src/schemas/judge.ts`
- `shared/src/schemas/posts.ts`
- `shared/src/schemas/voice.ts`
- `client/src/app/app.tsx`
- `client/src/features/writer/writer-page.tsx`
- `e2e-tests/tests/writer.spec.ts`

## Accepted Assumptions From Flow-Map Validation

These are carried forward because the user approved continuing after validation.

- Settings includes editable shell-owned fields in this epic: engine URL, storage path, and readiness-related command labels or toggles.
- Successful Settings repair does not auto-return. When Settings is opened from a route error, show an explicit `Back to Writer` action.
- Voice and Post Library placeholders are shell-owned until their feature pages replace them.
- Detailed readiness lives at `GET /status`; `GET /health` remains liveness-only.
- Routes are URL-backed from day one.

## Flow-Map Context To Carry Forward

- Problem: create a local app shell and backend boundary that hosts phase 1 features without each feature inventing navigation, status, loading, error, or persistence behavior.
- Primary persona: internal founder/operator writing X posts and using Codex locally.
- Success metrics:
  - app opens with engine readiness visible
  - navigation works across Writer, Voice, Post Library, and Settings
  - deterministic engine, Codex adapter, and storage readiness are visible as ready, partial, or failed
  - route errors preserve work and provide recovery
  - shell passes keyboard and basic accessibility tests
- Guardrails:
  - no marketing dashboard or landing page
  - do not block the whole app when one provider or route fails
  - do not imply ChatGPT subscription routing is available
  - do not duplicate schemas between client and engine
- Accessibility-critical states:
  - status changes need polite announcements
  - blocking route errors need assertive error communication
  - sidebar labels must remain accessible when collapsed
  - Settings field errors need explicit field association

## Screens Found

| # | Screen / Region | Type | Route | Referenced By | Priority |
|---|---|---|---|---|---|
| 1 | App Shell | Layout | all routes | all mapped flows | P0 |
| 2 | Top Status Bar | Persistent region | all routes | app boot, backend recovery, settings repair | P0 |
| 3 | Sidebar Nav | Persistent navigation | all routes | route navigation, app boot, recovery paths | P0 |
| 4 | Route Error Banner | Banner / inline feedback | route-local | app boot, backend recovery, settings repair | P0 |
| 5 | Settings Route | Page | `/settings` | route navigation, backend recovery, settings repair | P0 |
| 6 | Writer Route Shell Integration | Page wrapper | `/writer` | app boot, route navigation, backend recovery, settings repair | P0 |
| 7 | Voice Route Placeholder | Page state | `/voice` | route navigation | P1 |
| 8 | Post Library Route Placeholder | Page state | `/library` | route navigation | P1 |

## Deduplication Notes

- `App Shell`, `Top Status Bar`, and `Sidebar Nav` are shared regions, not separate routes. Stage 2 should still spec them independently because every route depends on their behavior.
- `Route Error Banner` appears in multiple flows with the same interaction pattern: preserve current route/input, classify failure, provide Retry and Settings actions.
- `Writer Route` already exists as a partial page. This epic should spec only shell integration and route-level error/loading behavior; full writer generation UI belongs to later writer logic specs.
- `Voice Route` and `Post Library Route` are placeholders in this epic. Their detailed feature workflows belong to future feature folders.

## Backend Capabilities Discovered

### API Endpoints

| Endpoint | Method | Current Status | Purpose | UI Implication |
|---|---|---|---|---|
| `/health` | GET | implemented | Lightweight engine liveness, returns `{ ok: true }` | Can support process smoke checks, but is too thin for the Top Status Bar. |
| `/ideas/generate` | POST | implemented | Validate idea input and generate three deterministic candidate formats | Writer can call engine, but shell needs typed API boundary and recoverable error handling. |
| `/status` | GET | missing | Detailed engine, Codex adapter, storage, and last-run readiness | Required for Top Status Bar, boot readiness, Settings repair, and partial state labels. |

### Shared Schemas

| Schema | Current Status | Key Fields | UI Implication |
|---|---|---|---|
| `generateIdeaRequestSchema` | implemented | `idea`, `voiceProfileId`, `useKnownPostIds` | Writer form can validate required idea input. |
| `generateIdeaResponseSchema` | implemented | `ideaId`, exactly 3 `candidates` | Writer result surface has a stable first-pass candidate count. |
| `candidateSchema` | implemented | `format`, `text`, `deterministicScores`, `reasons`, `risks` | Candidate UI can render deterministic score bands, reasons, and risks. |
| `llmJudgeResponseSchema` | implemented | `recommendedCandidateId`, `results`, `overallNotes` | Judge UI has a contract, but no endpoint is exposed yet. |
| `knownPostSchema` | implemented | source, text, URL, metrics, usage flags | Post Library can eventually distinguish unused, voice, signal, generation, and excluded posts. |
| `voiceProfileSchema` | implemented | tone, sentence shape, common moves, topics, avoid phrases | Voice page can eventually render extracted voice profile fields. |
| `appStatusSchema` | missing | engine, deterministic, Codex, storage, last run, version | Required for Top Status Bar and Settings readiness test. |
| `apiErrorSchema` | missing | code, message, scope, retryable, details | Required for Route Error Banner, API client, and field-level errors. |
| `appSettingsSchema` | missing | engine URL, storage path, Codex command settings, feature toggles | Required for Settings Route. |
| `routeConfigSchema` | missing or client-only decision | id, label, path, enabled state, badge/state | Needed if route registry is shared or externally validated. |

### Engine Modules

| Module | Current Status | Capability | UI Implication |
|---|---|---|---|
| `writer-engine` | implemented | one candidate each for one-liner, mini-framework, and debate-question formats | Writer route has day-one generated content source. |
| `deterministic-scorer` | implemented | deterministic score dimensions and band | Deterministic scoring can run independently of Codex. |
| `codex-adapter` | implemented module, not surfaced by server | wraps `codex exec` with schema output and timeout | Settings and Top Status Bar need readiness semantics before judge UI relies on it. |
| `voice-extractor` | implemented module | generates voice profile from posts or pasted examples | Voice route placeholder can mention voice setup, but full flow is later. |
| storage | placeholder only | no persistence implementation found | Storage readiness must start as an explicit boundary, not pretend persistence exists. |

### Client Surfaces

| Surface | Current Status | UI Implication |
|---|---|---|
| `App` | partial | Renders `WriterPage` directly; no shell, router, status bar, sidebar, or error boundary yet. |
| `WriterPage` | partial | Simple route content exists, but it is not wrapped in the app shell. |
| E2E writer smoke | partial | Confirms heading only; needs shell/nav/status smoke coverage. |

## Coverage Check

### Screens That Need Backend Data Or Contracts

| Screen / Region | Backend Need | Current Gap |
|---|---|---|
| Top Status Bar | `GET /status`, `appStatusSchema` | Endpoint and schema missing. |
| Settings Route | `appSettingsSchema`, persistence boundary, readiness test call | Schema and persistence boundary missing. |
| Route Error Banner | `apiErrorSchema`, API client error classification | Schema and API client missing. |
| Writer Route Shell Integration | typed `/ideas/generate` client, route-level loading/error state | Endpoint exists; client boundary and shell recovery missing. |
| App Shell | route registry, local preference storage | Registry and local preference persistence missing. |

### Backend Capabilities With No Shell UI Yet

| Capability | Should Shell Own UI? | Notes |
|---|---|---|
| Full candidate comparison | No | Later writer logic + UI epic. Shell only preserves route state and error handling. |
| Full LLM judge output | No | Later LLM-as-judge epic. Shell only surfaces Codex readiness. |
| Known posts import/use table | No | Later known posts and library epic. Shell only owns placeholder route. |
| Voice profile extraction/editing | No | Later voice feature. Shell only owns placeholder route. |
| Storage readiness | Yes, boundary only | Shell must display ready/stale/failed, even before full analytics persistence exists. |

### Content, Localization, And Accessibility Needs

| Screen / Region | Needs |
|---|---|
| App Shell | route labels, unknown-route redirect behavior, skip/focus target rules, responsive collapse behavior |
| Top Status Bar | ready/partial/failed labels, freshness copy, polite live region, no color-only states |
| Sidebar Nav | accessible labels in collapsed mode, `aria-current`, keyboard route switching |
| Route Error Banner | local engine unavailable copy, retry copy, Settings action, assertive announcement only for blocking failures |
| Settings Route | field labels, dirty-state copy, validation messages, save failure copy, field error association |
| Writer Route Shell Integration | route-level loading, backend unavailable banner preserving idea input |
| Voice / Library placeholders | useful placeholder copy without pretending the feature is implemented |

## Component Coverage

Design-system components available for Stage 2 specs:

- `AppShell`
- `SidebarNav`
- `TopStatusBar`
- `PageHeader`
- `Button`
- `IconButton`
- `Input`
- `Select`
- `Switch`
- `Badge`
- `Tooltip`
- `Toast`
- `EmptyState`
- `Skeleton`
- `InlineError`
- `Textarea`

No new design-system component is required for Stage 2. `Route Error Banner` should be specified as a shell pattern composed from `InlineError`, `Button`, and `Badge`.

## Recommended Spec Order

1. App Shell: shared layout and route outlet contract used by every screen.
2. Top Status Bar: drives readiness semantics and `/status` contract.
3. Route Error Banner: defines recovery behavior before feature routes add API calls.
4. Sidebar Nav: establishes URL-backed navigation, active state, and accessibility rules.
5. Settings Route: exposes shell-owned readiness repair fields.
6. Writer Route Shell Integration: wraps existing writer page and protects input/error behavior.
7. Voice Route Placeholder: shell-owned route placeholder until voice epic replaces it.
8. Post Library Route Placeholder: shell-owned route placeholder until library epic replaces it.

## Stage 2 Review Gate

Before Stage 2, confirm:

- The eight screen/region entries above are the right spec scope.
- The P0 order should be App Shell, Top Status Bar, Route Error Banner, Sidebar Nav, Settings Route, then Writer Route Shell Integration.
- Voice and Post Library should stay as P1 placeholder specs in this epic.
- No additional shell-owned settings fields are needed beyond engine URL, storage path, and readiness-related Codex command labels or toggles.
