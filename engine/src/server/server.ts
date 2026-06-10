import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
import { NodeProcessRunner, type ProcessRunner } from "../llm/process-runner.js";
import {
  JsonFileAppSettingsRepository,
  type AppSettingsRepository,
} from "./settings-repository.js";
import { resolveWorkspaceRoot } from "./workspace-root.js";

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

export type DefaultReadinessDependenciesOptions = {
  codexRunner?: ProcessRunner;
  startupCwd?: string;
  settingsRoot?: string;
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
const packageVersion = ((): string => {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const enginePackage = requireFromHere("../../package.json") as {
      version?: string;
    };

    return enginePackage.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
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

const unresolvedWorkspaceRootStatus = (): SubsystemStatus =>
  subsystem("unavailable", "Codex judge", {
    message: "Workspace root could not be resolved.",
    retryable: true,
    details: {
      reason: "workspace_root_unresolved",
    },
  });

// Walk up from a path to the first directory that exists. Settings are written
// with mkdir -p, so writability of the nearest existing ancestor determines
// whether the engine can persist — the leaf dir need not exist yet.
const nearestExistingDirectory = (path: string): string => {
  let current = path;

  while (!existsSync(current)) {
    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return current;
};

export function createDefaultReadinessDependencies(
  options: DefaultReadinessDependenciesOptions = {},
): ReadinessDependencies {
  const startupCwd = options.startupCwd ?? process.cwd();
  const settingsRoot = options.settingsRoot ?? defaultSettingsRoot;
  const workspaceRoot = resolveWorkspaceRoot(startupCwd);
  const codexProbe = workspaceRoot
    ? new CodexReadinessProbe({
        runner: options.codexRunner ?? new NodeProcessRunner(),
        workspaceRoot,
        executionTimeoutMs: readinessTimeoutMsDefault,
      })
    : null;

  return {
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
      check: () => (codexProbe ? codexProbe.check() : unresolvedWorkspaceRootStatus()),
    },
    storage: {
      check: async () => {
        // Probe the directory the engine actually persists settings to, falling
        // back to the nearest existing ancestor when the leaf dir has not been
        // created yet (the repo creates it lazily on first write).
        const target = nearestExistingDirectory(settingsRoot);
        await access(target, constants.W_OK);

        return subsystem("ready", "Storage", {
          retryable: true,
          details: {
            boundary: target,
          },
        });
      },
    },
  };
}

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
    private readonly dependencies: ReadinessDependencies = createDefaultReadinessDependencies(),
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
      options.readinessDependencies ?? createDefaultReadinessDependencies(),
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
    let loaded: Awaited<ReturnType<typeof settingsRepository.load>>;

    try {
      loaded = await settingsRepository.load();
    } catch {
      throw new NormalizedApiError(settingsLoadFailedError());
    }

    return reply.send(parseResponseContract(appSettingsResponseSchema, loaded));
  });

  app.patch("/settings", async (request, reply) => {
    const settings: AppSettings = appSettingsSchema.parse(request.body);
    let saved: Awaited<ReturnType<typeof settingsRepository.save>>;

    try {
      saved = await settingsRepository.save(settings);
    } catch {
      throw new NormalizedApiError(settingsPersistFailedError());
    }

    return reply.send(parseResponseContract(appSettingsResponseSchema, saved));
  });

  app.post("/ideas/generate", async (request, reply) => {
    const input = generateIdeaRequestSchema.parse(request.body);
    let result: Awaited<ReturnType<typeof generateCandidates>>;

    try {
      result = await generateCandidates(input);
    } catch {
      throw new NormalizedApiError(generationError());
    }

    return reply.send(parseResponseContract(generateIdeaResponseSchema, result));
  });

  app.post("/posts/analyze", async (request, reply) => {
    const input = analyzePostsRequestSchema.parse(request.body);
    let result: Awaited<ReturnType<typeof analyzePosts>>;

    try {
      result = await analyzePosts(input);
    } catch {
      throw new NormalizedApiError(deterministicAnalysisError());
    }

    return reply.send(parseResponseContract(analyzePostsResponseSchema, result));
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
  const app = buildServer();

  await app.listen({
    host: config.host,
    port: config.port,
  });

  return app;
}
