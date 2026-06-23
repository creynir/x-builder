import { beforeEach, describe, expect, it } from "vitest";
import type {
  CooldownReport,
  CooldownSignal,
  DetectedPostFormat,
  SuggestedPost,
  SuggestPostRequest,
} from "@x-builder/shared";

import { classifyPostFormat } from "../../deterministic/format-classifier";
import {
  type CanonicalOwnPost,
  type PostLibraryRepository,
  type PostLibraryStore,
} from "../../server/post-library-repository";
import {
  StructuredLlmService,
  type LlmProvider,
  type NormalizedStructuredLlmRequest,
  type StructuredLlmProviderResult,
} from "../../llm/structured-llm-service";

// The service under test does not exist yet — this import is the primary RED
// signal (the module cannot be resolved until Green authors it).
import { SuggestPostService } from "../suggest-post-service";

// ---------------------------------------------------------------------------
// Verified format fixtures. Each block of texts classifies to a single format
// through the real classifier; the in-suite guard below locks this so a future
// classifier change cannot silently invalidate the ranking assertions.
// ---------------------------------------------------------------------------
const HOT_TAKE_TEXTS = [
  "Hot take: shipping fast beats shipping perfect every single time.",
  "Unpopular opinion: most startup advice is survivorship bias dressed as wisdom.",
  "Real talk: your landing page does not need another testimonial section.",
  "Popular opinion: writing tests first actually saves you time later on.",
  "Hot take: meetings that could be emails are quietly killing your team.",
  "Hot take: most dashboards are vanity metrics no one acts on.",
  "Unpopular opinion: cold outreach still beats most content marketing.",
  "Real talk: your roadmap is a wishlist until customers pay for it.",
  "Popular opinion: small focused teams ship better products faster.",
  "Hot take: premature scaling kills more startups than slow growth ever will.",
] as const;

const FOUNDER_STORY_TEXTS = [
  [
    "I almost shut the product down last winter.",
    "We had two customers, no runway, and every investor said no.",
    "Then we shipped the workflow rewrite and signed our first paid customer.",
  ].join("\n"),
  [
    "I launched my startup with zero customers and a maxed out card.",
    "For months revenue stayed flat and I nearly quit the company.",
    "But after the rewrite we closed our first paid deal for $4,000.",
  ].join("\n"),
  [
    "My company burned through its runway faster than I planned.",
    "We lost two big customers and morale on the team cratered.",
    "Then we shipped a new product and finally hit $10k MRR.",
  ].join("\n"),
  [
    "I quit my job to start a company everyone said would fail.",
    "We had no revenue and investors kept passing on us for a year.",
    "After we launched the new product we signed our first paid customer.",
  ].join("\n"),
  [
    "I hired too fast and my startup almost ran out of money.",
    "Customers were churning and our revenue kept falling each month.",
    "But we shipped a fix and closed a deal worth $25,000 finally.",
  ].join("\n"),
] as const;

const AUDIENCE_QUESTION_TEXTS = [
  "Founders, what is the one tool you cannot build without?",
  "Builders, how do you stay focused when the roadmap keeps shifting?",
  "Creators, what hooked your first hundred followers?",
  "Indie hackers, what pricing model finally worked for you?",
  "Makers, how do you decide what to ship next week?",
] as const;

// ---------------------------------------------------------------------------
// Fixture builders for a controlled PostLibraryStore. metricSnapshots is a
// discriminated union on `source`: live snapshots carry `replies`, archive
// snapshots carry `favoriteCount` (the weak reply proxy).
// ---------------------------------------------------------------------------
const baseEntityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

let idCounter = 0;

const liveOriginal = (text: string, replies: number): CanonicalOwnPost => {
  idCounter += 1;
  const platformPostId = `live-${String(idCounter).padStart(6, "0")}`;
  const createdAt = "2026-06-01T00:00:00.000Z";

  return {
    id: `post-${idCounter}`,
    platform: "x",
    platformPostId,
    text,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "x_live_capture",
        capturedAt: createdAt,
        replies,
        likes: 3,
      },
    ],
    sourceRefs: [
      {
        source: "x_live_capture",
        captureSessionId: "session-1",
        rawId: platformPostId,
      },
    ],
    updatedAt: createdAt,
  };
};

const archiveOriginal = (text: string, favoriteCount: number): CanonicalOwnPost => {
  idCounter += 1;
  const platformPostId = `arch-${String(idCounter).padStart(6, "0")}`;
  const createdAt = "2026-06-01T00:00:00.000Z";

  return {
    id: `post-${idCounter}`,
    platform: "x",
    platformPostId,
    text,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: { favoriteCount },
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt: createdAt,
        importedAt: createdAt,
        favoriteCount,
      },
    ],
    sourceRefs: [
      {
        source: "archive_tweets_js",
        importRunId: "import-1",
        rawId: platformPostId,
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
    ],
    updatedAt: createdAt,
  };
};

const storeOf = (posts: CanonicalOwnPost[]): PostLibraryStore => ({
  schemaVersion: 2,
  updatedAt: "2026-06-01T00:00:00.000Z",
  posts,
  importRuns: [],
  derivedInsights: [],
  activeContext: { status: "empty" },
  profileSnapshots: [],
});

// A repository fake exposing only a controlled loadStore(); the other methods
// are present to satisfy the interface but are never exercised here. loadStore
// can be configured to throw a custom error to drive the storage-error edge.
const fakeRepository = (
  store: PostLibraryStore,
  loadStoreError?: unknown,
): PostLibraryRepository => ({
  loadStore: async () => {
    if (loadStoreError) {
      throw loadStoreError;
    }
    return store;
  },
  upsertPosts: async () => ({
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    duplicateCount: 0,
  }),
  saveImportRun: async () => undefined,
  saveDerivedInsights: async () => undefined,
  setActiveContext: async () => undefined,
  pushProfileSnapshot: async () => undefined,
});

// ---------------------------------------------------------------------------
// A controllable RepetitionWindowService stand-in. The service only calls
// compute(windowDays); the structural shape ({ compute }) is enough for DI.
// `signals` drives the cooldown-format exclusion; `throwOnCompute` exercises the
// "compute throws -> empty report" edge.
// ---------------------------------------------------------------------------
type WindowServiceLike = {
  compute: (windowDays?: number) => Promise<CooldownReport>;
};

const cooldownSignal = (
  format: CooldownSignal["format"],
  status: CooldownSignal["status"],
): CooldownSignal => ({
  format,
  countInWindow: status === "cooldown" ? 4 : status === "warming" ? 2 : 1,
  windowDays: 7,
  lastPostedAt: "2026-06-01T00:00:00.000Z",
  status,
  message: `${format} window signal`,
});

const reportOf = (signals: CooldownSignal[]): CooldownReport => ({
  windowDays: 7,
  generatedAt: "2026-06-01T00:00:00.000Z",
  corpusSource: "live",
  signals,
});

const fakeWindowService = (
  signals: CooldownSignal[] = [],
  options: { throwOnCompute?: boolean } = {},
): WindowServiceLike => ({
  compute: async () => {
    if (options.throwOnCompute) {
      throw new Error("window service compute failed");
    }
    return reportOf(signals);
  },
});

// ---------------------------------------------------------------------------
// A structured-LLM fake. The success path echoes `count` suggestions whose ids
// are deterministic; the failure path returns a `failed` result that forces the
// deterministic fallback. The provider id is fixed; resolveProvider returns it.
// ---------------------------------------------------------------------------
const PROVIDER_ID = "codex-cli";

const successLlmProvider = (): LlmProvider<unknown> => ({
  id: PROVIDER_ID,
  generateStructured: <TOutput,>(
    request: NormalizedStructuredLlmRequest<TOutput>,
  ): StructuredLlmProviderResult<unknown> => {
    // Mirror the provider contract: parse a raw suggestions payload through the
    // request's parser so the service maps it into SuggestedPost[].
    const rawSuggestions = [0, 1, 2, 3].map((index) => ({
      id: `llm-suggestion-${index}`,
      text: `An original drafted post number ${index} in the chosen lane.`,
      rationale: "Drafted in the top non-cooldown format.",
    }));

    return {
      status: "success",
      provider: request.provider,
      requestId: "llm-req-1",
      output: request.structuredOutput.parser({ suggestions: rawSuggestions }),
      durationMs: 5,
      completedAt: "2026-06-01T00:00:00.000Z",
    };
  },
});

const failingLlmProvider = (): LlmProvider<unknown> => ({
  id: PROVIDER_ID,
  generateStructured: <TOutput,>(
    request: NormalizedStructuredLlmRequest<TOutput>,
  ): StructuredLlmProviderResult<unknown> => ({
    status: "failed",
    provider: request.provider,
    requestId: "llm-req-failed",
    code: "provider_unavailable",
    message: "The provider is unavailable.",
    retryable: true,
    durationMs: 5,
    completedAt: "2026-06-01T00:00:00.000Z",
  }),
});

// Build the service with the controllable dependencies. The constructor is
// `(repository, windowService, llm, resolveProvider, now?)`; the structural
// fakes satisfy the injected types.
const buildService = (params: {
  store: PostLibraryStore;
  signals?: CooldownSignal[];
  llmProvider: LlmProvider<unknown>;
  loadStoreError?: unknown;
  windowThrows?: boolean;
}): SuggestPostService => {
  const repository = fakeRepository(params.store, params.loadStoreError);
  const windowService = fakeWindowService(params.signals ?? [], {
    throwOnCompute: params.windowThrows,
  });
  // The service constructs a StructuredLlmService internally OR receives one;
  // per the contract it receives a StructuredLlmService instance. We pass a real
  // StructuredLlmService wrapping the configured provider so generateStructured
  // routes the parser/contract exactly as production does.
  const llm = new StructuredLlmService({ providers: [params.llmProvider] });

  return new SuggestPostService(
    repository,
    windowService as never,
    llm,
    () => PROVIDER_ID,
  );
};

const defaultRequest = (
  overrides: Partial<SuggestPostRequest> = {},
): SuggestPostRequest => ({
  windowDays: 7,
  excludeFormats: [],
  count: 3,
  ...overrides,
});

const formatsOf = (suggestions: SuggestedPost[]): DetectedPostFormat[] =>
  suggestions.map((suggestion) => suggestion.format);

beforeEach(() => {
  idCounter = 0;
});

// ---------------------------------------------------------------------------
// Classification guard: lock the fixture -> format mapping the ranking relies
// on. If this fails, the ranking assertions below are meaningless.
// ---------------------------------------------------------------------------
describe("suggest-post fixture classification guard", () => {
  it("classifies each fixture block to its intended single format", () => {
    for (const text of HOT_TAKE_TEXTS) {
      expect(classifyPostFormat(text)).toBe("hot_take");
    }
    for (const text of FOUNDER_STORY_TEXTS) {
      expect(classifyPostFormat(text)).toBe("founder_story");
    }
    for (const text of AUDIENCE_QUESTION_TEXTS) {
      expect(classifyPostFormat(text)).toBe("audience_question");
    }
  });
});

describe("SuggestPostService.suggest", () => {
  it("drafts in the clear top-performing format when the LLM succeeds", async () => {
    // 10 hot_take @ 5 replies (avg 5) beats 5 founder_story @ 2 replies (avg 2).
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 5)),
      ...FOUNDER_STORY_TEXTS.map((text) => liveOriginal(text, 2)),
    ];
    const service = buildService({
      store: storeOf(posts),
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    expect(response.status).toBe("ready");
    expect(response.minimumCorpusSize).toBe(10);
    expect(response.suggestions.length).toBeGreaterThan(0);
    expect(formatsOf(response.suggestions)).toEqual(
      response.suggestions.map(() => "hot_take"),
    );
    for (const suggestion of response.suggestions) {
      expect(suggestion.generatedBy).toBe("llm");
    }
  });

  it("excludes a cooldown format and drafts in the next eligible format", async () => {
    // hot_take is highest by replies but flagged cooldown; founder_story wins.
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 9)),
      ...FOUNDER_STORY_TEXTS.map((text) => liveOriginal(text, 2)),
    ];
    const service = buildService({
      store: storeOf(posts),
      signals: [cooldownSignal("hot_take", "cooldown")],
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    expect(response.status).toBe("ready");
    expect(formatsOf(response.suggestions)).not.toContain("hot_take");
    for (const suggestion of response.suggestions) {
      expect(suggestion.format).toBe("founder_story");
    }
  });

  it("falls back to deterministic resurfacing with verbatim text when the LLM fails", async () => {
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 5)),
      ...FOUNDER_STORY_TEXTS.map((text) => liveOriginal(text, 2)),
    ];
    const corpusTexts = new Set(posts.map((post) => post.text));
    const service = buildService({
      store: storeOf(posts),
      llmProvider: failingLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    expect(response.status).toBe("ready");
    expect(response.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of response.suggestions) {
      expect(suggestion.generatedBy).toBe("deterministic_fallback");
      // Fallback resurfaces an original post text verbatim from the corpus.
      expect(corpusTexts.has(suggestion.text)).toBe(true);
    }
  });

  it("returns insufficient_corpus when fewer than ten originals are present", async () => {
    // 8 originals — below the minimum of 10.
    const posts = HOT_TAKE_TEXTS.slice(0, 8).map((text) => liveOriginal(text, 5));
    const service = buildService({
      store: storeOf(posts),
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    expect(response.status).toBe("insufficient_corpus");
    expect(response.suggestions).toEqual([]);
    expect(response.minimumCorpusSize).toBe(10);
  });

  it("honors request.excludeFormats by skipping the named format", async () => {
    // Corpus spans hot_take (highest), founder_story, audience_question.
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 9)),
      ...FOUNDER_STORY_TEXTS.map((text) => liveOriginal(text, 5)),
      ...AUDIENCE_QUESTION_TEXTS.map((text) => liveOriginal(text, 1)),
    ];
    const service = buildService({
      store: storeOf(posts),
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(
      defaultRequest({ excludeFormats: ["hot_take"] }),
    );

    expect(response.status).toBe("ready");
    expect(formatsOf(response.suggestions)).not.toContain("hot_take");
  });

  it("falls back to deterministic resurfacing when every format is on cooldown", async () => {
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 5)),
      ...FOUNDER_STORY_TEXTS.map((text) => liveOriginal(text, 2)),
    ];
    const service = buildService({
      store: storeOf(posts),
      signals: [
        cooldownSignal("hot_take", "cooldown"),
        cooldownSignal("founder_story", "cooldown"),
      ],
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    expect(response.status).toBe("ready");
    expect(response.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of response.suggestions) {
      expect(suggestion.generatedBy).toBe("deterministic_fallback");
    }
  });

  it("returns exactly one suggestion when count is one", async () => {
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 5)),
      ...FOUNDER_STORY_TEXTS.map((text) => liveOriginal(text, 2)),
    ];
    const service = buildService({
      store: storeOf(posts),
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest({ count: 1 }));

    expect(response.status).toBe("ready");
    expect(response.suggestions).toHaveLength(1);
  });

  it("ranks an archive-only corpus by favoriteCount when no live replies exist", async () => {
    // No live snapshots: hot_take posts carry high favoriteCount, founder_story
    // low. Ranking must still resolve hot_take as the top format.
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => archiveOriginal(text, 40)),
      ...FOUNDER_STORY_TEXTS.map((text) => archiveOriginal(text, 4)),
    ];
    const service = buildService({
      store: storeOf(posts),
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    expect(response.status).toBe("ready");
    expect(response.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of response.suggestions) {
      expect(suggestion.format).toBe("hot_take");
    }
  });

  it("proceeds to ranking at exactly ten originals", async () => {
    // Exactly 10 originals — at the threshold, not below it.
    const posts = HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 5));
    expect(posts).toHaveLength(10);

    const service = buildService({
      store: storeOf(posts),
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    expect(response.status).toBe("ready");
  });

  it("tolerates a throwing window service by using an empty cooldown report", async () => {
    const posts = [
      ...HOT_TAKE_TEXTS.map((text) => liveOriginal(text, 5)),
      ...FOUNDER_STORY_TEXTS.map((text) => liveOriginal(text, 2)),
    ];
    const service = buildService({
      store: storeOf(posts),
      windowThrows: true,
      llmProvider: successLlmProvider(),
    });

    const response = await service.suggest(defaultRequest());

    // The compute() failure is swallowed: an empty report (no signals) is used
    // and the call still succeeds rather than throwing.
    expect(response.status).toBe("ready");
    expect(response.cooldown.signals).toEqual([]);
  });
});
