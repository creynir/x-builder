import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import {
  apiErrorSchema,
  type ApiError,
} from "@x-builder/shared";
import { z } from "zod";

import {
  type JudgeDraftOutcome,
} from "../llm/judge-draft-service.js";
import {
  createDefaultReadinessDependencies,
  createDefaultReadinessService,
} from "./readiness.js";
import {
  defaultCorsAllowedOrigins,
  defaultEngineHost,
  defaultEnginePort,
  defaultSettingsRoot,
} from "./constants.js";
import {
  createDefaultJudgeDraftService,
  createServerServiceBundle,
  type AnalyzePosts,
  type BuildServerOptions,
  type GenerateCandidates,
  type GenerateReplyVariants,
  type RecordGeneratedReply,
} from "./default-services.js";
import { registerEngineRoutes } from "./routes.js";

export {
  createDefaultReadinessDependencies,
  createDefaultReadinessService,
  type DefaultReadinessDependenciesOptions,
  type ReadinessDependencies,
  type ReadinessProbe,
  type ReadinessService,
} from "./readiness.js";
export { defaultCorsAllowedOrigins } from "./constants.js";

export type {
  AnalyzePosts,
  BuildServerOptions,
  GenerateCandidates,
  GenerateReplyVariants,
  RecordGeneratedReply,
} from "./default-services.js";
export { createDefaultJudgeDraftService } from "./default-services.js";

export type EngineRuntimeConfig = {
  host: string;
  port: number;
};

class NormalizedApiError extends Error {
  constructor(public readonly apiError: ApiError) {
    super(apiError.code);
  }
}

const normalize = (apiError: ApiError): ApiError => apiErrorSchema.parse(apiError);

const fieldErrorsFromZod = (error: z.ZodError): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = {};

  for (const [field, messages] of Object.entries(error.flatten().fieldErrors)) {
    if (messages?.length) {
      fieldErrors[field] = messages;
    }
  }

  return fieldErrors;
};

const validationError = (error: z.ZodError): ApiError =>
  normalize({
    code: "validation_failed",
    message: "The request is invalid.",
    scope: "field",
    retryable: false,
    status: 400,
    fieldErrors: fieldErrorsFromZod(error),
  });

const notFoundError = (): ApiError =>
  normalize({
    code: "not_found",
    message: "The requested route was not found.",
    scope: "route",
    retryable: false,
    status: 404,
  });

const generationError = (): ApiError =>
  normalize({
    code: "generation_failed",
    message: "Idea generation failed. Try again.",
    scope: "writer",
    retryable: true,
    status: 500,
  });

const deterministicAnalysisError = (): ApiError =>
  normalize({
    code: "deterministic_analysis_failed",
    message: "Deterministic analysis failed. Try again.",
    scope: "deterministic",
    retryable: true,
    status: 500,
  });

const archiveValidationFailedError = (): ApiError =>
  normalize({
    code: "archive_validation_failed",
    message: "The selected file is not a supported tweets.js archive file.",
    scope: "archive",
    retryable: false,
    status: 400,
  });

const archiveStorageFailedError = (): ApiError =>
  normalize({
    code: "archive_storage_failed",
    message: "The local archive library could not be saved. Try again.",
    scope: "archive",
    retryable: true,
    status: 500,
  });

const libraryStorageFailedError = (): ApiError =>
  normalize({
    code: "library_storage_failed",
    message: "The local post library could not be read. Try again.",
    scope: "library",
    retryable: true,
    status: 500,
  });

const feedbackRecordFailedError = (): ApiError =>
  normalize({
    code: "feedback_record_failed",
    message: "The feedback prediction could not be recorded. Try again.",
    scope: "feedback",
    retryable: true,
    status: 500,
  });

const generatedReplyRecordFailedError = (): ApiError =>
  normalize({
    code: "generated_reply_record_failed",
    message: "The generated reply could not be recorded. You can keep editing the draft.",
    scope: "reply-assistant",
    retryable: true,
    status: 500,
  });

const feedbackLinkFailedError = (): ApiError =>
  normalize({
    code: "feedback_link_failed",
    message: "The feedback prediction could not be linked. Try again.",
    scope: "feedback",
    retryable: true,
    status: 500,
  });

const feedbackSummaryFailedError = (): ApiError =>
  normalize({
    code: "feedback_summary_failed",
    message: "The feedback summary could not be loaded. Try again.",
    scope: "feedback",
    retryable: true,
    status: 500,
  });

const externalXSignalsAddFailedError = (): ApiError =>
  normalize({
    code: "external_x_signals_add_failed",
    message: "The external X signal source could not be saved. Try again.",
    scope: "external-x-signals",
    retryable: true,
    status: 500,
  });

const externalXSignalsRemoveFailedError = (): ApiError =>
  normalize({
    code: "external_x_signals_remove_failed",
    message: "The external X signal source could not be removed. Try again.",
    scope: "external-x-signals",
    retryable: true,
    status: 500,
  });

const externalXSignalsRefreshFailedError = (): ApiError =>
  normalize({
    code: "external_x_signals_refresh_failed",
    message: "The external X signal source could not be refreshed. Try again.",
    scope: "external-x-signals",
    retryable: true,
    status: 500,
  });

const externalXSignalsOverviewFailedError = (): ApiError =>
  normalize({
    code: "external_x_signals_overview_failed",
    message: "The external X signal overview could not be loaded. Try again.",
    scope: "external-x-signals",
    retryable: true,
    status: 500,
  });

const externalXSignalsParamSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
});

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

const publicProviderMessage = (details: Record<string, unknown> | undefined): string | undefined => {
  const value = details?.providerMessage;

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed.slice(0, 180) : undefined;
};

const judgeFailedError = (
  outcome: Extract<JudgeDraftOutcome, { status: "failed" }>,
): ApiError => {
  const providerMessage = publicProviderMessage(outcome.details);

  return normalize({
    code: "judge_failed",
    message: providerMessage
      ? `The judge provider failed: ${providerMessage}`
      : "The judge could not score this draft. Try again.",
    scope: "judge",
    retryable: outcome.retryable,
    status: outcome.retryable ? 503 : 500,
    details: {
      providerCode: outcome.code,
      ...(providerMessage ? { providerMessage } : {}),
    },
  });
};

const statusUnavailableError = (): ApiError =>
  normalize({
    code: "status_unavailable",
    message: "Status is unavailable. Try again.",
    scope: "status",
    retryable: true,
    status: 500,
  });

const settingsLoadFailedError = (): ApiError =>
  normalize({
    code: "settings_load_failed",
    message: "Settings could not be loaded. Try again.",
    scope: "settings",
    retryable: true,
    status: 500,
  });

const settingsPersistFailedError = (): ApiError =>
  normalize({
    code: "settings_persist_failed",
    message: "Settings could not be saved. Try again.",
    scope: "settings",
    retryable: true,
    status: 500,
  });

const internalError = (retryable = true): ApiError =>
  normalize({
    code: "internal_error",
    message: "The engine could not complete the request.",
    scope: "app",
    retryable,
    status: 500,
  });

// Validate an outgoing response against its contract. A failure here means the
// engine produced output that violates its own schema — a server bug, not a
// transient or client-input failure — so it surfaces as a non-retryable
// internal error rather than a retryable domain error.
const parseResponseContract = <T>(schema: z.ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new NormalizedApiError(internalError(false));
    }

    throw error;
  }
};

const configureCors = (
  app: FastifyInstance,
  allowedOrigins: readonly string[],
) => {
  const allowedOriginSet = new Set(allowedOrigins);

  app.addHook("onRequest", (request, reply, done) => {
    const origin = request.headers.origin;

    if (typeof origin === "string" && allowedOriginSet.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Methods", "GET,PATCH,POST,OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
      reply.header("Access-Control-Max-Age", "600");
    }

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }

    done();
  });
};

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 26_000_000 });
  configureCors(app, options.allowedCorsOrigins ?? defaultCorsAllowedOrigins);

  const services = createServerServiceBundle(options);

  app.setErrorHandler((error, _request, reply) => {
    const apiError =
      error instanceof NormalizedApiError
        ? error.apiError
        : error instanceof z.ZodError
          ? validationError(error)
          : internalError();

    return reply.code(apiError.status ?? 500).send(apiError);
  });

  registerEngineRoutes(app, services, {
    normalizeError: (apiError) => new NormalizedApiError(apiError),
    notFoundError,
    statusUnavailableError,
    settingsLoadFailedError,
    settingsPersistFailedError,
    generationError,
    archiveValidationFailedError,
    archiveStorageFailedError,
    libraryStorageFailedError,
    feedbackRecordFailedError,
    generatedReplyRecordFailedError,
    feedbackLinkFailedError,
    feedbackSummaryFailedError,
    externalXSignalsAddFailedError,
    externalXSignalsRemoveFailedError,
    externalXSignalsRefreshFailedError,
    externalXSignalsOverviewFailedError,
    deterministicAnalysisError,
    judgeFailedError,
    parseResponseContract,
  });

  return app;
}

export function createEngineRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): EngineRuntimeConfig {
  const rawPort = env.X_BUILDER_ENGINE_PORT;
  const port = rawPort === undefined ? defaultEnginePort : Number.parseInt(rawPort, 10);
  const isValidPort = Number.isInteger(port) && port > 0;

  if (rawPort !== undefined && !isValidPort) {
    console.warn(
      `[engine] ignoring invalid X_BUILDER_ENGINE_PORT="${rawPort}"; falling back to ${defaultEnginePort}.`,
    );
  }

  return {
    host: env.X_BUILDER_ENGINE_HOST ?? defaultEngineHost,
    port: isValidPort ? port : defaultEnginePort,
  };
}

export async function startEngineServer(
  config: EngineRuntimeConfig = createEngineRuntimeConfig(),
): Promise<FastifyInstance> {
  // The sole production caller: persist + import the corpus at the default settings
  // root (~/.x-builder/engine-settings). Bare buildServer() must never hit home — only
  // this explicit storageRoot does.
  const app = buildServer({ storageRoot: defaultSettingsRoot });

  await app.listen({
    host: config.host,
    port: config.port,
  });

  return app;
}
