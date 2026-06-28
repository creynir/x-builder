/**
 * ExposeFunctionTransport (XOB-016) — registers all 20 `__xbuilder_<method>`
 * bindings on a Playwright page and routes each call, in-process, to the matching
 * engine service.
 *
 * Each handler:
 *   1. parses the raw structured-clone arg with the method's shared *request*
 *      schema (no-arg methods ignore the arg; `getCooldown` parses an optional
 *      `{ windowDays? }` and forwards `windowDays` — or `undefined` — to the
 *      service),
 *   2. calls the bound service method / passed-in handler with the parsed request,
 *   3. parses the result with the method's shared *response* schema, and
 *   4. returns the validated, structured-clone-safe JSON.
 *
 * Zod errors propagate. An input-schema failure rejects before the service is
 * called; an output-schema failure rejects as a contract bug. Nothing is
 * swallowed.
 *
 * The transport is stateless and depends only on `@x-builder/shared` request /
 * response types — it imports no engine classes. The real-service adapter bundle
 * and the `RunnerApp.bindTransport` wiring live in XOB-030 / XOB-015.
 */

import {
  ENGINE_TRANSPORT_BINDINGS,
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  appStatusSchema,
  applyJudgeSuggestionsRequestSchema,
  applyJudgeSuggestionsResponseSchema,
  activeArchiveContextSchema,
  archiveContextActivationResponseSchema,
  archiveTweetsImportRequestSchema,
  archiveTweetsImportResponseSchema,
  archiveTweetsValidateRequestSchema,
  archiveTweetsValidateResponseSchema,
  captureSummarySchema,
  cooldownReportSchema,
  generateCategorySchema,
  generateIdeaRequestSchema,
  generateIdeaResponseSchema,
  getFeedbackLoopSummaryRequestSchema,
  getFeedbackLoopSummaryResponseSchema,
  judgeDraftRequestSchema,
  judgeDraftResponseSchema,
  linkFeedbackPredictionRequestSchema,
  linkFeedbackPredictionResponseSchema,
  overlayReadinessSchema,
  recordFeedbackPredictionRequestSchema,
  recordFeedbackPredictionResponseSchema,
  suggestPostRequestSchema,
  suggestPostResponseSchema,
} from "@x-builder/shared";
import type {
  ActiveArchiveContext,
  AnalyzePostsRequest,
  AnalyzePostsResponse,
  AppSettings,
  AppSettingsResponse,
  AppStatus,
  ApplyJudgeSuggestionsRequest,
  ApplyJudgeSuggestionsResponse,
  ArchiveContextActivationResponse,
  ArchiveTweetsImportRequest,
  ArchiveTweetsImportResponse,
  ArchiveTweetsValidateRequest,
  ArchiveTweetsValidateResponse,
  CaptureSummary,
  CooldownReport,
  GenerateCategory,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
  GetFeedbackLoopSummaryRequest,
  GetFeedbackLoopSummaryResponse,
  JudgeDraftRequest,
  JudgeDraftResponse,
  LinkFeedbackPredictionRequest,
  LinkFeedbackPredictionResponse,
  OverlayReadiness,
  RecordFeedbackPredictionRequest,
  RecordFeedbackPredictionResponse,
  SuggestPostRequest,
  SuggestPostResponse,
} from "@x-builder/shared";

/**
 * Minimal structural surface of the Playwright `Page` the binder touches. A real
 * `Page` is structurally assignable, so the binder is unit-testable without a
 * live browser.
 */
export interface PageLike {
  exposeFunction(name: string, handler: (arg: unknown) => unknown): Promise<void>;
}

/**
 * The aggregate of engine services / handlers the transport routes to. Defined
 * structurally against `@x-builder/shared` request/response types — it imports no
 * engine classes. `RunnerApp` (XOB-015) constructs the real implementations and
 * passes them in.
 */
export interface BoundEngineServices {
  getStatus: () => Promise<AppStatus>;
  getOverlayReadiness: () => Promise<OverlayReadiness>;
  settingsRepository: {
    getSettings(): Promise<AppSettingsResponse>;
    updateSettings(request: AppSettings): Promise<AppSettingsResponse>;
  };
  archiveImportService: {
    validate(request: ArchiveTweetsValidateRequest): Promise<ArchiveTweetsValidateResponse>;
    import(request: ArchiveTweetsImportRequest): Promise<ArchiveTweetsImportResponse>;
  };
  archiveDerivedContextService: {
    getActiveContext(): Promise<ActiveArchiveContext>;
    activateContext(): Promise<ArchiveContextActivationResponse>;
    deactivateContext(): Promise<ArchiveContextActivationResponse>;
  };
  liveContextResolver: {
    mergeAnalysisRequest(request: AnalyzePostsRequest): Promise<AnalyzePostsRequest>;
  };
  archiveStudioContextResolver: {
    mergeAnalysisRequest(request: AnalyzePostsRequest): Promise<AnalyzePostsRequest>;
  };
  deterministicAnalysisService: {
    analyzePosts(request: AnalyzePostsRequest): Promise<AnalyzePostsResponse>;
  };
  judgeDraftService: {
    judge(request: JudgeDraftRequest): Promise<JudgeDraftResponse>;
  };
  generateIdeasService: {
    generate(request: GenerateIdeaRequest): Promise<GenerateIdeaResponse>;
  };
  suggestPostService: {
    suggest(request: SuggestPostRequest): Promise<SuggestPostResponse>;
  };
  repetitionWindowService: {
    compute(windowDays?: number): Promise<CooldownReport>;
  };
  liveCaptureService: {
    summary(): Promise<CaptureSummary>;
  };
  generateCategoryService: {
    getCategories(): Promise<GenerateCategory[]>;
  };
  applyJudgeSuggestionsService: {
    apply(request: ApplyJudgeSuggestionsRequest): Promise<ApplyJudgeSuggestionsResponse>;
  };
  feedbackLoopService: {
    recordPrediction(request: RecordFeedbackPredictionRequest): Promise<RecordFeedbackPredictionResponse>;
    linkPrediction(request: LinkFeedbackPredictionRequest): Promise<LinkFeedbackPredictionResponse>;
    getSummary(request?: GetFeedbackLoopSummaryRequest): Promise<GetFeedbackLoopSummaryResponse>;
  };
}

/** Handler signature each binding registers. */
type ExposedHandler = (rawArg: unknown) => Promise<unknown>;

/**
 * Extracts the optional `windowDays` from `getCooldown`'s raw arg. The arg is
 * absent (`undefined`/`null`) for the default window or an object carrying an
 * optional numeric `windowDays`. A non-object arg, or a non-numeric `windowDays`,
 * is a contract violation and throws. The numeric value itself is range-validated
 * downstream by `repetitionWindowService.compute` / `cooldownReportSchema`.
 */
function parseGetCooldownArg(rawArg: unknown): number | undefined {
  if (rawArg === undefined || rawArg === null) {
    return undefined;
  }
  if (typeof rawArg !== "object") {
    throw new TypeError(`getCooldown expects an object arg or none, received ${typeof rawArg}.`);
  }
  const windowDays = (rawArg as { windowDays?: unknown }).windowDays;
  if (windowDays === undefined) {
    return undefined;
  }
  if (typeof windowDays !== "number" || Number.isNaN(windowDays)) {
    throw new TypeError("getCooldown windowDays must be a number when provided.");
  }
  return windowDays;
}

/**
 * Build the method-name → handler map. Each entry closes over `services` and
 * performs request parse → service call → response parse.
 */
function buildHandlers(services: BoundEngineServices): Readonly<Record<string, ExposedHandler>> {
  return {
    getOverlayReadiness: async () => overlayReadinessSchema.parse(await services.getOverlayReadiness()),

    getStatus: async () => appStatusSchema.parse(await services.getStatus()),

    getSettings: async () =>
      appSettingsResponseSchema.parse(await services.settingsRepository.getSettings()),

    updateSettings: async (rawArg) => {
      const request = appSettingsSchema.parse(rawArg);
      return appSettingsResponseSchema.parse(await services.settingsRepository.updateSettings(request));
    },

    validateArchive: async (rawArg) => {
      const request = archiveTweetsValidateRequestSchema.parse(rawArg);
      return archiveTweetsValidateResponseSchema.parse(await services.archiveImportService.validate(request));
    },

    importArchive: async (rawArg) => {
      const request = archiveTweetsImportRequestSchema.parse(rawArg);
      return archiveTweetsImportResponseSchema.parse(await services.archiveImportService.import(request));
    },

    getActiveContext: async () =>
      activeArchiveContextSchema.parse(await services.archiveDerivedContextService.getActiveContext()),

    activateContext: async () =>
      archiveContextActivationResponseSchema.parse(
        await services.archiveDerivedContextService.activateContext(),
      ),

    deactivateContext: async () =>
      archiveContextActivationResponseSchema.parse(
        await services.archiveDerivedContextService.deactivateContext(),
      ),

    analyzePosts: async (rawArg) => {
      const request = analyzePostsRequestSchema.parse(rawArg);
      const merged = await services.liveContextResolver.mergeAnalysisRequest(request);
      const merged2 = await services.archiveStudioContextResolver.mergeAnalysisRequest(merged);
      const response = await services.deterministicAnalysisService.analyzePosts(merged2);
      return analyzePostsResponseSchema.parse(response);
    },

    judgeDraft: async (rawArg) => {
      const request = judgeDraftRequestSchema.parse(rawArg);
      return judgeDraftResponseSchema.parse(await services.judgeDraftService.judge(request));
    },

    generateIdeas: async (rawArg) => {
      const request = generateIdeaRequestSchema.parse(rawArg);
      return generateIdeaResponseSchema.parse(await services.generateIdeasService.generate(request));
    },

    suggestPost: async (rawArg) => {
      const request = suggestPostRequestSchema.parse(rawArg);
      return suggestPostResponseSchema.parse(await services.suggestPostService.suggest(request));
    },

    getCooldown: async (rawArg) => {
      const windowDays = parseGetCooldownArg(rawArg);
      return cooldownReportSchema.parse(await services.repetitionWindowService.compute(windowDays));
    },

    getCaptureSummary: async () =>
      captureSummarySchema.parse(await services.liveCaptureService.summary()),

    getGenerateCategories: async () =>
      generateCategorySchema.array().parse(await services.generateCategoryService.getCategories()),

    applyJudgeSuggestions: async (rawArg) => {
      const request = applyJudgeSuggestionsRequestSchema.parse(rawArg);
      return applyJudgeSuggestionsResponseSchema.parse(
        await services.applyJudgeSuggestionsService.apply(request),
      );
    },

    recordFeedbackPrediction: async (rawArg) => {
      const request = recordFeedbackPredictionRequestSchema.parse(rawArg);
      return recordFeedbackPredictionResponseSchema.parse(
        await services.feedbackLoopService.recordPrediction(request),
      );
    },

    linkFeedbackPrediction: async (rawArg) => {
      const request = linkFeedbackPredictionRequestSchema.parse(rawArg);
      return linkFeedbackPredictionResponseSchema.parse(
        await services.feedbackLoopService.linkPrediction(request),
      );
    },

    getFeedbackLoopSummary: async (rawArg) => {
      const request = getFeedbackLoopSummaryRequestSchema.parse(rawArg ?? {});
      return getFeedbackLoopSummaryResponseSchema.parse(
        await services.feedbackLoopService.getSummary(request),
      );
    },
  };
}

/**
 * Registers all 20 `__xbuilder_<method>` engine bindings on a page, each routing
 * to the matching engine service with request/response Zod validation.
 */
export class ExposeFunctionTransport {
  static async bindAll(page: PageLike, services: BoundEngineServices): Promise<void> {
    const handlers = buildHandlers(services);

    const handlerFor = (method: string): ExposedHandler => {
      const handler = handlers[method];
      if (handler === undefined) {
        throw new Error(`No handler implemented for transport method "${method}".`);
      }
      return handler;
    };

    for (const method of Object.keys(ENGINE_TRANSPORT_BINDINGS)) {
      const bindingName = ENGINE_TRANSPORT_BINDINGS[method];
      if (bindingName === undefined) {
        throw new Error(`No binding name registered for transport method "${method}".`);
      }
      await page.exposeFunction(bindingName, handlerFor(method));
    }
  }
}
