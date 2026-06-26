import { constants, existsSync, mkdirSync } from "node:fs";
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
  applyJudgeSuggestionsRequestSchema,
  applyJudgeSuggestionsResponseSchema,
  activeArchiveContextSchema,
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
  type CooldownReport,
  generateCategorySchema,
  generateIdeaRequestSchema,
  generateIdeaResponseSchema,
  judgeDraftRequestSchema,
  judgeDraftResponseSchema,
  suggestPostRequestSchema,
  suggestPostResponseSchema,
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
import { RepetitionWindowService } from "../capture/repetition-window-service.js";
import { LiveCaptureService } from "../capture/live-capture-service.js";
import { LiveContextResolver } from "../capture/live-context-resolver.js";
import { GenerateCategoryService } from "../suggest/generate-category-service.js";
import {
  ArchiveImportService,
  ArchiveValidationError,
} from "../archive/archive-import-service.js";
import { ArchiveDerivedContextService } from "../archive/archive-derived-context-service.js";
import { ArchiveStudioContextResolver } from "../archive/archive-studio-context-resolver.js";
import {
  JudgeDraftService,
  type JudgeDraft,
  type JudgeDraftOutcome,
} from "../llm/judge-draft-service.js";
import { GenerateIdeasService } from "../llm/generate-ideas-service.js";
import { ApplyJudgeSuggestionsService } from "../llm/apply-judge-suggestions-service.js";
import { SuggestPostService } from "../suggest/suggest-post-service.js";
import { judgeProviderRegistry } from "../llm/judge-provider-registry.js";
import { createSettingsJudgeProviderResolver } from "../llm/judge-provider-resolver.js";
import { NodeProcessRunner, type ProcessRunner } from "../llm/process-runner.js";
import { SelectedJudgeReadinessProbe } from "../llm/selected-judge-readiness-probe.js";
import { StructuredLlmService } from "../llm/structured-llm-service.js";
import {
  JsonFileAppSettingsRepository,
  type AppSettingsRepository,
} from "./settings-repository.js";
import {
  PostLibraryStorageError,
  type PostLibraryRepository,
} from "./post-library-repository.js";
import { openEngineDatabase } from "./open-engine-database.js";
import { SqlitePostLibraryRepository } from "./sqlite-post-library-repository.js";
import { importPostLibraryJsonToSqlite } from "./import-post-library-json.js";
import { resolveWorkspaceRoot } from "./workspace-root.js";

export type AnalyzePosts = (request: AnalyzePostsRequest) => Promise<AnalyzePostsResponse> | AnalyzePostsResponse;

export type GenerateCandidates = (input: GenerateIdeaRequest) => Promise<unknown> | unknown;

export type ReadinessProbe = {
  check: () => Promise<SubsystemStatus> | SubsystemStatus;
};

export type ReadinessDependencies = {
  deterministic: ReadinessProbe;
  llm: ReadinessProbe;
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
  postLibraryRepository?: PostLibraryRepository;
  // Storage root whose `storage/x-builder.db` backs the SQLite corpus and against
  // whose `storage/post-library.json` the one-time JSON->SQLite importer runs. When
  // omitted (and no postLibraryRepository is injected) buildServer stays on an empty
  // in-memory corpus that touches NO home directory — the isolation default for the
  // bare-call test suites.
  storageRoot?: string;
  repetitionWindowService?: RepetitionWindowService;
  generateCategoryService?: GenerateCategoryService;
  suggestPostService?: SuggestPostService;
  judgeDraftService?: JudgeDraft;
  applyJudgeSuggestionsService?: ApplyJudgeSuggestionsService;
  liveContextResolver?: LiveContextResolver;
  liveCaptureService?: LiveCaptureService;
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

// Attach a per-item cooldown signal to each scored item by looking up its
// detectedFormat in the precomputed window report. A scored item gets a cooldown
// key ONLY when the report carries a real in-window signal for its format;
// formats with no signal leave the key genuinely absent (the field is
// .optional() in the contract). score_failed items are returned unchanged (no
// cooldown key), keeping the response valid against analyzePostsResponseSchema.
const attachCooldownSignals = (
  response: AnalyzePostsResponse,
  report: CooldownReport,
): AnalyzePostsResponse => ({
  ...response,
  items: response.items.map((item) => {
    if (item.status !== "scored") {
      return item;
    }

    const signal = report.signals.find(
      (candidate) => candidate.format === item.detectedFormat,
    );

    return signal === undefined ? item : { ...item, cooldown: signal };
  }),
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
  // The selected-provider probe resolves the active provider from the same
  // settings repository the judge path uses, then runs that provider's readiness
  // spec from the registry against the startup-resolved workspace root.
  const settingsRepository = new JsonFileAppSettingsRepository({ root: settingsRoot });
  const selectedJudgeProbe = new SelectedJudgeReadinessProbe({
    resolveProvider: createSettingsJudgeProviderResolver(settingsRepository),
    registry: judgeProviderRegistry,
    resolveWorkspaceRoot: () => workspaceRoot,
    runner: options.codexRunner ?? new NodeProcessRunner(),
    executionTimeoutMs: readinessTimeoutMsDefault,
  });

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
    llm: {
      check: () => selectedJudgeProbe.check(),
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
  // Provider-agnostic fallback label for the selected-judge slot: a probe
  // timeout or crash cannot name a provider, so the slot reads "Judge".
  llm: "Judge",
  storage: "Storage",
};

const overallFromSubsystems = (
  engine: SubsystemStatus,
  deterministic: SubsystemStatus,
  llm: SubsystemStatus,
  storage: SubsystemStatus,
): AppStatus["overall"] => {
  if (engine.state !== "ready") {
    return "unavailable";
  }

  return [deterministic, llm, storage].every((status) => status.state === "ready")
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

    const [deterministic, llm, storage] = await Promise.all([
      this.checkProbe("deterministic"),
      this.checkProbe("llm"),
      this.checkProbe("storage"),
    ]);
    const generatedAt = nowIso();

    return appStatusSchema.parse({
      overall: overallFromSubsystems(engine, deterministic, llm, storage),
      version: packageVersion,
      generatedAt,
      engine,
      deterministic,
      llm,
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

// In-process readiness service construction. The runner composes /status and
// the overlay readiness view from a real ReadinessService without a Fastify
// instance, mirroring the buildServer default. `DefaultReadinessService` stays
// private; this is the single exported construction path for it.
export const createDefaultReadinessService = (
  options: DefaultReadinessDependenciesOptions & { timeoutMs?: number } = {},
): ReadinessService =>
  new DefaultReadinessService(
    createDefaultReadinessDependencies(options),
    options.timeoutMs ?? readinessTimeoutMsDefault,
  );

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

export type CreateDefaultJudgeDraftServiceOptions = {
  startupCwd?: string;
  runner?: ProcessRunner;
  settingsRepository?: AppSettingsRepository;
};

// Per-provider mapping from a resolved provider id to the settings model field
// that configures it. Codex is the only registered provider in this ticket.
const judgeProviderModelKeys = {
  "codex-cli": "codexModel",
  "claude-cli": "claudeModel",
  "cursor-cli": "cursorModel",
} as const;

export const createDefaultJudgeDraftService = (
  options: CreateDefaultJudgeDraftServiceOptions = {},
): JudgeDraft => {
  const workspaceRoot = resolveWorkspaceRoot(options.startupCwd ?? process.cwd());
  const runner = options.runner ?? new NodeProcessRunner();
  const settingsRepository =
    options.settingsRepository ?? new JsonFileAppSettingsRepository({ root: defaultSettingsRoot });
  // With no resolvable workspace root the provider list is empty, so the judge
  // request resolves to a provider_unconfigured failure rather than throwing.
  const providers = workspaceRoot
    ? judgeProviderRegistry.map((entry) => entry.createProvider({ runner, workspaceRoot }))
    : [];

  const resolveProvider = createSettingsJudgeProviderResolver(settingsRepository);
  // Read the active provider's configured model from the same per-call settings
  // load; an empty or absent value leaves the provider on its own default.
  const resolveModel = async (): Promise<string | undefined> => {
    try {
      const { settings } = await settingsRepository.load();
      const provider = await resolveProvider();
      const model = settings[judgeProviderModelKeys[provider]]?.trim();

      return model === undefined || model.length === 0 ? undefined : model;
    } catch {
      return undefined;
    }
  };

  return new JudgeDraftService(
    new StructuredLlmService({ providers }),
    resolveProvider,
    resolveModel,
  );
};

// Resolve the corpus repository in a fixed precedence, keeping buildServer synchronous:
//   1. An injected postLibraryRepository wins (the existing test/host injection seam).
//   2. Else a storageRoot opens <storageRoot>/storage/x-builder.db, runs the one-time
//      JSON->SQLite importer there, and serves from SQLite (production + the host-swap
//      tests, which pass a tmpdir).
//   3. Else (a BARE buildServer() call) an empty in-memory SQLite corpus — NO importer,
//      ZERO home-directory I/O — so the bare-call test suites stay fully isolated.
const resolvePostLibraryRepository = (
  options: BuildServerOptions,
): PostLibraryRepository => {
  if (options.postLibraryRepository) {
    return options.postLibraryRepository;
  }

  if (options.storageRoot !== undefined) {
    const storageDir = join(options.storageRoot, "storage");
    mkdirSync(storageDir, { recursive: true });
    const db = openEngineDatabase(join(storageDir, "x-builder.db"));
    importPostLibraryJsonToSqlite(storageDir, db);

    return new SqlitePostLibraryRepository(db);
  }

  return new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));
};

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 26_000_000 });
  configureCors(app, options.allowedCorsOrigins ?? defaultCorsAllowedOrigins);

  const deterministicAnalysisService = new DeterministicAnalysisService();
  const defaultAnalyzePosts: AnalyzePosts = (request) => deterministicAnalysisService.analyzePosts(request);
  const analyzePosts = options.analyzePosts ?? defaultAnalyzePosts;
  const settingsRepository =
    options.settingsRepository ?? new JsonFileAppSettingsRepository({ root: defaultSettingsRoot });
  const postLibraryRepository = resolvePostLibraryRepository(options);
  const archiveImportService = new ArchiveImportService({ repository: postLibraryRepository });
  const archiveDerivedContextService = new ArchiveDerivedContextService({
    repository: postLibraryRepository,
  });
  const archiveStudioContextResolver = new ArchiveStudioContextResolver(postLibraryRepository);
  // One RepetitionWindowService backs both the live-context resolver's
  // repeatHistory derivation and the per-item cooldown attachment on
  // /posts/analyze, so the 7-day window is computed against one clock and one
  // store for a single request.
  const repetitionWindowService =
    options.repetitionWindowService ?? new RepetitionWindowService(postLibraryRepository);
  const liveContextResolver =
    options.liveContextResolver ??
    new LiveContextResolver(postLibraryRepository, repetitionWindowService);
  const generateCategoryService =
    options.generateCategoryService ??
    new GenerateCategoryService(
      postLibraryRepository,
      new RepetitionWindowService(postLibraryRepository),
    );
  // Suggest rail: deterministic ranking of the live corpus + one writer-first
  // LLM pass in the chosen lane. It reuses the SHARED repetitionWindowService so
  // cooldown is computed against one clock and store for the request, and shares
  // the same judge providers + settings-backed resolver as the other LLM paths,
  // so a settings PATCH retargets it on the next call.
  const suggestPostService =
    options.suggestPostService ??
    (() => {
      const workspaceRoot = resolveWorkspaceRoot(process.cwd());
      const providers = workspaceRoot
        ? judgeProviderRegistry.map((entry) =>
            entry.createProvider({ runner: new NodeProcessRunner(), workspaceRoot }),
          )
        : [];

      return new SuggestPostService(
        postLibraryRepository,
        repetitionWindowService,
        new StructuredLlmService({ providers }),
        createSettingsJudgeProviderResolver(settingsRepository),
      );
    })();
  const liveCaptureService =
    options.liveCaptureService ?? new LiveCaptureService(postLibraryRepository);
  const readinessService =
    options.readinessService ??
    new DefaultReadinessService(
      options.readinessDependencies ?? createDefaultReadinessDependencies(),
      options.readinessTimeoutMs ?? readinessTimeoutMsDefault,
    );
  // One repository backs both the settings routes and the judge resolver/model
  // path, so a settings PATCH takes effect on the very next judge call.
  const judgeDraftService =
    options.judgeDraftService ?? createDefaultJudgeDraftService({ settingsRepository });

  // Resolve the persisted account profile for the judge route's fallback. A
  // missing or unreadable settings file yields no profile (undefined), so the
  // judge proceeds profile-less rather than failing the request.
  const resolveSettingsAccountProfile = async (): Promise<string | undefined> => {
    try {
      const { settings } = await settingsRepository.load();
      const profile = settings.accountProfile?.trim();

      return profile === undefined || profile.length === 0 ? undefined : profile;
    } catch {
      return undefined;
    }
  };

  const resolveJudgeAccountProfile = async (
    explicitProfile: string | undefined,
  ): Promise<string | undefined> => {
    const accountProfile = explicitProfile ?? (await resolveSettingsAccountProfile());

    try {
      return await archiveStudioContextResolver.composeJudgeProfile(accountProfile);
    } catch {
      return accountProfile;
    }
  };

  // Default apply-suggestions service: judges the original, rewrites it applying
  // the verdict's annotations and improvements (writer_first_pass), re-judges the
  // rewrite, and enforces the never-worse guard. It shares the judge providers,
  // the same JudgeDraftService the /drafts/judge route uses, the settings-backed
  // provider resolver, and the same profile fallback as the judge route, so a
  // settings PATCH retargets it on the next call.
  const applyJudgeSuggestionsService =
    options.applyJudgeSuggestionsService ??
    (() => {
      const workspaceRoot = resolveWorkspaceRoot(process.cwd());
      const providers = workspaceRoot
        ? judgeProviderRegistry.map((entry) =>
            entry.createProvider({ runner: new NodeProcessRunner(), workspaceRoot }),
          )
        : [];

      return new ApplyJudgeSuggestionsService(
        judgeDraftService,
        new StructuredLlmService({ providers }),
        createSettingsJudgeProviderResolver(settingsRepository),
        () => resolveJudgeAccountProfile(undefined),
      );
    })();

  // Default idea generation: the format path is LLM-driven (writer_variants) and
  // judged via the same JudgeDraftService the /drafts/judge route uses; the
  // idea-only path stays the deterministic stub. The generate step shares the
  // judge providers and the settings-backed provider resolver, so a settings
  // PATCH retargets generation and judging on the next call. The profile resolver
  // forwards no explicit profile, so it falls back to the persisted account
  // profile (composed with any active archive context).
  const buildDefaultGenerateCandidates = (): GenerateCandidates => {
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    // With no resolvable workspace root the provider list is empty, so a format
    // request resolves to a provider_unconfigured generate failure (->
    // generation_failed) rather than throwing at construction.
    const providers = workspaceRoot
      ? judgeProviderRegistry.map((entry) =>
          entry.createProvider({ runner: new NodeProcessRunner(), workspaceRoot }),
        )
      : [];

    const generateIdeasService = new GenerateIdeasService(
      new StructuredLlmService({ providers }),
      judgeDraftService,
      createSettingsJudgeProviderResolver(settingsRepository),
      () => resolveJudgeAccountProfile(undefined),
    );

    // Bind to the constructed instance so `this` survives the function reference;
    // generate's signature matches GenerateCandidates
    // (GenerateIdeaRequest -> Promise<GenerateIdeaResponse>).
    return generateIdeasService.generate.bind(generateIdeasService);
  };
  const generateCandidates: GenerateCandidates =
    options.generateCandidates ?? buildDefaultGenerateCandidates();

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
    } catch (error) {
      if (error instanceof ArchiveValidationError) {
        throw new NormalizedApiError(archiveValidationFailedError());
      }

      if (error instanceof PostLibraryStorageError) {
        throw new NormalizedApiError(archiveStorageFailedError());
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
        throw new NormalizedApiError(archiveStorageFailedError());
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
        throw new NormalizedApiError(archiveValidationFailedError());
      }

      if (error instanceof PostLibraryStorageError) {
        throw new NormalizedApiError(archiveStorageFailedError());
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
        throw new NormalizedApiError(archiveStorageFailedError());
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
        throw new NormalizedApiError(archiveStorageFailedError());
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
        throw new NormalizedApiError(archiveStorageFailedError());
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
        throw new NormalizedApiError(archiveStorageFailedError());
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
        throw new NormalizedApiError(libraryStorageFailedError());
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
        throw new NormalizedApiError(libraryStorageFailedError());
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
        throw new NormalizedApiError(libraryStorageFailedError());
      }

      throw error;
    }
  });

  app.post("/posts/analyze", async (request, reply) => {
    const input = analyzePostsRequestSchema.parse(request.body);
    let result: Awaited<ReturnType<typeof analyzePosts>>;

    try {
      // Resolver ordering is a hard constraint: live context is patched first so
      // it takes precedence, then the archive resolver fills any still-undefined
      // fields. Both only patch fields that are === undefined, so neither
      // overwrites a caller-supplied value.
      let merged = await liveContextResolver.mergeAnalysisRequest(input);
      merged = await archiveStudioContextResolver.mergeAnalysisRequest(merged);
      const analyzed = await analyzePosts(merged);
      // One compute(7) per request for the per-item cooldown attachment.
      const report = await repetitionWindowService.compute(7);
      result = attachCooldownSignals(analyzed, report);
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw new NormalizedApiError(libraryStorageFailedError());
      }

      throw new NormalizedApiError(deterministicAnalysisError());
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
        throw new NormalizedApiError(libraryStorageFailedError());
      }

      throw new NormalizedApiError(generationError());
    }
  });

  app.post("/drafts/judge", async (request, reply) => {
    const input = judgeDraftRequestSchema.parse(request.body);
    // Prefer an explicit profile from the body; otherwise fall back to the
    // persisted settings.accountProfile so the judge's audienceMatch is anchored
    // to the user's configured account. When neither is present, no profile is
    // passed and the model returns a null audienceMatch.
    const accountProfile = await resolveJudgeAccountProfile(input.accountProfile);
    const outcome =
      accountProfile !== undefined
        ? await judgeDraftService.judge(input.text, accountProfile)
        : await judgeDraftService.judge(input.text);

    if (outcome.status === "failed") {
      throw new NormalizedApiError(judgeFailedError(outcome));
    }

    return reply.send(parseResponseContract(judgeDraftResponseSchema, outcome.response));
  });

  app.post("/drafts/apply-suggestions", async (request, reply) => {
    const input = applyJudgeSuggestionsRequestSchema.parse(request.body);

    try {
      const result = await applyJudgeSuggestionsService.apply(input);

      return reply.send(
        parseResponseContract(applyJudgeSuggestionsResponseSchema, result),
      );
    } catch {
      throw new NormalizedApiError(generationError());
    }
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
