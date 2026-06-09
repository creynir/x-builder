import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import {
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  apiErrorSchema,
  appSettingsResponseSchema,
  appSettingsSchema,
  appStatusSchema,
  generateIdeaRequestSchema,
  generateIdeaResponseSchema,
  subsystemStatusSchema,
  type ApiError,
  type AppSettings,
  type AppStatus,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type GenerateIdeaRequest,
  type SubsystemStatus,
} from "@x-builder/shared";
import { z } from "zod";

import { DeterministicAnalysisService } from "../deterministic/deterministic-analysis-service.js";
import { CodexReadinessProbe } from "../llm/codex-readiness-probe.js";
import { NodeProcessRunner } from "../llm/process-runner.js";
import {
  JsonFileAppSettingsRepository,
  type AppSettingsRepository,
} from "./settings-repository.js";

export type AnalyzePosts = (request: AnalyzePostsRequest) => Promise<AnalyzePostsResponse> | AnalyzePostsResponse;

export type GenerateCandidates = (input: GenerateIdeaRequest) => Promise<unknown> | unknown;

export type ReadinessProbe = {
  check: () => Promise<SubsystemStatus> | SubsystemStatus;
};

export type ReadinessDependencies = {
  deterministic: ReadinessProbe;
  codex: ReadinessProbe;
  storage: ReadinessProbe;
};

export type ReadinessService = {
  getStatus: () => Promise<AppStatus> | AppStatus;
};

export interface BuildServerOptions {
  allowedCorsOrigins?: readonly string[];
  analyzePosts?: AnalyzePosts;
  generateCandidates?: GenerateCandidates;
  readinessDependencies?: ReadinessDependencies;
  readinessService?: ReadinessService;
  readinessTimeoutMs?: number;
  settingsRepository?: AppSettingsRepository;
}

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

const internalError = (): ApiError =>
  normalize({
    code: "internal_error",
    message: "The engine could not complete the request.",
    scope: "app",
    retryable: true,
    status: 500,
  });

const defaultGenerateCandidates: GenerateCandidates = ({ idea }) => ({
  candidates: [
    {
      id: "one-liner",
      format: "one-liner",
      text: idea,
    },
    {
      id: "mini-framework",
      format: "mini-framework",
      text: `${idea}\n\n1. Name the constraint.\n2. Show the tradeoff.\n3. Make the decision.`,
    },
    {
      id: "debate-question",
      format: "debate-question",
      text: `${idea}\n\nWhat would change your mind?`,
    },
  ],
});

const readinessTimeoutMsDefault = 750;
const packageVersion = "0.0.0";
const defaultSettingsRoot = join(homedir(), ".x-builder", "engine-settings");
const defaultEngineHost = "127.0.0.1";
const defaultEnginePort = 4173;
export const defaultCorsAllowedOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
] as const;

const nowIso = (): string => new Date().toISOString();

const subsystem = (
  state: SubsystemStatus["state"],
  label: string,
  overrides: Partial<SubsystemStatus> = {},
): SubsystemStatus =>
  subsystemStatusSchema.parse({
    state,
    label,
    checkedAt: nowIso(),
    retryable: true,
    details: {},
    ...overrides,
  });

const timeoutProbeStatus = (label: string): SubsystemStatus =>
  subsystem("unavailable", label, {
    message: "Readiness check timed out.",
    retryable: true,
  });

const failedProbeStatus = (label: string): SubsystemStatus =>
  subsystem("unavailable", label, {
    message: "Readiness check failed.",
    retryable: true,
  });

const defaultReadinessDependencies: ReadinessDependencies = {
  deterministic: {
    check: () =>
      subsystem("ready", "Deterministic scorer", {
        retryable: false,
        details: {
          mode: "in-process",
        },
      }),
  },
  codex: {
    check: () =>
      new CodexReadinessProbe({
        runner: new NodeProcessRunner(),
        workspaceRoot: process.cwd(),
        executionTimeoutMs: readinessTimeoutMsDefault,
      }).check(),
  },
  storage: {
    check: async () => {
      await access(process.cwd(), constants.W_OK);

      return subsystem("ready", "Storage", {
        retryable: true,
        details: {
          boundary: "working-directory",
        },
      });
    },
  },
};

const probeLabels: Record<keyof ReadinessDependencies, string> = {
  deterministic: "Deterministic scorer",
  codex: "Codex judge",
  storage: "Storage",
};

const overallFromSubsystems = (
  engine: SubsystemStatus,
  deterministic: SubsystemStatus,
  codex: SubsystemStatus,
  storage: SubsystemStatus,
): AppStatus["overall"] => {
  if (engine.state !== "ready") {
    return "unavailable";
  }

  return [deterministic, codex, storage].every((status) => status.state === "ready")
    ? "ready"
    : "partial";
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, timeoutValue: T): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve(timeoutValue);
    }, timeoutMs);

    operation
      .then(resolve)
      .catch(reject)
      .finally(() => {
        clearTimeout(timeout);
      });
  });

class DefaultReadinessService implements ReadinessService {
  constructor(
    private readonly dependencies: ReadinessDependencies = defaultReadinessDependencies,
    private readonly timeoutMs = readinessTimeoutMsDefault,
  ) {}

  async getStatus(): Promise<AppStatus> {
    const engine = subsystem("ready", "Engine", {
      message: "Engine is accepting local requests.",
      retryable: false,
      details: {
        adapter: "fastify",
      },
    });

    const [deterministic, codex, storage] = await Promise.all([
      this.checkProbe("deterministic"),
      this.checkProbe("codex"),
      this.checkProbe("storage"),
    ]);
    const generatedAt = nowIso();

    return appStatusSchema.parse({
      overall: overallFromSubsystems(engine, deterministic, codex, storage),
      version: packageVersion,
      generatedAt,
      engine,
      deterministic,
      codex,
      storage,
      lastRun: {
        state: "none",
      },
    });
  }

  private async checkProbe(key: keyof ReadinessDependencies): Promise<SubsystemStatus> {
    const label = probeLabels[key];

    try {
      const status = await withTimeout(
        Promise.resolve().then(() => this.dependencies[key].check()),
        this.timeoutMs,
        timeoutProbeStatus(label),
      );

      return subsystemStatusSchema.parse(status);
    } catch {
      return failedProbeStatus(label);
    }
  }
}

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
  const app = Fastify({ logger: false });
  configureCors(app, options.allowedCorsOrigins ?? defaultCorsAllowedOrigins);

  const deterministicAnalysisService = new DeterministicAnalysisService();
  const defaultAnalyzePosts: AnalyzePosts = (request) => deterministicAnalysisService.analyzePosts(request);
  const analyzePosts = options.analyzePosts ?? defaultAnalyzePosts;
  const generateCandidates = options.generateCandidates ?? defaultGenerateCandidates;
  const settingsRepository =
    options.settingsRepository ?? new JsonFileAppSettingsRepository({ root: defaultSettingsRoot });
  const readinessService =
    options.readinessService ??
    new DefaultReadinessService(
      options.readinessDependencies,
      options.readinessTimeoutMs ?? readinessTimeoutMsDefault,
    );

  app.setNotFoundHandler((_request, reply) => {
    const apiError = notFoundError();

    return reply.code(apiError.status ?? 404).send(apiError);
  });

  app.setErrorHandler((error, _request, reply) => {
    const apiError =
      error instanceof NormalizedApiError
        ? error.apiError
        : error instanceof z.ZodError
          ? validationError(error)
          : internalError();

    return reply.code(apiError.status ?? 500).send(apiError);
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/status", async (_request, reply) => {
    try {
      const status = appStatusSchema.parse(await readinessService.getStatus());

      return reply.send(status);
    } catch {
      throw new NormalizedApiError(statusUnavailableError());
    }
  });

  app.get("/settings", async (_request, reply) => {
    try {
      const settingsResponse = appSettingsResponseSchema.parse(await settingsRepository.load());

      return reply.send(settingsResponse);
    } catch {
      throw new NormalizedApiError(settingsLoadFailedError());
    }
  });

  app.patch("/settings", async (request, reply) => {
    const settings: AppSettings = appSettingsSchema.parse(request.body);

    try {
      const settingsResponse = appSettingsResponseSchema.parse(await settingsRepository.save(settings));

      return reply.send(settingsResponse);
    } catch {
      throw new NormalizedApiError(settingsPersistFailedError());
    }
  });

  app.post("/ideas/generate", async (request, reply) => {
    const input = generateIdeaRequestSchema.parse(request.body);

    try {
      const result = generateIdeaResponseSchema.parse(await generateCandidates(input));

      return reply.send(result);
    } catch {
      throw new NormalizedApiError(generationError());
    }
  });

  app.post("/posts/analyze", async (request, reply) => {
    const input = analyzePostsRequestSchema.parse(request.body);

    try {
      const result = analyzePostsResponseSchema.parse(await analyzePosts(input));

      return reply.send(result);
    } catch {
      throw new NormalizedApiError(deterministicAnalysisError());
    }
  });

  return app;
}

export function createEngineRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): EngineRuntimeConfig {
  const rawPort = env.X_BUILDER_ENGINE_PORT;
  const port = rawPort === undefined ? defaultEnginePort : Number.parseInt(rawPort, 10);

  return {
    host: env.X_BUILDER_ENGINE_HOST ?? defaultEngineHost,
    port: Number.isInteger(port) && port > 0 ? port : defaultEnginePort,
  };
}

export async function startEngineServer(
  config: EngineRuntimeConfig = createEngineRuntimeConfig(),
): Promise<FastifyInstance> {
  const app = buildServer();

  await app.listen({
    host: config.host,
    port: config.port,
  });

  return app;
}
