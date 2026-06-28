/**
 * Failing tests for ExposeFunctionTransport.bindAll.
 *
 * The module under test (`./expose-function-transport`) does not exist yet, so
 * the import below resolves to nothing until the implementation lands. That is
 * the intended Red state: these tests fail on a missing module, not on a logic
 * error in the test itself.
 *
 * Subject:
 *   class ExposeFunctionTransport {
 *     static bindAll(page: PageLike, services: BoundEngineServices): Promise<void>
 *   }
 *
 * `bindAll` registers all 20 `__xbuilder_<method>` bindings on the page via
 * `page.exposeFunction`. Each handler: parse the raw arg with the method's
 * request schema, call the bound service/handler, parse the result with the
 * method's response schema, return it. Zod errors propagate — never swallowed.
 *
 * BoundEngineServices surface this test pins down (Green must match exactly):
 *   - getStatus:               () => Promise<AppStatus>            (handler)
 *   - getOverlayReadiness:     () => Promise<OverlayReadiness>     (handler)
 *   - settingsRepository:           { getSettings, updateSettings }
 *   - archiveImportService:         { validate, import }
 *   - archiveDerivedContextService: { getActiveContext, activateContext, deactivateContext }
 *   - liveContextResolver:          { mergeAnalysisRequest }
 *   - archiveStudioContextResolver: { mergeAnalysisRequest }
 *   - deterministicAnalysisService: { analyzePosts }
 *   - judgeDraftService:            { judge }
 *   - generateIdeasService:         { generate }
 *   - suggestPostService:           { suggest }
 *   - repetitionWindowService:      { compute }
 *   - liveCaptureService:           { summary }
 *   - generateCategoryService:      { getCategories }
 *   - applyJudgeSuggestionsService: { apply }
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENGINE_TRANSPORT_BINDINGS,
  appSettingsResponseSchema,
  appStatusSchema,
  applyJudgeSuggestionsResponseSchema,
  archiveContextActivationResponseSchema,
  activeArchiveContextSchema,
  analyzePostsResponseSchema,
  archiveTweetsValidateResponseSchema,
  archiveTweetsImportResponseSchema,
  captureSummarySchema,
  cooldownReportSchema,
  generateCategorySchema,
  generateIdeaResponseSchema,
  getFeedbackLoopSummaryResponseSchema,
  judgeDraftRequestSchema,
  judgeDraftResponseSchema,
  linkFeedbackPredictionResponseSchema,
  overlayReadinessSchema,
  recordFeedbackPredictionResponseSchema,
  suggestPostResponseSchema,
} from "@x-builder/shared";

import { ExposeFunctionTransport, type BoundEngineServices } from "./expose-function-transport";

// ---------------------------------------------------------------------------
// Schema-valid response fixtures
// ---------------------------------------------------------------------------

const NOW_ISO = "2026-06-21T12:00:00.000Z";

function subsystemStatus(state: "ready" | "partial" | "unavailable" = "ready") {
  return {
    state,
    label: "ok",
    retryable: true,
    checkedAt: NOW_ISO,
    details: {},
  };
}

// A full 13-dimension judge verdict (all behavioral dims required; audienceMatch
// nullable on the wire). Reused by judge / generate-idea / apply-suggestions.
function verdictWithOverall(overall: number) {
  const score = Math.max(0, Math.min(100, overall));
  return {
    verdict: "post_now" as const,
    confidence: "high" as const,
    scores: {
      overall: score,
      replies: score,
      profileClicks: score,
      impressions: score,
      bookmarkValue: score,
      dwellProxy: score,
      voiceMatch: score,
      negativeRisk: score,
      answerEffort: score,
      strangerAnswerability: score,
      statusDependency: score,
      replyVsQuoteOrientation: score,
      audienceMatch: null,
    },
    headline: "Strong post",
    strengths: ["clear"],
    improvements: [],
    annotations: [],
  };
}

const appStatusResponse = {
  overall: "ready" as const,
  version: "1.0.0",
  generatedAt: NOW_ISO,
  engine: subsystemStatus(),
  deterministic: subsystemStatus(),
  llm: subsystemStatus(),
  storage: subsystemStatus(),
  lastRun: { state: "none" as const },
};

const overlayReadinessResponse = {
  staticEngine: subsystemStatus(),
  llm: subsystemStatus(),
  capture: {
    state: "ok" as const,
    label: "Capturing",
    checkedAt: NOW_ISO,
  },
};

const appSettingsResponse = {
  settings: {
    engineBaseUrl: "http://localhost:4000",
    storagePath: "/tmp/x-builder",
    judgeProvider: "codex-cli" as const,
    showDeterministicDetails: true,
  },
  source: "defaults" as const,
};

const activeContextResponse = { status: "empty" as const };

const activationResponse = {
  activeContext: { status: "empty" as const },
  eligibility: { eligible: false, blockingReasons: [], warningReasons: [] },
};

const validateArchiveResponse = {
  status: "invalid" as const,
  file: { fileName: "tweets.js", fileSizeBytes: 1024 },
  availability: {
    postIds: true,
    text: true,
    createdTimes: true,
    replyRefs: false,
    language: false,
    entities: false,
    favoriteCount: false,
    retweetCount: false,
  },
  counts: {
    totalRecords: 0,
    validPosts: 0,
    skippedRecords: 0,
    originals: 0,
    replies: 0,
    repostReferences: 0,
  },
  duplicatePreview: { duplicateRecords: 0, duplicatePlatformPostIds: [] },
  warnings: [],
};

const importArchiveResponse = {
  importRun: {
    id: "run-1",
    sourceHash: `sha256:${"a".repeat(64)}`,
    assignmentPath: "primary",
    status: "completed" as const,
    counts: {
      totalRecords: 0,
      validPosts: 0,
      skippedRecords: 0,
      originals: 0,
      replies: 0,
      repostReferences: 0,
      insertedPosts: 0,
      updatedPosts: 0,
      unchangedPosts: 0,
    },
    duplicates: { duplicateRecords: 0, duplicatePlatformPostIds: [] },
    warnings: [],
    createdAt: NOW_ISO,
  },
  previews: [],
};

const analyzePostsResponse = {
  items: [
    {
      status: "score_failed" as const,
      id: "p1",
      text: "Hello world",
      reason: "analysis_failed" as const,
      message: "no scorer wired in this mock",
      retryable: true,
    },
  ],
};

const judgeResponse = {
  status: "judged" as const,
  verdict: verdictWithOverall(90),
  model: "codex-cli",
  judgedAt: NOW_ISO,
};

const candidate = (id: string) => ({
  id,
  format: "one-liner" as const,
  text: "A generated idea.",
});

const generateIdeasResponse = {
  candidates: [candidate("c1"), candidate("c2"), candidate("c3")],
};

const cooldownReport = (windowDays: number) => ({
  windowDays,
  generatedAt: NOW_ISO,
  corpusSource: "empty" as const,
  signals: [],
});

const suggestPostResponse = {
  status: "insufficient_corpus" as const,
  suggestions: [],
  cooldown: cooldownReport(7),
  minimumCorpusSize: 10 as const,
};

const captureSummaryResponse = { postsCaptured: 0 };

const generateCategoriesResponse = [
  {
    id: "cat-1",
    label: "Questions",
    format: "genuine_question" as const,
    basis: "default" as const,
    cooldownStatus: "clear" as const,
    sampleCount: 0,
  },
];

const applyJudgeSuggestionsResponse = {
  text: "An improved draft.",
  verdict: verdictWithOverall(88),
  approved: true,
  improvedOverOriginal: true,
};

const feedbackPredictionRecord = {
  id: "feedback-1",
  clientEventId: "event-1",
  action: "generated_draft_written" as const,
  platform: "x" as const,
  text: "A feedback draft.",
  contentHash: `sha256:${"b".repeat(64)}`,
  detectedFormat: "insight_share" as const,
  sourceFormat: "mini-framework" as const,
  scoreValue: 72,
  prediction: {
    status: "available" as const,
    signals: [],
    predictedMidImpressions: 480,
    stallRange: { low: 200, high: 420 },
    escapeRange: { low: 900, high: 2600 },
    escapeProbability: 0.18,
    expectedReplies: 4,
    baseImpressions: 320,
    baseSource: "follower_estimate" as const,
    qualityBasis: "static" as const,
    reachModelVersion: "reach-v1",
  },
  scoringContext: { followers: 1_200 },
  analyzerVersion: "deterministic-v1",
  analyzedAt: NOW_ISO,
  createdAt: NOW_ISO,
};

const feedbackLink = {
  predictionId: "feedback-1",
  platform: "x" as const,
  platformPostId: "1800000000000000001",
  method: "manual_platform_post_id" as const,
  linkedAt: NOW_ISO,
};

const recordFeedbackPredictionResponse = {
  record: feedbackPredictionRecord,
  duplicate: false,
};

const linkFeedbackPredictionResponse = { link: feedbackLink };

const getFeedbackLoopSummaryResponse = {
  generatedAt: NOW_ISO,
  windowDays: 90,
  totals: {
    predictions: 1,
    linked: 0,
    pendingUnlinked: 1,
    ambiguous: 0,
    partialActuals: 0,
    actuals: 0,
  },
  formatLearnings: [
    {
      format: "insight_share" as const,
      predictionCount: 1,
      linkedCount: 0,
      actualCount: 0,
      direction: "insufficient_data" as const,
      adjustment: "More linked outcomes are needed before adjusting this format.",
    },
  ],
  recent: [{ status: "pending_unlinked" as const, prediction: feedbackPredictionRecord }],
};

// ---------------------------------------------------------------------------
// Mock Page that records [name, handler] pairs so handlers can be invoked
// ---------------------------------------------------------------------------

type ExposedHandler = (rawArg: unknown) => unknown | Promise<unknown>;

function createMockPage() {
  const handlers = new Map<string, ExposedHandler>();
  const exposeFunction = vi.fn(async (name: string, handler: ExposedHandler) => {
    handlers.set(name, handler);
  });
  return { page: { exposeFunction }, handlers, exposeFunction };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function busyGuardErrorFor(method: string) {
  return {
    code: "llm_binding_busy",
    scope: "llm_binding_guard",
    retryable: true,
    retryAfterMs: expect.any(Number),
    method,
  };
}

function rateLimitGuardErrorFor(method: string) {
  return {
    code: "llm_binding_rate_limited",
    scope: "llm_binding_guard",
    retryable: true,
    retryAfterMs: expect.any(Number),
    method,
  };
}

// ---------------------------------------------------------------------------
// Mock BoundEngineServices: every method is a vi.fn() returning a valid shape
// ---------------------------------------------------------------------------

function createMockServices() {
  const getStatus = vi.fn(async () => appStatusResponse);
  const getOverlayReadiness = vi.fn(async () => overlayReadinessResponse);

  const settingsRepository = {
    getSettings: vi.fn(async () => appSettingsResponse),
    updateSettings: vi.fn(async () => appSettingsResponse),
  };

  const archiveImportService = {
    validate: vi.fn(async () => validateArchiveResponse),
    import: vi.fn(async () => importArchiveResponse),
  };

  const archiveDerivedContextService = {
    getActiveContext: vi.fn(async () => activeContextResponse),
    activateContext: vi.fn(async () => activationResponse),
    deactivateContext: vi.fn(async () => activationResponse),
  };

  // The two resolvers in the analyzePosts chain return a merged request. The
  // shape they return is opaque to this transport — it forwards through the
  // chain. We echo the input so the deterministic service receives a request.
  const liveContextResolver = {
    mergeAnalysisRequest: vi.fn(async (req: unknown) => req),
  };
  const archiveStudioContextResolver = {
    mergeAnalysisRequest: vi.fn(async (req: unknown) => req),
  };
  const deterministicAnalysisService = {
    analyzePosts: vi.fn(async () => analyzePostsResponse),
  };

  const judgeDraftService = {
    judge: vi.fn(async () => judgeResponse),
  };
  const generateIdeasService = {
    generate: vi.fn(async () => generateIdeasResponse),
  };
  const suggestPostService = {
    suggest: vi.fn(async () => suggestPostResponse),
  };
  const repetitionWindowService = {
    compute: vi.fn(async (windowDays?: number) => cooldownReport(windowDays ?? 7)),
  };
  const liveCaptureService = {
    summary: vi.fn(async () => captureSummaryResponse),
  };
  const generateCategoryService = {
    getCategories: vi.fn(async () => generateCategoriesResponse),
  };
  const applyJudgeSuggestionsService = {
    apply: vi.fn(async () => applyJudgeSuggestionsResponse),
  };
  const feedbackLoopService = {
    recordPrediction: vi.fn(async () => recordFeedbackPredictionResponse),
    linkPrediction: vi.fn(async () => linkFeedbackPredictionResponse),
    getSummary: vi.fn(async () => getFeedbackLoopSummaryResponse),
  };

  const services = {
    getStatus,
    getOverlayReadiness,
    settingsRepository,
    archiveImportService,
    archiveDerivedContextService,
    liveContextResolver,
    archiveStudioContextResolver,
    deterministicAnalysisService,
    judgeDraftService,
    generateIdeasService,
    suggestPostService,
    repetitionWindowService,
    liveCaptureService,
    generateCategoryService,
    applyJudgeSuggestionsService,
    feedbackLoopService,
  };

  return services as unknown as BoundEngineServices & typeof services;
}

// Resolve a binding string from the live registry by method name. Throws if the
// method is absent so a renamed/removed binding fails loudly rather than reading
// as undefined. The 17-name assertion still derives its expectation from the
// live registry, so the registered-name set cannot drift.
function binding(method: string): string {
  const name = ENGINE_TRANSPORT_BINDINGS[method];
  if (name === undefined) {
    throw new Error(`No binding registered for method "${method}".`);
  }
  return name;
}

const B = {
  getOverlayReadiness: binding("getOverlayReadiness"),
  getStatus: binding("getStatus"),
  getSettings: binding("getSettings"),
  updateSettings: binding("updateSettings"),
  validateArchive: binding("validateArchive"),
  importArchive: binding("importArchive"),
  getActiveContext: binding("getActiveContext"),
  activateContext: binding("activateContext"),
  deactivateContext: binding("deactivateContext"),
  analyzePosts: binding("analyzePosts"),
  judgeDraft: binding("judgeDraft"),
  generateIdeas: binding("generateIdeas"),
  suggestPost: binding("suggestPost"),
  getCooldown: binding("getCooldown"),
  getCaptureSummary: binding("getCaptureSummary"),
  getGenerateCategories: binding("getGenerateCategories"),
  applyJudgeSuggestions: binding("applyJudgeSuggestions"),
  recordFeedbackPrediction: binding("recordFeedbackPrediction"),
  linkFeedbackPrediction: binding("linkFeedbackPrediction"),
  getFeedbackLoopSummary: binding("getFeedbackLoopSummary"),
} as const;

let mockPage: ReturnType<typeof createMockPage>;
let services: ReturnType<typeof createMockServices>;

beforeEach(() => {
  mockPage = createMockPage();
  services = createMockServices();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExposeFunctionTransport.bindAll — registration", () => {
  it("registers exactly the 20 binding names from ENGINE_TRANSPORT_BINDINGS", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const expected = Object.values(B).slice().sort();
    const registered = [...mockPage.handlers.keys()].sort();

    expect(registered).toEqual(expected);
    expect(registered).toHaveLength(20);
  });

  it("calls page.exposeFunction once per binding with a function handler", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    expect(mockPage.exposeFunction).toHaveBeenCalledTimes(20);
    for (const name of Object.values(B)) {
      expect(mockPage.handlers.get(name)).toBeTypeOf("function");
    }
  });
});

describe("ExposeFunctionTransport — sample routing (judgeDraft)", () => {
  it("parses the request, calls judgeDraftService.judge, and returns a schema-valid response", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.judgeDraft);
    expect(handler).toBeTypeOf("function");

    const request = { text: "Is this a good post?", accountProfile: "founder" };
    const result = await handler!(request);

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);
    // The service receives the schema-parsed request (trimmed, validated).
    const parsedRequest = judgeDraftRequestSchema.parse(request);
    expect(services.judgeDraftService.judge).toHaveBeenCalledWith(parsedRequest);

    expect(() => judgeDraftResponseSchema.parse(result)).not.toThrow();
  });
});

describe("ExposeFunctionTransport — invalid input propagates", () => {
  it("rejects when the request fails the request schema and does not call the service", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.judgeDraft)!;

    // Empty text fails judgeDraftRequestSchema (min(1) after trim).
    await expect(handler({ text: "   " })).rejects.toThrow();
    // A non-object arg also fails.
    await expect(handler(42)).rejects.toThrow();

    expect(services.judgeDraftService.judge).not.toHaveBeenCalled();
  });
});

describe("ExposeFunctionTransport — getCooldown optional arg", () => {
  it("resolves to a valid CooldownReport when invoked with no argument", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.getCooldown)!;
    const result = await handler(undefined);

    expect(services.repetitionWindowService.compute).toHaveBeenCalledTimes(1);
    expect(() => cooldownReportSchema.parse(result)).not.toThrow();
  });

  it("forwards positional windowDays to RepetitionWindowService.compute when provided", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.getCooldown)!;
    const result = await handler(14);

    expect(services.repetitionWindowService.compute).toHaveBeenCalledWith(14);
    const parsed = cooldownReportSchema.parse(result);
    expect(parsed.windowDays).toBe(14);
  });

  it("keeps the legacy raw object windowDays shape working", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.getCooldown)!;
    const result = await handler({ windowDays: 21 });

    expect(services.repetitionWindowService.compute).toHaveBeenCalledWith(21);
    const parsed = cooldownReportSchema.parse(result);
    expect(parsed.windowDays).toBe(21);
  });
});

describe("ExposeFunctionTransport — no-arg methods", () => {
  it("getCaptureSummary called with undefined returns a schema-valid CaptureSummary", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.getCaptureSummary)!;
    const result = await handler(undefined);

    expect(services.liveCaptureService.summary).toHaveBeenCalledTimes(1);
    expect(() => captureSummarySchema.parse(result)).not.toThrow();
  });

  it("getStatus is a passed-in handler invoked with no meaningful arg", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.getStatus)!;
    const result = await handler(undefined);

    expect(services.getStatus).toHaveBeenCalledTimes(1);
    expect(() => appStatusSchema.parse(result)).not.toThrow();
  });

  it("getOverlayReadiness is a passed-in handler returning a valid OverlayReadiness", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const handler = mockPage.handlers.get(B.getOverlayReadiness)!;
    const result = await handler(undefined);

    expect(services.getOverlayReadiness).toHaveBeenCalledTimes(1);
    expect(() => overlayReadinessSchema.parse(result)).not.toThrow();
  });
});

describe("ExposeFunctionTransport — remaining bindings round-trip their response schema", () => {
  it("getSettings returns a valid AppSettingsResponse", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.getSettings)!(undefined);
    expect(services.settingsRepository.getSettings).toHaveBeenCalledTimes(1);
    expect(() => appSettingsResponseSchema.parse(result)).not.toThrow();
  });

  it("getActiveContext returns a valid ActiveArchiveContext", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.getActiveContext)!(undefined);
    expect(services.archiveDerivedContextService.getActiveContext).toHaveBeenCalledTimes(1);
    expect(() => activeArchiveContextSchema.parse(result)).not.toThrow();
  });

  it("activateContext returns a valid ArchiveContextActivationResponse", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.activateContext)!(undefined);
    expect(services.archiveDerivedContextService.activateContext).toHaveBeenCalledTimes(1);
    expect(() => archiveContextActivationResponseSchema.parse(result)).not.toThrow();
  });

  it("deactivateContext returns a valid ArchiveContextActivationResponse", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.deactivateContext)!(undefined);
    expect(services.archiveDerivedContextService.deactivateContext).toHaveBeenCalledTimes(1);
    expect(() => archiveContextActivationResponseSchema.parse(result)).not.toThrow();
  });

  it("validateArchive parses its request and returns a valid validate response", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const request = {
      fileName: "tweets.js",
      fileSizeBytes: 1024,
      contents: '{"tweets":[]}',
    };
    const result = await mockPage.handlers.get(B.validateArchive)!(request);
    expect(services.archiveImportService.validate).toHaveBeenCalledTimes(1);
    expect(() => archiveTweetsValidateResponseSchema.parse(result)).not.toThrow();
  });

  it("importArchive parses its request and returns a valid import response", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const request = {
      fileName: "tweets.js",
      fileSizeBytes: 1024,
      contents: '{"tweets":[]}',
      duplicatePolicy: "merge_update" as const,
    };
    const result = await mockPage.handlers.get(B.importArchive)!(request);
    expect(services.archiveImportService.import).toHaveBeenCalledTimes(1);
    expect(() => archiveTweetsImportResponseSchema.parse(result)).not.toThrow();
  });

  it("analyzePosts runs the resolver chain and returns a valid AnalyzePostsResponse", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const request = {
      items: [{ id: "p1", text: "Hello world" }],
      scoringContext: {},
    };
    const result = await mockPage.handlers.get(B.analyzePosts)!(request);
    expect(services.liveContextResolver.mergeAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(services.archiveStudioContextResolver.mergeAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(services.deterministicAnalysisService.analyzePosts).toHaveBeenCalledTimes(1);
    expect(() => analyzePostsResponseSchema.parse(result)).not.toThrow();
  });

  it("generateIdeas returns a valid GenerateIdeaResponse", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.generateIdeas)!({ idea: "ship faster" });
    expect(services.generateIdeasService.generate).toHaveBeenCalledTimes(1);
    expect(() => generateIdeaResponseSchema.parse(result)).not.toThrow();
  });

  it("suggestPost returns a valid SuggestPostResponse", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.suggestPost)!({});
    expect(services.suggestPostService.suggest).toHaveBeenCalledTimes(1);
    expect(() => suggestPostResponseSchema.parse(result)).not.toThrow();
  });

  it("getGenerateCategories returns a valid GenerateCategory array", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.getGenerateCategories)!(undefined);
    expect(services.generateCategoryService.getCategories).toHaveBeenCalledTimes(1);
    expect(() => generateCategorySchema.array().parse(result)).not.toThrow();
  });

  it("applyJudgeSuggestions parses its request and returns a valid response", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.applyJudgeSuggestions)!({ text: "draft" });
    expect(services.applyJudgeSuggestionsService.apply).toHaveBeenCalledTimes(1);
    expect(() => applyJudgeSuggestionsResponseSchema.parse(result)).not.toThrow();
  });

  it("recordFeedbackPrediction parses its request and returns a valid response", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.recordFeedbackPrediction)!({
      action: "generated_draft_written",
      text: "A feedback draft.",
      snapshot: {
        detectedFormat: "insight_share",
        scoreValue: 72,
        prediction: feedbackPredictionRecord.prediction,
        scoringContext: { followers: 1_200 },
        analyzerVersion: "deterministic-v1",
        analyzedAt: NOW_ISO,
      },
    });
    expect(services.feedbackLoopService.recordPrediction).toHaveBeenCalledTimes(1);
    expect(() => recordFeedbackPredictionResponseSchema.parse(result)).not.toThrow();
  });

  it("linkFeedbackPrediction parses its request and returns a valid response", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.linkFeedbackPrediction)!({
      predictionId: "feedback-1",
      platformPostId: "1800000000000000001",
      method: "manual_platform_post_id",
    });
    expect(services.feedbackLoopService.linkPrediction).toHaveBeenCalledTimes(1);
    expect(() => linkFeedbackPredictionResponseSchema.parse(result)).not.toThrow();
  });

  it("getFeedbackLoopSummary accepts an omitted arg and returns a valid response", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const result = await mockPage.handlers.get(B.getFeedbackLoopSummary)!(undefined);
    expect(services.feedbackLoopService.getSummary).toHaveBeenCalledWith({
      windowDays: 90,
      limit: 50,
    });
    expect(() => getFeedbackLoopSummaryResponseSchema.parse(result)).not.toThrow();
  });
});

describe("ExposeFunctionTransport — LLM binding guard", () => {
  it("blocks a second guarded LLM binding before service invocation while one is in flight", async () => {
    const heldJudge = deferred<typeof judgeResponse>();
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      heldJudge.promise,
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const suggestPost = mockPage.handlers.get(B.suggestPost)!;
    const inFlight = Promise.resolve(judgeDraft({ text: "A draft worth judging." }));

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);

    try {
      await expect(suggestPost({})).rejects.toMatchObject(busyGuardErrorFor("suggestPost"));
      expect(services.suggestPostService.suggest).not.toHaveBeenCalled();
    } finally {
      heldJudge.resolve(judgeResponse);
      await inFlight;
    }
  });

  it("guards generateIdeas format requests while another guarded call is in flight", async () => {
    const heldJudge = deferred<typeof judgeResponse>();
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      heldJudge.promise,
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const generateIdeas = mockPage.handlers.get(B.generateIdeas)!;
    const inFlight = Promise.resolve(judgeDraft({ text: "A draft worth judging." }));

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);

    try {
      await expect(generateIdeas({ format: "hot_take" })).rejects.toMatchObject(
        busyGuardErrorFor("generateIdeas"),
      );
      expect(services.generateIdeasService.generate).not.toHaveBeenCalled();
    } finally {
      heldJudge.resolve(judgeResponse);
      await inFlight;
    }
  });

  it("guards applyJudgeSuggestions while another guarded call is in flight", async () => {
    const heldJudge = deferred<typeof judgeResponse>();
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      heldJudge.promise,
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const applyJudgeSuggestions = mockPage.handlers.get(B.applyJudgeSuggestions)!;
    const inFlight = Promise.resolve(judgeDraft({ text: "A draft worth judging." }));

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);

    try {
      await expect(applyJudgeSuggestions({ text: "A draft to improve." })).rejects.toMatchObject(
        busyGuardErrorFor("applyJudgeSuggestions"),
      );
      expect(services.applyJudgeSuggestionsService.apply).not.toHaveBeenCalled();
    } finally {
      heldJudge.resolve(judgeResponse);
      await inFlight;
    }
  });

  it("releases guarded capacity when a guarded service rejects", async () => {
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("judge failed"),
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const suggestPost = mockPage.handlers.get(B.suggestPost)!;

    await expect(judgeDraft({ text: "A draft worth judging." })).rejects.toThrow("judge failed");

    const result = await suggestPost({});
    expect(services.suggestPostService.suggest).toHaveBeenCalledTimes(1);
    expect(result).toEqual(suggestPostResponse);
  });

  it("rejects invalid guarded payloads before spending guarded capacity", async () => {
    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;

    for (let i = 0; i < 6; i += 1) {
      await expect(judgeDraft({ text: "   " })).rejects.toThrow();
    }

    const result = await judgeDraft({ text: "A valid draft after invalid payloads." });
    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);
    expect(result).toEqual(judgeResponse);
  });

  it("lets idea-only generateIdeas bypass the guard while a guarded call is in flight", async () => {
    const heldJudge = deferred<typeof judgeResponse>();
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      heldJudge.promise,
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const generateIdeas = mockPage.handlers.get(B.generateIdeas)!;
    const inFlight = Promise.resolve(judgeDraft({ text: "A draft worth judging." }));

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);

    try {
      const result = await generateIdeas({ idea: "ship faster" });
      expect(services.generateIdeasService.generate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(generateIdeasResponse);
    } finally {
      heldJudge.resolve(judgeResponse);
      await inFlight;
    }
  });

  it("lets getGenerateCategories bypass the guard while a guarded call is in flight", async () => {
    const heldJudge = deferred<typeof judgeResponse>();
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      heldJudge.promise,
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const getGenerateCategories = mockPage.handlers.get(B.getGenerateCategories)!;
    const inFlight = Promise.resolve(judgeDraft({ text: "A draft worth judging." }));

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);

    try {
      const result = await getGenerateCategories(undefined);
      expect(services.generateCategoryService.getCategories).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        expect.objectContaining(generateCategoriesResponse[0]!),
      ]);
    } finally {
      heldJudge.resolve(judgeResponse);
      await inFlight;
    }
  });

  it("lets feedback-loop bindings bypass the guard while a guarded call is in flight", async () => {
    const heldJudge = deferred<typeof judgeResponse>();
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      heldJudge.promise,
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const recordFeedbackPrediction = mockPage.handlers.get(B.recordFeedbackPrediction)!;
    const linkFeedbackPrediction = mockPage.handlers.get(B.linkFeedbackPrediction)!;
    const getFeedbackLoopSummary = mockPage.handlers.get(B.getFeedbackLoopSummary)!;
    const inFlight = Promise.resolve(judgeDraft({ text: "A draft worth judging." }));

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);

    try {
      const recorded = await recordFeedbackPrediction({
        action: "generated_draft_written",
        text: "A feedback draft.",
        snapshot: {
          detectedFormat: "insight_share",
          scoreValue: 72,
          prediction: feedbackPredictionRecord.prediction,
          scoringContext: { followers: 1_200 },
          analyzerVersion: "deterministic-v1",
          analyzedAt: NOW_ISO,
        },
      });
      const linked = await linkFeedbackPrediction({
        predictionId: "feedback-1",
        platformPostId: "1800000000000000001",
        method: "manual_platform_post_id",
      });
      const summary = await getFeedbackLoopSummary({ windowDays: 90, limit: 10 });

      expect(services.feedbackLoopService.recordPrediction).toHaveBeenCalledTimes(1);
      expect(services.feedbackLoopService.linkPrediction).toHaveBeenCalledTimes(1);
      expect(services.feedbackLoopService.getSummary).toHaveBeenCalledTimes(1);
      expect(recorded).toEqual(recordFeedbackPredictionResponse);
      expect(linked).toEqual(linkFeedbackPredictionResponse);
      expect(summary).toEqual(getFeedbackLoopSummaryResponse);
    } finally {
      heldJudge.resolve(judgeResponse);
      await inFlight;
    }
  });

  it("lets representative non-LLM bindings bypass the guard while a guarded call is in flight", async () => {
    const heldJudge = deferred<typeof judgeResponse>();
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      heldJudge.promise,
    );

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;
    const analyzePosts = mockPage.handlers.get(B.analyzePosts)!;
    const getCooldown = mockPage.handlers.get(B.getCooldown)!;
    const getCaptureSummary = mockPage.handlers.get(B.getCaptureSummary)!;
    const getSettings = mockPage.handlers.get(B.getSettings)!;
    const validateArchive = mockPage.handlers.get(B.validateArchive)!;
    const inFlight = Promise.resolve(judgeDraft({ text: "A draft worth judging." }));

    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(1);

    try {
      const analyzed = await analyzePosts({
        items: [{ id: "p1", text: "Hello world" }],
        scoringContext: {},
      });
      const cooldown = await getCooldown({ windowDays: 14 });
      const capture = await getCaptureSummary(undefined);
      const settings = await getSettings(undefined);
      const archiveValidation = await validateArchive({
        fileName: "tweets.js",
        fileSizeBytes: 1024,
        contents: '{"tweets":[]}',
      });

      expect(services.liveContextResolver.mergeAnalysisRequest).toHaveBeenCalledTimes(1);
      expect(services.archiveStudioContextResolver.mergeAnalysisRequest).toHaveBeenCalledTimes(1);
      expect(services.deterministicAnalysisService.analyzePosts).toHaveBeenCalledTimes(1);
      expect(services.repetitionWindowService.compute).toHaveBeenCalledWith(14);
      expect(services.liveCaptureService.summary).toHaveBeenCalledTimes(1);
      expect(services.settingsRepository.getSettings).toHaveBeenCalledTimes(1);
      expect(services.archiveImportService.validate).toHaveBeenCalledTimes(1);
      expect(analyzed).toEqual(analyzePostsResponse);
      expect(cooldown).toEqual(cooldownReport(14));
      expect(capture).toEqual(captureSummaryResponse);
      expect(settings).toEqual(appSettingsResponse);
      expect(archiveValidation).toEqual(validateArchiveResponse);
    } finally {
      heldJudge.resolve(judgeResponse);
      await inFlight;
    }
  });

  it("rejects guarded starts after the default rolling limit with retryAfterMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));

    await ExposeFunctionTransport.bindAll(mockPage.page, services);

    const judgeDraft = mockPage.handlers.get(B.judgeDraft)!;

    for (let i = 0; i < 6; i += 1) {
      await judgeDraft({ text: `A draft worth judging ${i}.` });
    }

    let thrown: unknown;
    try {
      await judgeDraft({ text: "A seventh guarded start in the same window." });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject(rateLimitGuardErrorFor("judgeDraft"));
    const retryAfterMs = (thrown as { retryAfterMs?: unknown }).retryAfterMs;
    expect(retryAfterMs as number).toBeGreaterThan(0);
    expect(services.judgeDraftService.judge).toHaveBeenCalledTimes(6);
  });
});

describe("ExposeFunctionTransport — output contract-bug propagation", () => {
  it("throws when a service returns a shape that fails the response schema", async () => {
    // A contract bug: the service returns something that fails judgeDraftResponseSchema.
    (services.judgeDraftService.judge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "judged",
      // missing verdict/model/judgedAt → output parse must throw.
    });

    await ExposeFunctionTransport.bindAll(mockPage.page, services);
    const handler = mockPage.handlers.get(B.judgeDraft)!;

    await expect(handler({ text: "valid request" })).rejects.toThrow();
  });
});
