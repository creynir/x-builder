# BE + Simple UI Shell Flow Map - Feature Inventory

Product: X Builder

Stage: product-flow-map / Stage 1 DISCOVER

Status: draft for review

Scan scope:

- `README.md`
- `docs/features/README.md`
- `docs/features/be-ui-shell/README.md`
- `docs/design-system/README.md`
- `docs/design-system/product-screens.md`
- `docs/design-system/product-patterns.md`
- `docs/design-system/validation-report.md`
- `client/src/app/app.tsx`
- `client/src/features/writer/writer-page.tsx`
- `engine/src/server/server.ts`
- `engine/src/index.ts`
- `shared/src/index.ts`
- `e2e-tests/tests/writer.spec.ts`

## Problem Frame

- Problem statement: X Builder needs a local app shell and backend boundary that can host phase 1 features without every feature inventing its own routing, status, loading, error, and persistence behavior.
- Primary audience: one internal power user, the founder/operator writing X posts and using Codex locally.
- Success metrics:
  - User can open the local app and see engine readiness.
  - User can navigate between Writer, Voice, Post Library, and Settings without losing local route state.
  - User can tell whether deterministic engine, Codex adapter, and storage are ready, partial, or failed.
  - UI errors preserve work and provide recovery.
  - App shell passes keyboard and basic accessibility tests.
- Guardrails:
  - Do not make a marketing dashboard or landing page.
  - Do not block the whole app when one provider or panel fails.
  - Do not silently route LLM calls through a ChatGPT subscription.
  - Do not duplicate schemas between client and engine.
- Constraints:
  - Local-first app.
  - Turbo monorepo with `client`, `engine`, `shared`, `e2e-tests`, `tools`, `docs`.
  - Shared Zod schemas live in `shared`.
  - Day-one LLM integration is through a Codex CLI adapter, but deterministic behavior must still run independently.
  - Design system is approved enough for phase 1 implementation.
- Decision principles:
  - Shell before feature depth: every feature should plug into the same route/status/error/persistence conventions.
  - Partial is a first-class state: Codex unavailable should not imply app unavailable.
  - Local state must be visible: storage freshness, last run, and adapter readiness belong in the chrome.
  - Build only reusable shell primitives here; feature-specific logic belongs in its own feature.

## Personas

### Founder Writer

- Role: internal product owner and X post author.
- Goal: open the local tool, generate or inspect posts, and understand whether the system is ready to help.
- Context: frequent local use, likely through Codex and browser side by side.
- Source: product brief, design-system screens, README.
- Confidence: high.

### Codex Operator

- Role: the user asking Codex to run the local app, inspect outputs, and iterate.
- Goal: have a predictable local CLI/app surface so Codex can run checks and report results.
- Context: development and day-one usage overlap.
- Source: user direction around Codex CLI adapter and local app, README.
- Confidence: medium.

### Future Feature Implementer

- Role: developer adding deterministic engine, writer logic, judge, voice, library, and import flows.
- Goal: rely on stable app shell, shared schemas, and backend boundary instead of re-solving navigation and status.
- Context: phase 1 implementation.
- Source: feature folder plan, monorepo structure, validation report.
- Confidence: high.

## JTBD Mapping

| JTBD Step | What the user does | Shell feature coverage |
|---|---|---|
| Define | Choose which product route to use | Sidebar routes, page headers |
| Locate | Find Writer, Voice, Post Library, Settings | App shell navigation |
| Prepare | Confirm engine, storage, and adapter readiness | Top status bar, health endpoint |
| Confirm | Check whether app can run the desired action | Readiness states, disabled/partial states |
| Execute | Trigger route-specific work | Route outlet and backend API client boundary |
| Monitor | Watch generation, judge, import, and storage status | Runtime status, per-panel loading, live regions |
| Modify | Change route, retry failed backend calls, update settings | Retry affordances, Settings entry |
| Conclude | Save local state and keep route context | Persistence boundary, local state conventions |

Coverage gap:

- The current code covers only the simplest Writer render and `/health` plus `/ideas/generate`. It does not yet cover navigation, shared shell chrome, status aggregation, or storage readiness.

## IA / Content / Service Notes

### Information Architecture

| Section / Screen | Parent | Primary Nav? | Label Risk | Notes |
|---|---|---|---|---|
| Writer | App shell | Yes | Low | First route and current code entry point. |
| Voice | App shell | Yes | Low | Needs disabled/empty state if no posts exist. |
| Post Library | App shell | Yes | Medium | Route label is clear; URL should probably be `/library`. |
| Settings | App shell | Yes | Low | Owns Codex adapter and storage configuration. |
| My Analytics | App shell | Later | Low | Deferred phase 2. |
| Signals | App shell | Later | Medium | Deferred phase 2; label may need clarification later. |

### Content Model

| Content Type | Key Fields | Owner | Appears In | Gaps |
|---|---|---|---|---|
| Runtime status | engine status, Codex status, storage status, last run | BE + UI shell | Top status bar | Status schema not defined yet. |
| Route config | id, label, path, enabled state, badge/state | BE + UI shell | Sidebar, router | Needs shared route registry or client convention. |
| App settings | adapter commands, storage path, writer defaults | Settings feature, shell consumes readiness | Settings, status bar | Persistence boundary not implemented. |
| API error | code, message, scope, retryable, details | Engine/shared | Banners, panels, forms | Shared error schema not found. |
| Local app state | selected route, density, sidebar state | Client shell | App shell | Persistence strategy not defined. |

### Service Dependencies

| User Step | Visible System Response | Backstage Process | Owner | Risk |
|---|---|---|---|---|
| Open app | Shell renders with readiness states | Client boot, optional health check | BE + UI shell | If health fails, UI still needs usable partial state. |
| Check engine | Engine ready/failed badge | `GET /health` | Engine server | Current endpoint only returns `{ ok: true }`; not enough for adapter/storage status. |
| Generate from route | Route sends request through API client | `POST /ideas/generate` | Writer engine | Shell needs generic request/error boundary. |
| Use storage-backed views | Storage ready/stale/failed visible | local DB or file store | Engine storage | Storage folder exists but no implementation found. |
| Use Codex-backed views | Codex ready/partial/failed visible | Codex CLI adapter | Codex adapter | Adapter exists but readiness/status contract needs UI flow. |

### Accessibility-Critical Moments

| Flow / State | Risk | Later Test Needed | Notes |
|---|---|---|---|
| App shell navigation | Keyboard route switching can become inconsistent | Keyboard + screen reader | Sidebar labels must remain available when collapsed. |
| Top status changes | Dynamic readiness changes may be missed | `aria-live` check | Use polite updates for status, assertive only for blocking failures. |
| Route loading | Whole app may be blocked accidentally | Keyboard + visual check | Loading must be per route/panel. |
| Error recovery | Focus may not move to actionable retry | Keyboard + focus check | Retry buttons and inline errors need reachable focus order. |

## Feature Inventory

| # | Feature | Description | Persona | JTBD Step | Status | Priority | Source |
|---|---|---|---|---|---|---|---|
| 1 | App shell layout | Provide top status, sidebar navigation, main content, and optional inspector regions. | Founder Writer, Future Feature Implementer | Locate | Design complete | P0 | design-system README, product-screens.md |
| 2 | Client routing | Route between Writer, Voice, Post Library, and Settings without remounting the whole app state unnecessarily. | Founder Writer | Locate | Gap | P0 | product-screens.md, app.tsx |
| 3 | Route placeholders | Provide useful empty/coming-soon states for routes before deeper feature logic exists. | Founder Writer | Prepare | Gap | P0 | product-screens.md |
| 4 | Top runtime status bar | Show engine, Codex adapter, storage, and last-run readiness in a compact persistent status area. | Founder Writer, Codex Operator | Confirm | Design complete | P0 | product-patterns.md |
| 5 | Health/readiness endpoint | Give the client a backend endpoint that reports engine, adapter, and storage readiness. | Codex Operator, Future Feature Implementer | Confirm | Partial | P0 | engine/src/server/server.ts |
| 6 | API client boundary | Provide a typed client-side way to call the local engine and handle errors consistently. | Future Feature Implementer | Execute | Gap | P0 | current client code, shared schemas |
| 7 | Shared app status schema | Define Zod schemas for runtime status and API errors shared between client and engine. | Future Feature Implementer | Confirm | Gap | P0 | shared/src/index.ts |
| 8 | Error boundary and retry UX | Keep the shell mounted when route or backend calls fail and show recoverable errors. | Founder Writer | Modify | Gap | P0 | validation-report.md |
| 9 | Per-panel loading conventions | Use skeletons/spinners inside panels without blocking unrelated routes. | Founder Writer | Monitor | Design complete | P1 | validation-report.md, product-patterns.md |
| 10 | Local UI preferences | Persist density, sidebar collapse, and last route locally. | Founder Writer | Conclude | Gap | P1 | product-screens.md |
| 11 | Storage readiness boundary | Surface whether local persistence is ready, stale, or failed. | Founder Writer, Codex Operator | Confirm | Mentioned | P1 | README, product-screens.md |
| 12 | Settings shell section | Provide the first Settings screen for adapter command, storage path, and feature readiness. | Founder Writer | Prepare | Design complete | P1 | product-screens.md |
| 13 | E2E smoke coverage | Verify app loads, navigation works, and status bar is visible. | Future Feature Implementer | Confirm | Partial | e2e writer smoke test |
| 14 | Dev server workflow | Let Codex/user start the local app and inspect UI quickly. | Codex Operator | Prepare | Partial | package.json |

## Gaps Identified

### Missing from implementation

- Client routing: `App` currently renders only `WriterPage`.
- Shared runtime status schema: no schema found for health, adapter status, storage status, or API errors.
- Status aggregation: `/health` only returns `{ ok: true }`, not a useful UI-ready readiness model.
- App shell: no sidebar, top status bar, route header, layout regions, or settings route in client code.
- Error boundary: no route-level or API-level recovery surface found.
- Local UI preferences: no persistence for selected route, sidebar state, or density.
- Storage readiness: `engine/src/storage/.gitkeep` exists, but no storage implementation or readiness contract was found.

### Underspecified

- Should the day-one app use hash routing, browser history routing, or an in-memory route state? Browser routing is preferable, but the local deployment shape may influence this.
- Should the engine server be started separately from the Vite client, or should tooling provide one command for both?
- How much should Settings do in `be-ui-shell` versus the later `codex-adapter` and storage features?
- Whether `/health` should remain a lightweight liveness endpoint while a new `/status` endpoint carries detailed readiness.

### Risky if skipped

- Without a shared API error shape, every feature will invent its own error handling.
- Without route placeholders, later features may build incompatible screen states.
- Without status bar semantics, Codex unavailable can be confused with full app failure.
- Without e2e shell coverage, layout regressions will be hard to catch before feature work piles up.

## Recommended Flow List

### Critical - map first

1. App boot and readiness check - user opens local app, shell loads, backend status resolves, partial state remains usable.
2. Navigate between phase 1 routes - user moves among Writer, Voice, Post Library, and Settings with stable shell chrome.
3. Backend unavailable recovery - app opens but engine health/status fails; user sees recovery without losing the UI.
4. Settings readiness repair - user opens Settings to inspect or repair Codex/storage configuration and returns to work.

### Important - map second

5. Route loading and placeholder states - routes render useful empty/loading/coming-soon states before feature logic is complete.
6. API request error handling - a route calls local engine, receives validation/runtime error, and recovers inline.
7. Local UI preference persistence - density/sidebar/last route survive reload.
8. E2E shell smoke path - automated path verifies shell load, navigation, and status visibility.

### Deferred

9. Command palette - specified by design system but not needed before basic route shell.
10. Inspector drawer collapse - useful for Writer/Judge but can be finalized when writer and judge UI are built.
11. My Analytics and Signals navigation - include as disabled/deferred routes only when phase 2 begins.

## Open Questions

1. Should the local app run as two dev processes (`client` and `engine`) or should `tools` provide a single `pnpm dev:local` orchestration command?
2. Should detailed readiness live at `/status` while `/health` remains liveness-only?
3. Should Settings be a real editable route in this epic, or only a read-only readiness screen until `codex-adapter` lands?
4. Should route state persist in URL paths from day one, or is in-memory navigation acceptable for the first implementation slice?
5. What exact local storage target do we want first: SQLite, JSON file, or in-memory placeholder with the storage boundary shaped for SQLite later?

## Review Gate

I recommend mapping the four critical flows next:

1. App boot and readiness check.
2. Navigate between phase 1 routes.
3. Backend unavailable recovery.
4. Settings readiness repair.

Approval needed before Stage 2:

- Confirm these are the right first flows.
- Decide whether Settings is editable or read-only in this epic.
- Decide whether route state must be URL-backed from the first implementation.

