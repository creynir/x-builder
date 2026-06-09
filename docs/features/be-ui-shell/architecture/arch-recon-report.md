# Arch Recon Report: BE + Simple UI Shell

Date: 2026-06-06

Status: approved by arch-recon validation

Linear: not used. This report and tickets are local docs only.

## Inputs

- [Flow Spec Checklist](../spec/checklist.md)
- [Screen List](../spec/screen-list.md)
- [App Shell Spec](../spec/app-shell.md)
- [Top Status Bar Spec](../spec/top-status-bar.md)
- [Route Error Banner Spec](../spec/route-error-banner.md)
- [Sidebar Nav Spec](../spec/sidebar-nav.md)
- [Settings Route Spec](../spec/settings-route.md)
- [Writer Route Shell Integration Spec](../spec/writer-route-shell-integration.md)
- [Voice Route Placeholder Spec](../spec/voice-route-placeholder.md)
- [Post Library Route Placeholder Spec](../spec/post-library-route-placeholder.md)
- [Flow Maps](../map/02-flow-index.md)
- [Design System](../../../design-system/README.md)

## Architecture Decision

Build `be-ui-shell` as a small contract-first shell boundary.

Backend work stays inside the existing Fastify engine shape: direct route handlers, shared Zod schemas, and Vitest/Fastify `app.inject` tests. Add detailed readiness at `GET /status`, keep `GET /health` as liveness-only, normalize all engine errors into `apiErrorSchema`, and add a narrow engine-side settings persistence boundary.

Frontend work stays as a thin owned shell around URL-backed routes. Do not introduce a heavy router or server-state library in this slice. Use a small route registry, browser History API wrappers, typed API helpers, local route state, and client-local shell preferences. The design-system components are documented contracts; implementation should build them to those contracts rather than assume importable UI primitives already exist.

Stage 3 mockups were intentionally skipped. Implementation must use the design-system tokens and include browser QA for App Shell density, Settings layout, and Route Error Banner placement.

## Existing Patterns

- Shared contracts live in `shared/src/schemas/*` as Zod schemas and are exported from `shared/src/index.ts`.
- Engine HTTP routes are direct Fastify handlers in `engine/src/server/server.ts`.
- Existing request validation uses shared schema `.parse`.
- Writer generation delegates to `generateCandidates`.
- Engine tests use Vitest and Fastify `app.inject`.
- Client is React/Vite and currently renders `WriterPage` directly from `App`.
- Client tests are lightweight Vitest tests; E2E uses Playwright.

## Shared Contracts

Add a shell schema module under `shared/src/schemas/shell.ts` and export it from `shared/src/index.ts`.

```ts
export const readinessStateSchema = z.enum([
  "checking",
  "ready",
  "partial",
  "unavailable",
  "failed",
  "stale",
  "disabled",
  "unconfigured"
]);

export const subsystemStatusSchema = z.object({
  state: readinessStateSchema,
  label: z.string().min(1).max(80),
  message: z.string().max(240).optional(),
  retryable: z.boolean().default(true),
  checkedAt: z.string().datetime(),
  details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({})
});

export const appStatusSchema = z.object({
  overall: z.enum(["ready", "partial", "unavailable"]),
  version: z.string().min(1),
  generatedAt: z.string().datetime(),
  engine: subsystemStatusSchema,
  deterministic: subsystemStatusSchema,
  codex: subsystemStatusSchema,
  storage: subsystemStatusSchema,
  lastRun: z.object({
    state: z.enum(["none", "completed", "failed", "unknown"]),
    completedAt: z.string().datetime().optional(),
    ideaId: z.string().optional()
  })
});

export const apiErrorSchema = z.object({
  code: z.enum([
    "validation_failed",
    "engine_unreachable",
    "request_timeout",
    "invalid_response",
    "status_unavailable",
    "settings_load_failed",
    "settings_persist_failed",
    "generation_failed",
    "not_found",
    "internal_error"
  ]),
  message: z.string().min(1).max(240),
  scope: z.enum(["app", "status", "settings", "writer", "route", "field"]),
  retryable: z.boolean(),
  status: z.number().int().min(100).max(599).optional(),
  fieldErrors: z.record(z.array(z.string())).optional(),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().optional()
});

export const appSettingsSchema = z.object({
  engineBaseUrl: z.string().url().refine((url) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)),
  storagePath: z.string().min(1).max(4096),
  codexCommandLabel: z.string().min(1).max(80).default("Codex judge"),
  runCodexJudgeAfterGeneration: z.boolean().default(false),
  showDeterministicDetails: z.boolean().default(true)
});

export const appSettingsResponseSchema = z.object({
  settings: appSettingsSchema,
  source: z.enum(["persisted", "defaults"]),
  updatedAt: z.string().datetime().optional()
});

export const routeConfigSchema = z.object({
  id: z.enum(["writer", "voice", "library", "settings"]),
  label: z.string().min(1).max(40),
  path: z.enum(["/writer", "/voice", "/library", "/settings"]),
  title: z.string().min(1).max(60),
  enabled: z.boolean(),
  placeholder: z.boolean(),
  navOrder: z.number().int().min(0),
  requiresBackend: z.boolean().default(false)
});
```

Route registry is a shared/client contract: schema in `shared`, concrete registry in `client`. There is no route registry endpoint.

## API Design

| Endpoint | Auth | Success | Errors |
|---|---|---|---|
| `GET /health` | Public local-only | `200 { ok: true }` | `500 apiErrorSchema` only on handler failure |
| `GET /status` | Public local-only | `200 appStatusSchema` | `500 internal_error`; network failure classified by client |
| `GET /settings` | Public local-only | `200 appSettingsResponseSchema` | `500 settings_load_failed` |
| `PATCH /settings` | Public local-only | `200 appSettingsResponseSchema` | `400 validation_failed`, `500 settings_persist_failed` |
| `POST /ideas/generate` | Public local-only | `200 generateIdeaResponseSchema` | `400 validation_failed`, `500 generation_failed` |

Auth decision: no user auth in this local founder tool epic. The server must bind to `127.0.0.1`. If CORS is enabled, allow only known local client origins.

HTTP error mapping:

- Zod request parse failure: `400 validation_failed`.
- Unknown route: `404 not_found`.
- Readiness service failure: `500 status_unavailable` or `500 internal_error`.
- Settings load failure: `500 settings_load_failed`.
- Settings validation failure: `400 validation_failed`.
- Settings persist failure: `500 settings_persist_failed`.
- Writer generation failure: `500 generation_failed`.
- Network timeout or connection refused: client-only `request_timeout` or `engine_unreachable`.
- Response parse failure: client-only `invalid_response`.

## Backend Components

### `AppSettingsRepository`

Responsibilities:

- Load persisted app settings.
- Return defaults when no persisted settings exist.
- Save validated app settings.
- Hide first storage choice behind a narrow interface.

Interface:

```ts
interface AppSettingsRepository {
  load(): Promise<{ settings: AppSettings; source: "persisted" | "defaults"; updatedAt?: string }>;
  save(settings: AppSettings): Promise<{ settings: AppSettings; source: "persisted"; updatedAt: string }>;
  defaults(): AppSettings;
}
```

First implementation: JSON/file-backed using an isolated configurable root for tests. SQLite can replace it later without changing API contracts.

### `ReadinessService`

Responsibilities:

- Produce `AppStatus`.
- Keep deterministic engine readiness independent of Codex/storage readiness.
- Avoid blocking the app when one subsystem fails.
- Avoid running a full Codex judge during `/status`.

Interface:

```ts
interface ReadinessService {
  getStatus(settings: AppSettings): Promise<AppStatus>;
}
```

Readiness checks should run in parallel with an overall target under 1s. Codex readiness may use a short command availability check or return partial/unconfigured from settings. Storage readiness checks path availability/writability without creating feature data.

### `ApiErrorClassifier`

Responsibilities:

- Convert Zod errors, 404s, and unknown errors into `apiErrorSchema`.
- Avoid stack traces or raw stderr in client responses.
- Provide field-level validation payloads when possible.

Interface:

```ts
interface ApiErrorClassifier {
  fromUnknown(error: unknown, scope: ApiError["scope"]): ApiError;
  fromZod(error: ZodError, scope: ApiError["scope"]): ApiError;
}
```

## Frontend Components

### Component Tree

```txt
App
`-- ShellProviders
    |-- RouteProvider / route registry
    |-- StatusProvider / useAppStatus
    |-- ShellPreferencesProvider
    `-- AppShell
        |-- SkipLink
        |-- TopStatusBar
        |-- SidebarNav
        `-- main#main-content
            |-- PageHeader
            |-- RouteErrorBoundary
            |   |-- RouteErrorBanner
            |   `-- RouteOutlet
            |       |-- WriterRoute
            |       |-- SettingsRoute
            |       |-- VoicePlaceholderRoute
            |       `-- LibraryPlaceholderRoute
            `-- ToastRegion
```

### Route and Shell Types

```ts
type RouteId = "writer" | "voice" | "library" | "settings";
type Density = "compact" | "default" | "comfortable";

interface RouteConfig {
  id: RouteId;
  path: "/writer" | "/voice" | "/library" | "/settings";
  label: string;
  icon: React.ComponentType;
  enabled: boolean;
  placeholder?: boolean;
  title: string;
}

interface ShellPreferences {
  sidebarCollapsed: boolean;
  density: Density;
  lastRouteId: RouteId;
}
```

Default `/` behavior: redirect to `/writer` to keep the URL canonical. Unknown routes also resolve to Writer.

### `PageHeader`

`PageHeader` is the design-system definition gap. Define it as a compact route header:

- Exactly one `h1`.
- Optional description.
- Optional back action for Settings recovery.
- Optional right-aligned actions.
- No card wrapper.

```ts
interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  backAction?: { label: string; to: RouteId };
}
```

### API Client

```ts
interface EngineApiClient {
  getStatus(): Promise<AppStatus>;
  getSettings(): Promise<AppSettingsResponse>;
  saveSettings(input: AppSettings): Promise<AppSettingsResponse>;
  generateIdea(input: GenerateIdeaRequest): Promise<GenerateIdeaResponse>;
}
```

Every server response crossing into client code is parsed by the matching shared schema. Parse failures become `invalid_response` route errors.

## State Design

- URL state: current route, unknown route fallback, previous route context for Settings recovery.
- Server state: status, settings, and generation API calls through typed hooks with `AbortController`, schema parsing, retry, stale previous value, and explicit `loading/error/data` fields.
- Local route state: Writer idea input, pending generation payload, candidate result, route-local banner, Settings dirty fields, validation errors, and readiness test pending state.
- Client preference state: only `sidebarCollapsed`, `density`, and `lastRouteId`; persisted to local storage with in-memory fallback.

Do not add Zustand or a server-state dependency in this slice.

## Data Flows

### App Boot

1. Browser opens `/`, `/writer`, `/voice`, `/library`, `/settings`, or unknown route.
2. Route registry resolves route; `/` and unknown routes resolve to `/writer`.
3. App Shell renders immediately.
4. Client calls `GET /status`.
5. `ReadinessService` builds `AppStatus`.
6. Top Status Bar shows ready, partial, unavailable, stale, or failed states.
7. Route remains interactive regardless of status outcome.

### Settings Repair

1. User opens Settings from nav, status, route error, or direct URL.
2. Client calls `GET /settings`.
3. Repository returns persisted settings or defaults.
4. User edits fields; client validates shape and dirty state.
5. User saves via `PATCH /settings`.
6. Repository persists settings or returns normalized error.
7. User tests readiness by refreshing `/status`.
8. Settings never auto-returns; user uses explicit Back to Writer/previous route.

### Writer Generate

1. User enters an idea.
2. Client validates required non-empty idea.
3. Client posts typed payload to `/ideas/generate`.
4. Server validates `generateIdeaRequestSchema`.
5. `generateCandidates` returns exactly three candidates.
6. Client parses `generateIdeaResponseSchema`.
7. Writer route renders candidates or preserves idea and shows recoverable error.

## Security

- Server binds to `127.0.0.1`.
- No user auth in this local-only epic.
- Do not log request bodies; ideas and local paths can be sensitive.
- Do not expose stack traces, raw Codex stderr, or filesystem internals in client errors.
- Validate all external inputs with shared schemas.
- Treat client validation as UX only; server validation remains authoritative.
- No secrets in code or committed config.

## Performance

- Readiness target: under 1s for combined subsystem checks.
- Ordinary local reads target: under 200ms p95.
- Writes target: under 500ms p95.
- `/status` checks run in parallel where possible.
- `/status` must not execute a Codex judge.
- Keep previous status visible while refresh is pending.
- Lazy-load non-default routes: Settings, Voice placeholder, Library placeholder.
- Keep Writer in the main bundle as the default route.

## Deprecation And Removability

- Settings repository can swap JSON/file storage for SQLite without changing API or UI contracts.
- Route registry can migrate to a router library later behind the owned route contract.
- Voice and Library placeholders are removed by replacing client route entries and route components, not changing backend APIs.
- `PageHeader` remains a small owned component and can be replaced by a richer component later if the props contract stays additive.

## Validator Notes

The arch validator approved the system and UI designs with no P0/P1 blockers.

P2 notes to carry into tickets:

- Design-system components are documented, not implemented in `client/`.
- Implementation tickets should say "implement to design-system contract" rather than assume importable components already exist.
- Keep `PageHeader` explicit because product component docs are thin there.
- Browser QA is required for App Shell density, Settings layout, and Route Error Banner placement.
- Tickets should pin `/status` timeout/refresh policy, placeholder enablement/copy, and storage failure placement.
- System tickets should include exact HTTP status mappings for `apiErrorSchema`.
