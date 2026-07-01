import type { FastifyInstance } from "fastify";
import {
  activeArchiveContextSchema,
  addExternalXSignalSourceRequestSchema,
  addExternalXSignalSourceResponseSchema,
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  appStatusSchema,
  applyJudgeSuggestionsRequestSchema,
  applyJudgeSuggestionsResponseSchema,
  archiveContextActivationResponseSchema,
  archiveImportOverviewSchema,
  archiveInsightsLatestResponseSchema,
  archivePostsPageSchema,
  archiveTweetsImportRequestSchema,
  archiveTweetsImportResponseSchema,
  archiveTweetsValidateRequestSchema,
  archiveTweetsValidateResponseSchema,
  captureSummarySchema,
  cooldownReportSchema,
  generateCategorySchema,
  generateIdeaRequestSchema,
  generateIdeaResponseSchema,
  generateReplyVariantsRequestSchema,
  generateReplyVariantsResponseSchema,
  getExternalXSignalsOverviewRequestSchema,
  getExternalXSignalsOverviewResponseSchema,
  getFeedbackLoopSummaryRequestSchema,
  getFeedbackLoopSummaryResponseSchema,
  judgeDraftRequestSchema,
  judgeDraftResponseSchema,
  linkFeedbackPredictionRequestSchema,
  linkFeedbackPredictionResponseSchema,
  recordFeedbackPredictionRequestSchema,
  recordFeedbackPredictionResponseSchema,
  recordGeneratedReplyRequestSchema,
  recordGeneratedReplyResponseSchema,
  refreshExternalXSignalSourceRequestSchema,
  refreshExternalXSignalSourceResponseSchema,
  removeExternalXSignalSourceRequestSchema,
  removeExternalXSignalSourceResponseSchema,
  suggestPostRequestSchema,
  suggestPostResponseSchema,
  type ApiError,
  type AppSettings,
} from "@x-builder/shared";
import { z } from "zod";

import {
  ArchiveValidationError,
} from "../archive/archive-import-service.js";
import type { JudgeDraftOutcome } from "../llm/judge-draft-service.js";
import {
  ReplyContextIncompleteError,
  replyContextIncompleteApiError,
} from "../reply-thread-context-resolver.js";
import { PostLibraryStorageError } from "./post-library-repository.js";
import { ANALYZE_COOLDOWN_WINDOW_DAYS, attachCooldownSignals } from "./cooldown.js";
import type { ServerServiceBundle } from "./default-services.js";

type ErrorFactory = () => ApiError;

export type RouteRegistrationHelpers = {
  normalizeError: (apiError: ApiError) => Error;
  notFoundError: ErrorFactory;
  statusUnavailableError: ErrorFactory;
  settingsLoadFailedError: ErrorFactory;
  settingsPersistFailedError: ErrorFactory;
  generationError: ErrorFactory;
  archiveValidationFailedError: ErrorFactory;
  archiveStorageFailedError: ErrorFactory;
  libraryStorageFailedError: ErrorFactory;
  feedbackRecordFailedError: ErrorFactory;
  generatedReplyRecordFailedError: ErrorFactory;
  feedbackLinkFailedError: ErrorFactory;
  feedbackSummaryFailedError: ErrorFactory;
  externalXSignalsAddFailedError: ErrorFactory;
  externalXSignalsRemoveFailedError: ErrorFactory;
  externalXSignalsRefreshFailedError: ErrorFactory;
  externalXSignalsOverviewFailedError: ErrorFactory;
  deterministicAnalysisError: ErrorFactory;
  judgeFailedError: (outcome: Extract<JudgeDraftOutcome, { status: "failed" }>) => ApiError;
  parseResponseContract: <T>(schema: z.ZodType<T>, value: unknown) => T;
};

const optionalQueryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === true || value === false) {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return value;
}, z.boolean().optional());

const externalXSignalsParamSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
});

const externalXSignalsOverviewQuerySchema = z.object({
  sourceId: z.string().trim().min(1).max(160).optional(),
  includeRemoved: optionalQueryBooleanSchema,
  sourceLimit: z.coerce.number().int().min(1).max(100).optional(),
  patternLimit: z.coerce.number().int().min(1).max(100).optional(),
  recentEvidenceLimit: z.coerce.number().int().min(1).max(100).optional(),
  refreshRunLimit: z.coerce.number().int().min(1).max(100).optional(),
});

const objectBody = (body: unknown): Record<string, unknown> =>
  body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

export function registerEngineRoutes(
  app: FastifyInstance,
  services: ServerServiceBundle,
  helpers: RouteRegistrationHelpers,
): void {
  const {
    analyzePosts,
    settingsRepository,
    feedbackLoopService,
    externalXSignalsService,
    archiveImportService,
    archiveDerivedContextService,
    archiveStudioContextResolver,
    repetitionWindowService,
    liveContextResolver,
    replyThreadContextResolver,
    generateCategoryService,
    suggestPostService,
    liveCaptureService,
    readinessService,
    judgeDraftService,
    applyJudgeSuggestionsService,
    generateCandidates,
    generateReplyVariants,
    recordGeneratedReply,
    resolveJudgeAccountProfile,
  } = services;
  const {
    normalizeError,
    notFoundError,
    statusUnavailableError,
    settingsLoadFailedError,
    settingsPersistFailedError,
    generationError,
    archiveValidationFailedError,
    archiveStorageFailedError,
    libraryStorageFailedError,
    feedbackRecordFailedError,
    feedbackLinkFailedError,
    feedbackSummaryFailedError,
    externalXSignalsAddFailedError,
    externalXSignalsRemoveFailedError,
    externalXSignalsRefreshFailedError,
    externalXSignalsOverviewFailedError,
    deterministicAnalysisError,
    generatedReplyRecordFailedError,
    judgeFailedError,
    parseResponseContract,
  } = helpers;

  app.setNotFoundHandler((_request, reply) => {
    const apiError = notFoundError();

    return reply.code(apiError.status ?? 404).send(apiError);
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/status", async (_request, reply) => {
    try {
      const status = appStatusSchema.parse(await readinessService.getStatus());

      return reply.send(status);
    } catch {
      throw normalizeError(statusUnavailableError());
    }
  });

  app.get("/settings", async (_request, reply) => {
    let loaded: Awaited<ReturnType<typeof settingsRepository.load>>;

    try {
      loaded = await settingsRepository.load();
    } catch {
      throw normalizeError(settingsLoadFailedError());
    }

    return reply.send(parseResponseContract(appSettingsResponseSchema, loaded));
  });

  app.patch("/settings", async (request, reply) => {
    const settings: AppSettings = appSettingsSchema.parse(request.body);
    let saved: Awaited<ReturnType<typeof settingsRepository.save>>;

    try {
      saved = await settingsRepository.save(settings);
    } catch {
      throw normalizeError(settingsPersistFailedError());
    }

    return reply.send(parseResponseContract(appSettingsResponseSchema, saved));
  });

  app.post("/ideas/generate", async (request, reply) => {
    const rawInput = generateIdeaRequestSchema.parse(request.body);
    let result: Awaited<ReturnType<typeof generateCandidates>>;

    try {
      const input =
        rawInput.replyContext === undefined
          ? rawInput
          : {
              ...rawInput,
              replyContext: await replyThreadContextResolver.enrichReplyContext(
                rawInput.replyContext,
              ),
            };
      result = await generateCandidates(input);
    } catch (error) {
      if (error instanceof ReplyContextIncompleteError) {
        throw normalizeError(replyContextIncompleteApiError(error.diagnostics));
      }
      throw normalizeError(generationError());
    }

    return reply.send(parseResponseContract(generateIdeaResponseSchema, result));
  });

  app.post("/replies/variants/generate", async (request, reply) => {
    const rawInput = generateReplyVariantsRequestSchema.parse(request.body);

    try {
      const input = {
        ...rawInput,
        replyContext: await replyThreadContextResolver.enrichReplyContext(rawInput.replyContext),
      };
      const result = await generateReplyVariants(input);

      return reply.send(parseResponseContract(generateReplyVariantsResponseSchema, result));
    } catch (error) {
      if (error instanceof ReplyContextIncompleteError) {
        throw normalizeError(replyContextIncompleteApiError(error.diagnostics));
      }
      throw normalizeError(generationError());
    }
  });

  app.post("/generated-replies/record", async (request, reply) => {
    const input = recordGeneratedReplyRequestSchema.parse(request.body);

    try {
      const result = await recordGeneratedReply(input);

      return reply.send(parseResponseContract(recordGeneratedReplyResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(generatedReplyRecordFailedError());
    }
  });

  app.post("/archive/tweets/validate", async (request, reply) => {
    const input = archiveTweetsValidateRequestSchema.parse(request.body);
    const result = archiveImportService.validate(input);

    return reply.send(parseResponseContract(archiveTweetsValidateResponseSchema, result));
  });

  app.post("/archive/tweets/import", async (request, reply) => {
    const input = archiveTweetsImportRequestSchema.parse(request.body);
    let result: Awaited<ReturnType<typeof archiveImportService.importTweets>>;

    try {
      result = await archiveImportService.importTweets(input);
      await archiveDerivedContextService.activateLatest();
    } catch (error) {
      if (error instanceof ArchiveValidationError) {
        throw normalizeError(archiveValidationFailedError());
      }

      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(archiveStorageFailedError());
      }

      throw error;
    }

    return reply.send(parseResponseContract(archiveTweetsImportResponseSchema, result));
  });

  app.get("/archive/imports/latest", async (_request, reply) => {
    try {
      const result = await archiveImportService.latestOverview();

      return reply.send(parseResponseContract(archiveImportOverviewSchema, result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(archiveStorageFailedError());
      }

      throw error;
    }
  });

  app.get("/archive/posts", async (request, reply) => {
    const query = z
      .object({
        cursor: z.string().min(1).max(400).regex(/^offset:\d+$/, "Cursor is invalid.").optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);

    try {
      const result = await archiveImportService.postsPage(query);

      return reply.send(parseResponseContract(archivePostsPageSchema, result));
    } catch (error) {
      if (error instanceof ArchiveValidationError) {
        throw normalizeError(archiveValidationFailedError());
      }

      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(archiveStorageFailedError());
      }

      throw error;
    }
  });

  app.get("/archive/insights/latest", async (_request, reply) => {
    try {
      const result = await archiveDerivedContextService.latestInsights();

      return reply.send(parseResponseContract(archiveInsightsLatestResponseSchema, result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(archiveStorageFailedError());
      }

      throw error;
    }
  });

  app.post("/archive/context/activate", async (_request, reply) => {
    try {
      const result = await archiveDerivedContextService.activateLatest();

      return reply.send(parseResponseContract(archiveContextActivationResponseSchema, result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(archiveStorageFailedError());
      }

      throw error;
    }
  });

  app.post("/archive/context/deactivate", async (_request, reply) => {
    try {
      const result = await archiveDerivedContextService.deactivate();

      return reply.send(parseResponseContract(archiveContextActivationResponseSchema, result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(archiveStorageFailedError());
      }

      throw error;
    }
  });

  app.get("/archive/context/active", async (_request, reply) => {
    try {
      const result = await archiveDerivedContextService.activeContext();

      return reply.send(parseResponseContract(activeArchiveContextSchema, result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(archiveStorageFailedError());
      }

      throw error;
    }
  });

  app.get("/generate/categories", async (_request, reply) => {
    try {
      const result = await generateCategoryService.getCategories();

      return reply.send(parseResponseContract(z.array(generateCategorySchema), result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(libraryStorageFailedError());
      }

      throw error;
    }
  });

  app.get("/capture/summary", async (_request, reply) => {
    try {
      const result = await liveCaptureService.summary();

      return reply.send(parseResponseContract(captureSummarySchema, result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(libraryStorageFailedError());
      }

      throw error;
    }
  });

  app.get("/capture/cooldown", async (request, reply) => {
    const { windowDays } = z
      .object({
        windowDays: z.coerce.number().int().min(1).max(90).default(7),
      })
      .parse(request.query);

    try {
      const report = await repetitionWindowService.compute(windowDays);

      return reply.send(parseResponseContract(cooldownReportSchema, report));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(libraryStorageFailedError());
      }

      throw error;
    }
  });

  app.post("/feedback/predictions", async (request, reply) => {
    const input = recordFeedbackPredictionRequestSchema.parse(request.body);

    try {
      const result = await feedbackLoopService.recordPrediction(input);

      return reply.send(parseResponseContract(recordFeedbackPredictionResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(feedbackRecordFailedError());
    }
  });

  app.post("/feedback/predictions/link", async (request, reply) => {
    const input = linkFeedbackPredictionRequestSchema.parse(request.body);

    try {
      const result = await feedbackLoopService.linkPrediction(input);

      return reply.send(parseResponseContract(linkFeedbackPredictionResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(feedbackLinkFailedError());
    }
  });

  app.post("/feedback/summary", async (request, reply) => {
    const input = getFeedbackLoopSummaryRequestSchema.parse(request.body ?? {});

    try {
      const result = await feedbackLoopService.getSummary(input);

      return reply.send(parseResponseContract(getFeedbackLoopSummaryResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(feedbackSummaryFailedError());
    }
  });

  app.get("/external-x/signals/overview", async (request, reply) => {
    const query = externalXSignalsOverviewQuerySchema.parse(request.query ?? {});
    const input = getExternalXSignalsOverviewRequestSchema.parse(query);

    try {
      const result = await externalXSignalsService.getOverview(input);

      return reply.send(parseResponseContract(getExternalXSignalsOverviewResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(externalXSignalsOverviewFailedError());
    }
  });

  app.post("/external-x/signals/sources", async (request, reply) => {
    const input = addExternalXSignalSourceRequestSchema.parse(request.body);

    try {
      const result = await externalXSignalsService.addSource(input);

      return reply.send(parseResponseContract(addExternalXSignalSourceResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(externalXSignalsAddFailedError());
    }
  });

  app.delete("/external-x/signals/sources/:sourceId", async (request, reply) => {
    const params = externalXSignalsParamSchema.parse(request.params);
    const input = removeExternalXSignalSourceRequestSchema.parse(params);

    try {
      const result = await externalXSignalsService.removeSource(input);

      return reply.send(parseResponseContract(removeExternalXSignalSourceResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(externalXSignalsRemoveFailedError());
    }
  });

  app.post("/external-x/signals/sources/:sourceId/refresh", async (request, reply) => {
    const params = externalXSignalsParamSchema.parse(request.params);
    const input = refreshExternalXSignalSourceRequestSchema.parse({
      ...objectBody(request.body),
      sourceId: params.sourceId,
    });

    try {
      const result = await externalXSignalsService.refreshSource(input);

      return reply.send(parseResponseContract(refreshExternalXSignalSourceResponseSchema, result));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error;
      }

      throw normalizeError(externalXSignalsRefreshFailedError());
    }
  });

  app.post("/posts/analyze", async (request, reply) => {
    const input = analyzePostsRequestSchema.parse(request.body);
    let result: Awaited<ReturnType<typeof analyzePosts>>;

    try {
      let merged = await liveContextResolver.mergeAnalysisRequest(input);
      merged = await archiveStudioContextResolver.mergeAnalysisRequest(merged);
      merged = await replyThreadContextResolver.mergeAnalysisRequest(merged);
      const analyzed = await analyzePosts(merged);
      const report = await repetitionWindowService.compute(ANALYZE_COOLDOWN_WINDOW_DAYS);
      result = attachCooldownSignals(analyzed, report);
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(libraryStorageFailedError());
      }

      throw normalizeError(deterministicAnalysisError());
    }

    return reply.send(parseResponseContract(analyzePostsResponseSchema, result));
  });

  app.post("/posts/suggest", async (request, reply) => {
    const input = suggestPostRequestSchema.parse(request.body);

    try {
      const result = await suggestPostService.suggest(input);

      return reply.send(parseResponseContract(suggestPostResponseSchema, result));
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw normalizeError(libraryStorageFailedError());
      }

      throw normalizeError(generationError());
    }
  });

  app.post("/drafts/judge", async (request, reply) => {
    const input = judgeDraftRequestSchema.parse(request.body);
    let outcome: Awaited<ReturnType<typeof judgeDraftService.judge>>;

    try {
      const replyContext =
        input.replyContext === undefined
          ? undefined
          : await replyThreadContextResolver.enrichReplyContext(input.replyContext);
      const accountProfile = await resolveJudgeAccountProfile(input.accountProfile);
      outcome =
        replyContext !== undefined
          ? await judgeDraftService.judge(input.text, accountProfile, {
              replyContext,
            })
          : accountProfile !== undefined
          ? await judgeDraftService.judge(input.text, accountProfile)
          : await judgeDraftService.judge(input.text);
    } catch (error) {
      if (error instanceof ReplyContextIncompleteError) {
        throw normalizeError(replyContextIncompleteApiError(error.diagnostics));
      }
      throw error;
    }

    if (outcome.status === "failed") {
      throw normalizeError(judgeFailedError(outcome));
    }

    return reply.send(parseResponseContract(judgeDraftResponseSchema, outcome.response));
  });

  app.post("/drafts/apply-suggestions", async (request, reply) => {
    const rawInput = applyJudgeSuggestionsRequestSchema.parse(request.body);

    try {
      const input =
        rawInput.replyContext === undefined
          ? rawInput
          : {
              ...rawInput,
              replyContext: await replyThreadContextResolver.enrichReplyContext(
                rawInput.replyContext,
              ),
            };
      const result = await applyJudgeSuggestionsService.apply(input);

      return reply.send(
        parseResponseContract(applyJudgeSuggestionsResponseSchema, result),
      );
    } catch (error) {
      if (error instanceof ReplyContextIncompleteError) {
        throw normalizeError(replyContextIncompleteApiError(error.diagnostics));
      }
      throw normalizeError(generationError());
    }
  });
}
