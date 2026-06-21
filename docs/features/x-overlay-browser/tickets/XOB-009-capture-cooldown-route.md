---
status: todo
---

# XOB-009: GET /capture/cooldown route

## Implementation Details

Register `GET /capture/cooldown` in `buildServer` (`engine/src/server/server.ts`).

This is a thin HTTP route — no new service, no new class. It delegates entirely to `RepetitionWindowService.compute(windowDays)`.

**Route handler:**

1. Parse `windowDays` from query string: `z.coerce.number().int().min(1).max(90).default(7)`. If the query value is present but fails coercion/validation → `validation_failed` (status 400, existing error helper pattern).
2. Construct (or inject) a `RepetitionWindowService` from `postLibraryRepository`.
3. Call `await windowService.compute(windowDays)`.
4. Return `parseResponseContract(cooldownReportSchema, report)` with status 200.
5. On `PostLibraryStorageError` → `library_storage_failed` (status 500).

**`BuildServerOptions` addition:** `repetitionWindowService?: RepetitionWindowService` — optional injection for tests; default constructed from `postLibraryRepository` + a default `now` function in the runtime composition root.

No in-process binding for this route — `RepetitionWindowService.compute` is consumed in-process directly by `LiveContextResolver` (XOB-007) and `GenerateCategoryService` (XOB-006). The HTTP route exists so the `/writer` fallback and external callers can read cooldown data without instantiating the service in-process.

**`EngineTransport`:** `getCooldown(windowDays?: number): Promise<CooldownReport>` — method 14 — is bound in XOB-016 to `RepetitionWindowService.compute` directly (not via this HTTP route).

## Data Models

From `@x-builder/shared` (XOB-002):

- `cooldownReportSchema` — `{ windowDays, generatedAt, corpusSource: enum(live|archive|merged|empty), signals: CooldownSignal[] }`
- `cooldownSignalSchema` — `{ format: detectedPostFormat, countInWindow: int, windowDays: 1..90, lastPostedAt?: datetime, status: enum(clear|warming|cooldown), message: ≤240 }`

Existing server patterns:

- `parseResponseContract` — used throughout `server.ts` for response validation
- `apiErrorSchema` / `library_storage_failed` error shape — reuses existing `archiveStorageFailedError` pattern, adapted to `library_storage_failed` code

## Integration Point

**`buildServer` wiring** (`engine/src/server/server.ts`):

- `repetitionWindowService?: RepetitionWindowService` added to `BuildServerOptions`.
- Route registered alongside the other `GET` routes (e.g., near `/status`, `/archive/context/active`).
- A single shared `RepetitionWindowService` instance should be passed to both this route and `LiveContextResolver` (XOB-007) when constructing the server in the runtime composition root, to avoid reading the store twice per analyze call.

**`EngineTransport`** (XOB-002 / XOB-016): `getCooldown(windowDays?)` binding → calls `windowService.compute(windowDays ?? 7)` in-process. This ticket only adds the HTTP side; the binding is XOB-016's responsibility.

## Scope Boundaries / Out of Scope

- No new service or class — purely a thin route handler.
- No in-process `__xbuilder_getCooldown` binding in this ticket (XOB-016).
- `windowDays` default of 7 is applied at the route level via Zod coercion; the service itself accepts any positive integer.
- No authentication — localhost-only, consistent with all other engine routes.
- The `corpusSource` field in the response is computed by `RepetitionWindowService.compute`; the route does not override it.

## Test Strategy & Fixture Ownership

**Suite:** `engine/src/server/tests/capture-cooldown.test.ts` (Vitest)

**Setup:** `buildServer({ repetitionWindowService, ... }).inject()` pattern — mirrors `posts-analyze.test.ts` and `archive-routes.test.ts`. Seed a `RepetitionWindowService` backed by a tmpdir `JsonFilePostLibraryRepository`.

**LLM dependency:** none.

**Dependency category:** integration (disk I/O + route).

**Isolation:** `mkdtemp` tmpdir per test; `buildServer()` injected; cleaned up in `afterEach`.

Coverage:

1. Seeded corpus with 4 `hot_take` originals in last 7 days → `GET /capture/cooldown?windowDays=7` → status 200, `cooldownReportSchema` valid, signal for `hot_take` with `status: "cooldown"`.
2. Empty corpus → status 200, `corpusSource: "empty"`, `signals: []`.
3. Default `windowDays` (no query param) → status 200, `report.windowDays === 7`.
4. `windowDays=30` → status 200, `report.windowDays === 30`.
5. `windowDays=0` (invalid, below min 1) → status 400, `code: "validation_failed"`.
6. `windowDays=91` (invalid, above max 90) → status 400, `code: "validation_failed"`.
7. `PostLibraryStorageError` thrown by injected service → status 500, `code: "library_storage_failed"`.

## Definition of Done

- `GET /capture/cooldown` route registered in `buildServer`.
- All tests in the coverage list pass.
- TypeScript strict-mode clean (`pnpm typecheck` green).
- Existing route tests in `server/tests/` remain green.

## Acceptance Criteria

**Given** a corpus with 4 `hot_take` original posts dated within the last 7 days

**When** `GET /capture/cooldown?windowDays=7` is called

**Then** status 200 and the response parses as `cooldownReportSchema` with a `hot_take` signal having `status: "cooldown"` and `countInWindow: 4`.

---

**Given** an unreadable post library store (e.g., corrupt `post-library.json`)

**When** `GET /capture/cooldown` is called

**Then** status 500 with `code: "library_storage_failed"` in the error envelope.

---

**Given** no `windowDays` query parameter

**When** `GET /capture/cooldown` is called

**Then** status 200 with `report.windowDays === 7` (default applied).

---

**Given** `?windowDays=0` in the query string

**When** `GET /capture/cooldown` is called

**Then** status 400 with `code: "validation_failed"`.

## Edge Cases

- `windowDays` as a non-numeric string (e.g., `?windowDays=abc`) → `z.coerce.number()` fails → status 400, `validation_failed`.
- `windowDays` as a float (e.g., `?windowDays=7.5`) → `z.coerce.number().int()` fails → status 400, `validation_failed`.
- Empty corpus → valid 200 response with `corpusSource: "empty"` and `signals: []`; no error.
- `windowDays=90` (max) → status 200, service computes window correctly.
- Corpus with only archive posts (no live capture) → `corpusSource: "archive"`, signals computed from archive post `createdAt` values.
