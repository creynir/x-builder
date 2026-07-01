import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type {
  AnalyzePostsRequest,
  AnalyzePostsResponse,
  GenerateIdeaRequest,
  GenerateReplyVariantsRequest,
  GenerateReplyVariantsResponse,
  RecordGeneratedReplyRequest,
  RecordGeneratedReplyResponse,
} from "@x-builder/shared";

import { ArchiveDerivedContextService } from "../archive/archive-derived-context-service.js";
import { ArchiveImportService } from "../archive/archive-import-service.js";
import { ArchiveStudioContextResolver } from "../archive/archive-studio-context-resolver.js";
import { LiveCaptureService } from "../capture/live-capture-service.js";
import { LiveContextResolver } from "../capture/live-context-resolver.js";
import { RepetitionWindowService } from "../capture/repetition-window-service.js";
import { DeterministicAnalysisService } from "../deterministic/deterministic-analysis-service.js";
import { ReplyThreadContextResolver } from "../reply-thread-context-resolver.js";
import { ExternalXSignalsService } from "../external/external-x-signals-service.js";
import type { ExternalXSignalsRepository } from "../external/external-x-signals-repository.js";
import { SqliteExternalXSignalsRepository } from "../external/sqlite-external-x-signals-repository.js";
import type { FeedbackLoopRepository } from "../feedback/feedback-loop-repository.js";
import { FeedbackLoopService } from "../feedback/feedback-loop-service.js";
import { SqliteFeedbackLoopRepository } from "../feedback/sqlite-feedback-loop-repository.js";
import type { GeneratedReplyLedgerRepository } from "../generated-replies/generated-reply-ledger-repository.js";
import { SqliteGeneratedReplyLedgerRepository } from "../generated-replies/sqlite-generated-reply-ledger-repository.js";
import { ApplyJudgeSuggestionsService } from "../llm/apply-judge-suggestions-service.js";
import { resolveDefaultKnowledgeBasePath } from "../llm/default-knowledge-base.js";
import { createExternalPatternGuidanceProvider } from "../llm/external-pattern-guidance.js";
import {
  createGenerationGuidanceResolver,
  type CreateGenerationGuidanceResolverInput,
} from "../llm/generation-guidance.js";
import { GenerateIdeasService } from "../llm/generate-ideas-service.js";
import { GenerateReplyVariantsService } from "../llm/generate-reply-variants-service.js";
import {
  JudgeDraftService,
  type JudgeDraft,
} from "../llm/judge-draft-service.js";
import { createSettingsJudgeProviderResolver } from "../llm/judge-provider-resolver.js";
import { judgeProviderRegistry } from "../llm/judge-provider-registry.js";
import { NodeProcessRunner, type ProcessRunner } from "../llm/process-runner.js";
import { StructuredLlmService } from "../llm/structured-llm-service.js";
import { GenerateCategoryService } from "../suggest/generate-category-service.js";
import { SuggestPostService } from "../suggest/suggest-post-service.js";
import {
  ArchiveVoiceProfileService,
  createArchiveVoiceProfileProvider,
} from "../voice/archive-voice-profile-service.js";
import { createSqliteVoiceSampleProvider } from "../voice/sqlite-voice-sample-provider.js";
import { defaultSettingsRoot } from "./constants.js";
import { importPostLibraryJsonToSqlite } from "./import-post-library-json.js";
import { openEngineDatabase } from "./open-engine-database.js";
import {
  type AppSettingsRepository,
  JsonFileAppSettingsRepository,
} from "./settings-repository.js";
import {
  type PostLibraryRepository,
} from "./post-library-repository.js";
import type { ObservedThreadRepository } from "../reply-thread-context-repository.js";
import {
  createDefaultReadinessDependencies,
  createReadinessService,
  defaultReadinessTimeoutMs,
  type ReadinessDependencies,
  type ReadinessService,
} from "./readiness.js";
import { SqlitePostLibraryRepository } from "./sqlite-post-library-repository.js";
import { SqliteObservedThreadRepository } from "./sqlite-observed-thread-repository.js";
import { resolveWorkspaceRoot } from "./workspace-root.js";

export type AnalyzePosts = (request: AnalyzePostsRequest) => Promise<AnalyzePostsResponse> | AnalyzePostsResponse;

export type GenerateCandidates = (input: GenerateIdeaRequest) => Promise<unknown> | unknown;
export type GenerateReplyVariants = (
  input: GenerateReplyVariantsRequest,
) => Promise<GenerateReplyVariantsResponse> | GenerateReplyVariantsResponse;
export type RecordGeneratedReply = (
  input: RecordGeneratedReplyRequest,
) => Promise<RecordGeneratedReplyResponse> | RecordGeneratedReplyResponse;

export interface BuildServerOptions {
  allowedCorsOrigins?: readonly string[];
  analyzePosts?: AnalyzePosts;
  generateCandidates?: GenerateCandidates;
  generateReplyVariants?: GenerateReplyVariants;
  recordGeneratedReply?: RecordGeneratedReply;
  readinessDependencies?: ReadinessDependencies;
  readinessService?: ReadinessService;
  readinessTimeoutMs?: number;
  settingsRepository?: AppSettingsRepository;
  postLibraryRepository?: PostLibraryRepository;
  observedThreadRepository?: ObservedThreadRepository;
  feedbackLoopService?: FeedbackLoopService;
  externalXSignalsService?: ExternalXSignalsService;
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
  replyThreadContextResolver?: ReplyThreadContextResolver;
  liveCaptureService?: LiveCaptureService;
}

export type CreateDefaultJudgeDraftServiceOptions = {
  startupCwd?: string;
  runner?: ProcessRunner;
  settingsRepository?: AppSettingsRepository;
};

type EngineStorageRepositories = {
  db?: ReturnType<typeof openEngineDatabase>;
  postLibraryRepository: PostLibraryRepository;
  observedThreadRepository: ObservedThreadRepository;
  feedbackLoopRepository: FeedbackLoopRepository;
  externalXSignalsRepository: ExternalXSignalsRepository;
  generatedReplyLedgerRepository: GeneratedReplyLedgerRepository;
  voiceSampleProvider?: CreateGenerationGuidanceResolverInput["voiceSampleProvider"];
};

export type ServerServiceBundle = {
  analyzePosts: AnalyzePosts;
  settingsRepository: AppSettingsRepository;
  postLibraryRepository: PostLibraryRepository;
  feedbackLoopService: FeedbackLoopService;
  externalXSignalsService: ExternalXSignalsService;
  archiveImportService: ArchiveImportService;
  archiveDerivedContextService: ArchiveDerivedContextService;
  archiveStudioContextResolver: ArchiveStudioContextResolver;
  repetitionWindowService: RepetitionWindowService;
  liveContextResolver: LiveContextResolver;
  replyThreadContextResolver: ReplyThreadContextResolver;
  generateCategoryService: GenerateCategoryService;
  suggestPostService: SuggestPostService;
  liveCaptureService: LiveCaptureService;
  readinessService: ReadinessService;
  judgeDraftService: JudgeDraft;
  applyJudgeSuggestionsService: ApplyJudgeSuggestionsService;
  generateCandidates: GenerateCandidates;
  generateReplyVariants: GenerateReplyVariants;
  recordGeneratedReply: RecordGeneratedReply;
  resolveJudgeAccountProfile: (explicitProfile: string | undefined) => Promise<string | undefined>;
};

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
  const providers = workspaceRoot
    ? judgeProviderRegistry.map((entry) => entry.createProvider({ runner, workspaceRoot }))
    : [];

  const resolveProvider = createSettingsJudgeProviderResolver(settingsRepository);
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

const resolveEngineStorageRepositories = (
  options: BuildServerOptions,
): EngineStorageRepositories => {
  if (options.postLibraryRepository) {
    const db = openEngineDatabase(":memory:");

    return {
      postLibraryRepository: options.postLibraryRepository,
      observedThreadRepository:
        options.observedThreadRepository ?? new SqliteObservedThreadRepository(db),
      feedbackLoopRepository: new SqliteFeedbackLoopRepository(db),
      externalXSignalsRepository: new SqliteExternalXSignalsRepository(db),
      generatedReplyLedgerRepository: new SqliteGeneratedReplyLedgerRepository(db),
    };
  }

  if (options.storageRoot !== undefined) {
    const storageDir = join(options.storageRoot, "storage");
    mkdirSync(storageDir, { recursive: true });
    const db = openEngineDatabase(join(storageDir, "x-builder.db"));
    importPostLibraryJsonToSqlite(storageDir, db);

    return {
      db,
      postLibraryRepository: new SqlitePostLibraryRepository(db),
      observedThreadRepository:
        options.observedThreadRepository ?? new SqliteObservedThreadRepository(db),
      feedbackLoopRepository: new SqliteFeedbackLoopRepository(db),
      externalXSignalsRepository: new SqliteExternalXSignalsRepository(db),
      generatedReplyLedgerRepository: new SqliteGeneratedReplyLedgerRepository(db),
      voiceSampleProvider: createSqliteVoiceSampleProvider({ db }),
    };
  }

  const db = openEngineDatabase(":memory:");

  return {
    db,
    postLibraryRepository: new SqlitePostLibraryRepository(db),
    observedThreadRepository:
      options.observedThreadRepository ?? new SqliteObservedThreadRepository(db),
    feedbackLoopRepository: new SqliteFeedbackLoopRepository(db),
    externalXSignalsRepository: new SqliteExternalXSignalsRepository(db),
    generatedReplyLedgerRepository: new SqliteGeneratedReplyLedgerRepository(db),
    voiceSampleProvider: createSqliteVoiceSampleProvider({ db }),
  };
};

export const createServerServiceBundle = (
  options: BuildServerOptions = {},
): ServerServiceBundle => {
  const deterministicAnalysisService = new DeterministicAnalysisService();
  const defaultAnalyzePosts: AnalyzePosts = (request) => deterministicAnalysisService.analyzePosts(request);
  const analyzePosts = options.analyzePosts ?? defaultAnalyzePosts;
  const settingsRepository =
    options.settingsRepository ?? new JsonFileAppSettingsRepository({ root: defaultSettingsRoot });
  const engineStorage = resolveEngineStorageRepositories(options);
  const postLibraryRepository = engineStorage.postLibraryRepository;
  const feedbackLoopService =
    options.feedbackLoopService ??
    new FeedbackLoopService({
      feedbackRepository: engineStorage.feedbackLoopRepository,
      postLibraryRepository,
    });
  const usesDefaultExternalXSignalsService = options.externalXSignalsService === undefined;
  const externalXSignalsService =
    options.externalXSignalsService ??
    new ExternalXSignalsService({ repository: engineStorage.externalXSignalsRepository });
  const archiveImportService = new ArchiveImportService({ repository: postLibraryRepository });
  const archiveDerivedContextService = new ArchiveDerivedContextService({
    repository: postLibraryRepository,
  });
  const archiveStudioContextResolver = new ArchiveStudioContextResolver(postLibraryRepository);
  const repetitionWindowService =
    options.repetitionWindowService ?? new RepetitionWindowService(postLibraryRepository);
  const liveContextResolver =
    options.liveContextResolver ??
    new LiveContextResolver(postLibraryRepository, repetitionWindowService);
  const replyThreadContextResolver =
    options.replyThreadContextResolver ??
    new ReplyThreadContextResolver(engineStorage.observedThreadRepository);
  const generateCategoryService =
    options.generateCategoryService ??
    new GenerateCategoryService(
      postLibraryRepository,
      new RepetitionWindowService(postLibraryRepository),
    );
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
    options.liveCaptureService ??
    new LiveCaptureService(postLibraryRepository, engineStorage.observedThreadRepository);
  const readinessService =
    options.readinessService ??
    createReadinessService(
      options.readinessDependencies ?? createDefaultReadinessDependencies(),
      options.readinessTimeoutMs ?? defaultReadinessTimeoutMs,
    );
  const judgeDraftService =
    options.judgeDraftService ?? createDefaultJudgeDraftService({ settingsRepository });

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

  const buildDefaultGenerateCandidates = (): GenerateCandidates => {
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    const providers = workspaceRoot
      ? judgeProviderRegistry.map((entry) =>
          entry.createProvider({ runner: new NodeProcessRunner(), workspaceRoot }),
        )
      : [];

    const structuredLlm = new StructuredLlmService({ providers });
    const resolveProvider = createSettingsJudgeProviderResolver(settingsRepository);
    const archiveVoiceProfileProvider =
      engineStorage.db === undefined
        ? undefined
        : createArchiveVoiceProfileProvider(
            new ArchiveVoiceProfileService({
              db: engineStorage.db,
              llm: structuredLlm,
              resolveProvider,
              resolveModel: async (provider) => {
                try {
                  const { settings } = await settingsRepository.load();
                  const modelKey = judgeProviderModelKeys[provider as keyof typeof judgeProviderModelKeys];
                  const model = modelKey === undefined ? undefined : settings[modelKey]?.trim();

                  return model === undefined || model.length === 0 ? undefined : model;
                } catch {
                  return undefined;
                }
              },
            }),
          );

    const generateIdeasService = new GenerateIdeasService(
      structuredLlm,
      judgeDraftService,
      resolveProvider,
      () => resolveJudgeAccountProfile(undefined),
      undefined,
      createGenerationGuidanceResolver({
        settingsRepository,
        postLibraryRepository,
        generatedReplyLedgerRepository: engineStorage.generatedReplyLedgerRepository,
        ...(archiveVoiceProfileProvider === undefined
          ? {}
          : { archiveVoiceProfileProvider }),
        ...(engineStorage.voiceSampleProvider === undefined
          ? {}
          : { voiceSampleProvider: engineStorage.voiceSampleProvider }),
        ...(workspaceRoot === null
          ? {}
          : { defaultKnowledgeBasePath: resolveDefaultKnowledgeBasePath(workspaceRoot) }),
        ...(usesDefaultExternalXSignalsService
          ? {
              externalPatternGuidanceProvider: createExternalPatternGuidanceProvider(
                engineStorage.externalXSignalsRepository,
              ),
            }
          : {}),
      }),
    );

    return generateIdeasService.generate.bind(generateIdeasService);
  };
  const generateCandidates: GenerateCandidates =
    options.generateCandidates ?? buildDefaultGenerateCandidates();
  const buildDefaultGenerateReplyVariants = (): GenerateReplyVariants => {
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    const providers = workspaceRoot
      ? judgeProviderRegistry.map((entry) =>
          entry.createProvider({ runner: new NodeProcessRunner(), workspaceRoot }),
        )
      : [];

    const service = new GenerateReplyVariantsService(
      new StructuredLlmService({ providers }),
      createSettingsJudgeProviderResolver(settingsRepository),
    );

    return service.generate.bind(service);
  };
  const generateReplyVariants: GenerateReplyVariants =
    options.generateReplyVariants ?? buildDefaultGenerateReplyVariants();
  const recordGeneratedReply: RecordGeneratedReply =
    options.recordGeneratedReply ??
    ((request) => engineStorage.generatedReplyLedgerRepository.recordGeneratedReply(request));

  return {
    analyzePosts,
    settingsRepository,
    postLibraryRepository,
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
  };
};
