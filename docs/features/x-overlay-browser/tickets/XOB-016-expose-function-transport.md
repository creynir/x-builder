---
status: in-progress
---

# XOB-016: ExposeFunctionTransport — bind all 17 `__xbuilder_*` to engine services in-process

## Implementation Details

**Package:** `@x-builder/runner` (`runner/src/expose-function-transport.ts`)

**Exported symbol:**

```ts
class ExposeFunctionTransport {
  static async bindAll(page: Page, services: BoundEngineServices): Promise<void>
}
```

`bindAll` calls `page.exposeFunction("__xbuilder_<method>", handler)` for all 17 methods in the `EngineTransport` interface. Each handler receives a structured-clone JSON argument (or `undefined`), validates it against the method's request schema, calls the corresponding in-process engine service, validates the response against the method's response schema, and returns the structured-clone JSON result.

**Note:** This ticket consumes all engine services built in XOB-004 through XOB-013. `BoundEngineServices` aggregates them all.

### Complete binding→service map (all 17, authoritative per §15.1 + §16.7)

| Binding name | Service / handler |
|---|---|
| `__xbuilder_getOverlayReadiness` | Delegated to `RunnerApp` / composed externally; stub must resolve to a valid `OverlayReadinessSchema` object. See note below. |
| `__xbuilder_getStatus` | `AppStatusService.getStatus()` (existing HTTP `/status` handler logic, called in-process) |
| `__xbuilder_getSettings` | `JsonFileAppSettingsRepository.getSettings()` |
| `__xbuilder_updateSettings` | `JsonFileAppSettingsRepository.updateSettings(req)` |
| `__xbuilder_validateArchive` | `ArchiveImportService.validate(req)` |
| `__xbuilder_importArchive` | `ArchiveImportService.import(req)` |
| `__xbuilder_getActiveContext` | `ArchiveDerivedContextService.getActiveContext()` |
| `__xbuilder_activateContext` | `ArchiveDerivedContextService.activateContext()` |
| `__xbuilder_deactivateContext` | `ArchiveDerivedContextService.deactivateContext()` |
| `__xbuilder_analyzePosts` | `LiveContextResolver.mergeAnalysisRequest(req)` → `ArchiveStudioContextResolver.mergeAnalysisRequest(merged)` → `DeterministicAnalysisService.analyzePosts(merged)` → attach per-item cooldown from `RepetitionWindowService.compute(windowDays)` |
| `__xbuilder_judgeDraft` | `JudgeDraftService.judge(req.text, req.accountProfile)` |
| `__xbuilder_generateIdeas` | `GenerateIdeasService.generate(req)` |
| `__xbuilder_suggestPost` | `SuggestPostService.suggest(req)` |
| `__xbuilder_getCooldown` | `RepetitionWindowService.compute(req?.windowDays)` |
| `__xbuilder_getCaptureSummary` | `LiveCaptureService.summary()` |
| `__xbuilder_getGenerateCategories` | `GenerateCategoryService.getCategories()` |
| `__xbuilder_applyJudgeSuggestions` | `ApplyJudgeSuggestionsService.apply(req)` |

**`getOverlayReadiness` note:** The full readiness composition (engine subsystems + observer capture state) is assembled by `RunnerApp` (XOB-017) and passed in as a handler via `BoundEngineServices.getOverlayReadiness`. `ExposeFunctionTransport` treats it like any other binding — receives the handler function and registers it. This keeps `ExposeFunctionTransport` stateless and testable without a live observer.

### Handler implementation pattern (apply to every binding)

```ts
page.exposeFunction("__xbuilder_<method>", async (rawArg: unknown) => {
  const req = <requestSchema>.parse(rawArg);   // throws ZodError on invalid input
  const res = await services.<service>.<method>(req);
  return <responseSchema>.parse(res);          // validate outbound shape
});
```

- **Input validation:** `<requestSchema>.parse(rawArg)` — throws `ZodError` if invalid. Playwright's `exposeFunction` will surface the error to the overlay caller as a rejected promise. Do not swallow Zod errors silently.
- **Output validation:** `<responseSchema>.parse(res)` — validates outbound shape (mirrors `parseResponseContract` used on HTTP routes). A parse failure here indicates an engine contract bug and should propagate as an Error.
- **No-arg methods** (e.g. `getOverlayReadiness`, `getStatus`, `getSettings`, `getActiveContext`, `activateContext`, `deactivateContext`, `getCaptureSummary`, `getGenerateCategories`): `rawArg` is `undefined` or `null`; call the service directly with no argument.
- **Optional-arg methods** (`getCooldown`): parse `rawArg` with `z.object({ windowDays: z.number().optional() }).optional()`.
- All date-time values crossing the boundary are ISO 8601 strings (structured-clone JSON only — no `Date` objects).

### `BoundEngineServices` type

```ts
interface BoundEngineServices {
  getOverlayReadiness: () => Promise<OverlayReadiness>;
  appStatusService: AppStatusService;
  settingsRepository: JsonFileAppSettingsRepository;
  archiveImportService: ArchiveImportService;
  archiveDerivedContextService: ArchiveDerivedContextService;
  liveContextResolver: LiveContextResolver;
  archiveStudioContextResolver: ArchiveStudioContextResolver;
  deterministicAnalysisService: DeterministicAnalysisService;
  judgeDraftService: JudgeDraftService;
  generateIdeasService: GenerateIdeasService;
  suggestPostService: SuggestPostService;
  repetitionWindowService: RepetitionWindowService;
  liveCaptureService: LiveCaptureService;
  generateCategoryService: GenerateCategoryService;
  applyJudgeSuggestionsService: ApplyJudgeSuggestionsService;
}
```

Constructed by `RunnerApp.start()` (XOB-015) and passed in here.

## Data Models

All request/response schemas come from `@x-builder/shared` (defined in XOB-002). No new schemas are introduced by this ticket.

The full set of schemas consumed:

- `overlayReadinessSchema`, `appStatusSchema`, `appSettingsResponseSchema`, `appSettingsSchema`
- `archiveTweetsValidateRequestSchema`, `archiveTweetsValidateResponseSchema`
- `archiveTweetsImportRequestSchema`, `archiveTweetsImportResponseSchema`
- `activeArchiveContextSchema`, `archiveContextActivationResponseSchema`
- `analyzePostsRequestSchema`, `analyzePostsResponseSchema`
- `judgeDraftRequestSchema`, `judgeDraftResponseSchema`
- `generateIdeaRequestSchema`, `generateIdeaResponseSchema`
- `suggestPostRequestSchema`, `suggestPostResponseSchema`
- `cooldownReportSchema` (for `getCooldown`)
- `captureSummarySchema`
- `generateCategorySchema` (array)
- `applyJudgeSuggestionsRequestSchema`, `applyJudgeSuggestionsResponseSchema`

## Integration Point

**Entry:** `RunnerApp.start()` (XOB-015) calls:

```ts
await ExposeFunctionTransport.bindAll(this.page, this.services);
```

This is called after `addInitScript` and before `page.goto`. All 17 functions must be registered before the overlay bundle runs.

**Terminal outcome:** All 17 `window.__xbuilder_<method>` functions are registered on the page context. Any call from the overlay's `window.__xbuilder_analyzePosts(req)` (or any other method) synchronously invokes the handler which routes in-process to the matching engine service and returns a schema-validated JSON response.

## Scope Boundaries / Out of Scope

**In scope:**
- Registering all 17 `page.exposeFunction` bindings.
- Input validation (Zod parse on `rawArg`).
- Output validation (Zod parse on service response).
- The `BoundEngineServices` interface definition.

**Out of scope (zero-trace):**
- Engine service implementations — consumed here but implemented in XOB-004 through XOB-013.
- `RunnerApp` construction of services — owned by XOB-015.
- `getOverlayReadiness` composition logic — owned by XOB-017.
- Overlay UI — owned by the `@x-builder/overlay` package.
- HTTP server routes — unchanged; this transport runs only in the runner process.
- No real x.com requests, no GraphQL construction, no auth headers.
- No overlay UI internals; no DOM access from this module.
- MV3 `FetchEngineTransport` — post-v1, zero-trace here.

## Test Strategy & Fixture Ownership

This ticket does not own GraphQL fixtures (those are XOB-014's). The runner E2E is owned by XOB-031.

**Unit tests** (`runner/src/expose-function-transport.test.ts`, Vitest):

- Construct a mock `Page` with a spy on `exposeFunction`.
- Call `ExposeFunctionTransport.bindAll(mockPage, mockServices)`.
- Assert all 17 binding names are registered: `__xbuilder_getOverlayReadiness`, `__xbuilder_getStatus`, `__xbuilder_getSettings`, `__xbuilder_updateSettings`, `__xbuilder_validateArchive`, `__xbuilder_importArchive`, `__xbuilder_getActiveContext`, `__xbuilder_activateContext`, `__xbuilder_deactivateContext`, `__xbuilder_analyzePosts`, `__xbuilder_judgeDraft`, `__xbuilder_generateIdeas`, `__xbuilder_suggestPost`, `__xbuilder_getCooldown`, `__xbuilder_getCaptureSummary`, `__xbuilder_getGenerateCategories`, `__xbuilder_applyJudgeSuggestions`.
- For a sample binding (e.g. `__xbuilder_judgeDraft`): invoke the registered handler with a valid `JudgeDraftRequest` → verify the mock `JudgeDraftService.judge` was called with the parsed arguments and the return value passes `judgeDraftResponseSchema.parse`.
- Invoke a handler with an invalid request shape → verify the handler throws (Zod error propagates, not swallowed).
- Invoke `__xbuilder_getCooldown` with `undefined` and with `{ windowDays: 14 }` → verify both work without type errors.

**Integration test** (owned by XOB-030 `[INT]`): each `__xbuilder_*` binding hits the right service and round-trips its schema in-process (no browser required for that test).

## Definition of Done

- [ ] `ExposeFunctionTransport.bindAll` exported from `runner/src/expose-function-transport.ts`.
- [ ] `BoundEngineServices` interface exported from the same file (or a co-located types file).
- [ ] All 17 bindings registered by `bindAll` — verified by the binding-name unit test.
- [ ] Each handler validates input and output with Zod schemas; Zod errors propagate, not swallowed.
- [ ] Unit tests pass (`pnpm -F @x-builder/runner test`).
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm build` passes for `@x-builder/runner`.

## Acceptance Criteria

**Given** a mock `Page` and a complete `BoundEngineServices` object,  
**When** `ExposeFunctionTransport.bindAll(page, services)` resolves,  
**Then** every one of the 17 binding names (`__xbuilder_getOverlayReadiness` through `__xbuilder_applyJudgeSuggestions`) has been registered on the page via `page.exposeFunction`.

**Given** the bindings are registered and a valid `JudgeDraftRequest` is passed to the `__xbuilder_judgeDraft` handler,  
**When** the handler is invoked,  
**Then** `JudgeDraftService.judge` is called with the correct arguments, and the return value validates against `judgeDraftResponseSchema`.

**Given** an invalid (schema-failing) argument is passed to any binding handler,  
**When** the handler is invoked,  
**Then** a `ZodError` (or wrapped Error) is thrown/rejected — it is never silently swallowed or replaced with an empty success response.

**Given** `__xbuilder_getCooldown` is invoked with no argument (`undefined`),  
**When** the handler runs,  
**Then** `RepetitionWindowService.compute` is called with its default `windowDays` value and returns a valid `CooldownReport`.

## Edge Cases

- `page.exposeFunction` throws if the same name is registered twice on a page → `bindAll` should be called only once per page instance (enforced by `RunnerApp`). If called twice in tests, the second call will throw a Playwright error — do not catch it.
- Structured-clone boundary: all request/response objects must be plain JSON (ISO strings for dates, no `Date` instances, no `undefined` values in object positions — use `null` or omit the key). Zod schemas at the boundary enforce this.
- `analyzePosts` routing is a multi-step chain (`LiveContextResolver` → `ArchiveStudioContextResolver` → `DeterministicAnalysisService` → attach cooldown). The entire chain runs inside the single handler; any step throwing should propagate as an Error to the overlay caller.
- Long-running operations (`judgeDraft`, `generateIdeas`, `applyJudgeSuggestions`) hold the promise open for up to `judgeTimeoutMs` (180 000 ms default). The overlay is responsible for showing a pulsing indicator; the handler does not impose its own additional timeout beyond the service's own.
- `importArchive` receives a file path string (the user selected a file in the overlay settings flow); the handler passes it directly to `ArchiveImportService.import` — no binary blob crosses the boundary.

**Depends on:** XOB-002, XOB-004, XOB-005, XOB-006, XOB-007, XOB-008, XOB-009, XOB-010, XOB-011, XOB-012, XOB-013, XOB-015
