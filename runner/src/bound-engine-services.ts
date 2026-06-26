/**
 * BoundEngineServices adapter bundle (XOB-030) — constructs every in-process
 * engine service the 17 `__xbuilder_*` transport bindings map to and adapts each
 * to the structural {@link BoundEngineServices} surface `ExposeFunctionTransport`
 * routes through.
 *
 * The LLM provider round-trip is the only external boundary: the structured-LLM
 * gateway (`llm`) and judge gateway (`judgeLlm`) are injected, so the bundle is
 * exercised in-process with no codex/child-process and no network. Everything
 * else is real — tmpdir-backed JSON repositories, the deterministic analyzer, the
 * resolver chain, and the repetition-window service.
 *
 * Three bindings need shaping the transport does not do:
 *   - `judgeDraft` calls `JudgeDraftService.judge(text, accountProfile)` (positional)
 *     and unwraps the `JudgeDraftOutcome` discriminated union to a `JudgeDraftResponse`.
 *   - `analyzePosts` re-attaches the per-item `cooldown` after the deterministic
 *     pass by joining each scored item's `detectedFormat` to the window report —
 *     the field is schema-optional, so without the join it silently vanishes.
 *   - `getStatus` / `getOverlayReadiness` compose from the engine readiness service
 *     (`getStatus()`), wrapping it into the overlay readiness shape with the
 *     capture observer's state.
 */

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  ArchiveDerivedContextService,
  ArchiveImportService,
  ArchiveStudioContextResolver,
  ApplyJudgeSuggestionsService,
  DeterministicAnalysisService,
  GenerateCategoryService,
  GenerateIdeasService,
  JsonFileAppSettingsRepository,
  JudgeDraftService,
  LiveCaptureService,
  LiveContextResolver,
  RepetitionWindowService,
  SuggestPostService,
  createDefaultReadinessService,
  createSettingsJudgeProviderResolver,
  type JudgeLlmGateway,
  type PostLibraryRepository,
  type ReadinessService,
  type StructuredLlmService,
} from "@x-builder/engine";
import type {
  AnalyzePostsRequest,
  AnalyzePostsResponse,
  CooldownReport,
  JudgeDraftRequest,
  JudgeDraftResponse,
} from "@x-builder/shared";

import type { BoundEngineServices } from "./expose-function-transport.js";
import { getOverlayReadiness, type ObserverLike } from "./overlay-readiness.js";

/**
 * The structured-LLM seam the bundle injects into the LLM-backed services. A real
 * `StructuredLlmService` is structurally assignable; a test fake supplying only
 * `generateStructured` (the single method the services call) is too. The judge
 * gateway narrows to the judge-specialized {@link JudgeLlmGateway}.
 */
export type StructuredLlmGateway = Pick<StructuredLlmService, "generateStructured">;

export interface CreateBoundEngineServicesOptions {
  settingsRepository: JsonFileAppSettingsRepository;
  postLibraryRepository: PostLibraryRepository;
  liveCapture: LiveCaptureService;
  /** Structured-LLM gateway for generate / apply-suggestions / suggest. */
  llm: StructuredLlmGateway;
  /** Judge gateway for judgeDraft and the generate/apply judge passes. */
  judgeLlm: JudgeLlmGateway;
  /** Capture observer whose state drives the overlay readiness capture view. */
  observer: ObserverLike;
  /**
   * Settings root the readiness service probes (storage W_OK + selected-judge).
   * Defaults to the settings repository's own root so a tmpdir bundle never
   * probes `~/.x-builder`.
   */
  settingsRoot?: string;
  /** Pre-built readiness service; defaults to the in-process composer. */
  readinessService?: ReadinessService;
}

// The cooldown window the per-item re-attach joins against — one compute(7) per
// analyze request, mirroring the engine /posts/analyze handler.
const ANALYZE_COOLDOWN_WINDOW_DAYS = 7;

// Re-attach a per-item cooldown signal to each scored item by joining its
// detectedFormat to the precomputed window report. A scored item gets a cooldown
// key ONLY when the report carries an in-window signal for its format; formats
// with no signal leave the key genuinely absent (the field is .optional() in the
// contract). Non-scored items are returned unchanged. This mirrors the private
// `attachCooldownSignals` in engine/src/server/server.ts so the binding adapter
// reproduces the /posts/analyze response exactly.
const attachCooldownSignals = (
  response: AnalyzePostsResponse,
  report: CooldownReport,
): AnalyzePostsResponse => ({
  ...response,
  items: response.items.map((item) => {
    if (item.status !== "scored") {
      return item;
    }

    const signal = report.signals.find((candidate) => candidate.format === item.detectedFormat);

    return signal === undefined ? item : { ...item, cooldown: signal };
  }),
});

// Recover the settings root from the repository's public defaults
// (`storagePath = <root>/storage`) so the readiness service probes the same
// boundary the repository persists to, without reaching for a private field.
const settingsRootOf = (settingsRepository: JsonFileAppSettingsRepository): string =>
  dirname(settingsRepository.defaults().storagePath);

// Resolve the persisted account profile, composed with any active archive
// context — the same fallback the engine LLM routes use. A resolver that throws
// must not fail a judge pass, so failures collapse to a profile-less judge.
const buildAccountProfileResolver = (
  settingsRepository: JsonFileAppSettingsRepository,
  archiveStudioContextResolver: ArchiveStudioContextResolver,
): (() => Promise<string | undefined>) => {
  return async () => {
    try {
      const { settings } = await settingsRepository.load();
      const profile = settings.accountProfile?.trim();
      const base = profile === undefined || profile.length === 0 ? undefined : profile;

      return await archiveStudioContextResolver.composeJudgeProfile(base);
    } catch {
      return undefined;
    }
  };
};

// The generation-guidance budget: the reach/format knowledge base is clipped to
// this many chars (the LLM round-trip stays well under provider arg/stdin limits),
// and the author's own voice is sampled from the most recent original posts.
const MAX_KNOWLEDGE_BASE_CHARS = 24_000;
const VOICE_EXAMPLE_COUNT = 8;

// Resolve the generation guidance block the idea generator grounds drafts in:
// the configured reach/format knowledge base plus the author's own recent
// original posts (captured voice). Never throws — a missing path/corpus simply
// omits that part, and an empty result leaves generation on the base template.
const buildGenerationGuidanceResolver = (
  settingsRepository: JsonFileAppSettingsRepository,
  postLibraryRepository: PostLibraryRepository,
): (() => Promise<string | undefined>) => {
  return async () => {
    const parts: string[] = [];

    try {
      const { settings } = await settingsRepository.load();
      const kbPath = settings.knowledgeBasePath?.trim();
      if (kbPath !== undefined && kbPath.length > 0) {
        const content = (await readFile(kbPath, "utf8")).trim();
        if (content.length > 0) {
          const clipped =
            content.length > MAX_KNOWLEDGE_BASE_CHARS
              ? content.slice(0, MAX_KNOWLEDGE_BASE_CHARS)
              : content;
          parts.push(`# Reach & format playbook\n${clipped}`);
        }
      }
    } catch {
      // No knowledge base / unreadable path: omit it.
    }

    try {
      const store = await postLibraryRepository.loadStore();
      const examples = store.posts
        .filter((post) => post.kind === "original" && typeof post.text === "string")
        .slice(-VOICE_EXAMPLE_COUNT)
        .map((post) => `- ${post.text.replace(/\s+/g, " ").trim()}`);
      if (examples.length > 0) {
        parts.push(`# The author's own recent posts (match this voice — do not copy)\n${examples.join("\n")}`);
      }
    } catch {
      // No captured corpus yet: omit voice grounding.
    }

    return parts.length > 0 ? parts.join("\n\n") : undefined;
  };
};

/**
 * Construct the real `BoundEngineServices` bundle. The LLM gateway is injected;
 * every other collaborator is built in-process over the supplied repositories.
 */
export function createBoundEngineServices(
  options: CreateBoundEngineServicesOptions,
): BoundEngineServices {
  const {
    settingsRepository,
    postLibraryRepository,
    liveCapture,
    llm,
    judgeLlm,
    observer,
  } = options;

  // The generate / apply / suggest services are typed against the concrete
  // StructuredLlmService but only ever call generateStructured. Inject the
  // gateway through that single boundary (the class carries private state the
  // gateway intentionally does not, hence the unknown hop).
  const structuredLlm = llm as unknown as StructuredLlmService;

  // One window service backs both the analyze cooldown re-attach and the
  // live-context resolver's repeatHistory derivation, so the window is computed
  // against one clock and store per request — mirroring buildServer.
  const repetitionWindowService = new RepetitionWindowService(postLibraryRepository);
  const liveContextResolver = new LiveContextResolver(
    postLibraryRepository,
    repetitionWindowService,
  );
  const archiveStudioContextResolver = new ArchiveStudioContextResolver(postLibraryRepository);
  const archiveImportService = new ArchiveImportService({ repository: postLibraryRepository });
  const archiveDerivedContextService = new ArchiveDerivedContextService({
    repository: postLibraryRepository,
  });
  const deterministicAnalysisService = new DeterministicAnalysisService();
  // GenerateCategoryService takes (repo, windowService); a fresh window service
  // matches buildServer's per-service instance.
  const generateCategoryService = new GenerateCategoryService(
    postLibraryRepository,
    new RepetitionWindowService(postLibraryRepository),
  );

  const resolveProvider = createSettingsJudgeProviderResolver(settingsRepository);
  const resolveAccountProfile = buildAccountProfileResolver(
    settingsRepository,
    archiveStudioContextResolver,
  );

  const judgeDraftService = new JudgeDraftService(judgeLlm, resolveProvider);
  const generateIdeasService = new GenerateIdeasService(
    structuredLlm,
    judgeDraftService,
    resolveProvider,
    resolveAccountProfile,
    undefined,
    buildGenerationGuidanceResolver(settingsRepository, postLibraryRepository),
  );
  const applyJudgeSuggestionsService = new ApplyJudgeSuggestionsService(
    judgeDraftService,
    structuredLlm,
    resolveProvider,
    resolveAccountProfile,
  );
  const suggestPostService = new SuggestPostService(
    postLibraryRepository,
    repetitionWindowService,
    structuredLlm,
    resolveProvider,
  );

  const readinessService =
    options.readinessService ??
    createDefaultReadinessService({
      settingsRoot: options.settingsRoot ?? settingsRootOf(settingsRepository),
    });

  return {
    getStatus: () => Promise.resolve(readinessService.getStatus()),

    getOverlayReadiness: () =>
      getOverlayReadiness(
        {
          // The engine readiness service exposes getStatus(); the overlay
          // composer reads getSubsystems(). Map the static (deterministic) and
          // judge (llm) subsystems across.
          getSubsystems: async () => {
            const status = await readinessService.getStatus();
            return { staticEngine: status.deterministic, llm: status.llm };
          },
        },
        observer,
      ),

    settingsRepository: {
      getSettings: () => settingsRepository.load(),
      updateSettings: (request) => settingsRepository.save(request),
    },

    archiveImportService: {
      validate: (request) => Promise.resolve(archiveImportService.validate(request)),
      import: (request) => archiveImportService.importTweets(request),
    },

    archiveDerivedContextService: {
      getActiveContext: () => archiveDerivedContextService.activeContext(),
      activateContext: () => archiveDerivedContextService.activateLatest(),
      deactivateContext: () => archiveDerivedContextService.deactivate(),
    },

    liveContextResolver: {
      mergeAnalysisRequest: (request: AnalyzePostsRequest) =>
        liveContextResolver.mergeAnalysisRequest(request),
    },

    archiveStudioContextResolver: {
      mergeAnalysisRequest: (request: AnalyzePostsRequest) =>
        archiveStudioContextResolver.mergeAnalysisRequest(request),
    },

    deterministicAnalysisService: {
      // Deterministic pass, then re-attach the per-item cooldown from a single
      // compute(7) — the field is schema-optional and vanishes without this.
      analyzePosts: async (request: AnalyzePostsRequest) => {
        const analyzed = deterministicAnalysisService.analyzePosts(request);
        const report = await repetitionWindowService.compute(ANALYZE_COOLDOWN_WINDOW_DAYS);
        return attachCooldownSignals(analyzed, report);
      },
    },

    judgeDraftService: {
      // Map the request object to the positional judge call and unwrap the
      // outcome union to a JudgeDraftResponse. A failed outcome is a contract
      // error the transport propagates (nothing is swallowed).
      judge: async (request: JudgeDraftRequest): Promise<JudgeDraftResponse> => {
        const outcome =
          request.accountProfile !== undefined
            ? await judgeDraftService.judge(request.text, request.accountProfile)
            : await judgeDraftService.judge(request.text);

        if (outcome.status !== "judged") {
          throw new Error(`Judge failed (${outcome.code}): ${outcome.message}`);
        }

        return outcome.response;
      },
    },

    generateIdeasService: {
      generate: (request) => generateIdeasService.generate(request),
    },

    suggestPostService: {
      suggest: (request) => suggestPostService.suggest(request),
    },

    repetitionWindowService: {
      compute: (windowDays) => repetitionWindowService.compute(windowDays),
    },

    liveCaptureService: {
      summary: () => liveCapture.summary(),
    },

    generateCategoryService: {
      getCategories: () => generateCategoryService.getCategories(),
    },

    applyJudgeSuggestionsService: {
      apply: (request) => applyJudgeSuggestionsService.apply(request),
    },
  };
}
