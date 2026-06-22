import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyzePostsResponseSchema,
  apiErrorSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
} from "@x-builder/shared";
import { buildServer } from "../server";
import { classifyPostFormat } from "../../deterministic/format-classifier";
import { LiveContextResolver } from "../../capture/live-context-resolver";
import { RepetitionWindowService } from "../../capture/repetition-window-service";
import {
  JsonFilePostLibraryRepository,
  type CanonicalOwnPostInput,
} from "../post-library-repository";

type AnalyzePostsFake = (request: AnalyzePostsRequest) => Promise<AnalyzePostsResponse> | AnalyzePostsResponse;

type BuildServerAnalyzeOptions = Parameters<typeof buildServer>[0] & {
  analyzePosts?: AnalyzePostsFake;
};

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

const parseAnalyzeResponse = (payload: unknown): AnalyzePostsResponse =>
  analyzePostsResponseSchema.parse(payload);

const parseApiError = (payload: unknown) => apiErrorSchema.parse(payload);

const expectScoredItem = (
  item: AnalyzedPostItem | undefined,
): Extract<AnalyzedPostItem, { status: "scored" }> => {
  expect(item).toMatchObject({
    status: "scored",
  });

  if (!item || item.status !== "scored") {
    throw new Error("Expected scored deterministic analysis item.");
  }

  return item;
};

const buildServerWithAnalyzePosts = (
  analyzePosts: AnalyzePostsFake,
  generateCandidates = vi.fn(),
) =>
  buildServer({
    analyzePosts,
    generateCandidates,
  } as BuildServerAnalyzeOptions);

const analyzeRequest = (
  overrides: Partial<AnalyzePostsRequest> = {},
): AnalyzePostsRequest => ({
  items: [
    {
      id: "candidate-1",
      text: "genuine question: why do agent handoffs fail when context is hidden from the next step?",
      sourceFormat: "debate-question",
    },
  ],
  scoringContext: {},
  presentation: {
    postCoachMode: "preview",
  },
  ...overrides,
});

const scoredResponse = (request: AnalyzePostsRequest): AnalyzePostsResponse => ({
  items: request.items.map((item, index) => ({
    status: "scored",
    id: item.id,
    text: item.text,
    sourceFormat: item.sourceFormat,
    detectedFormat: "genuine_question",
    score: {
      value: 74 - index,
      checks: [
        {
          id: "specificity",
          label: "Specific proof",
          status: "pass",
        },
      ],
      learnings: [
        {
          text: "Static rule evidence: specific details make posts easier to evaluate.",
          relevance: "general",
        },
      ],
      engageability: {
        engageable: true,
        reason: "Ends with a concrete question.",
      },
    },
    postCoach: {
      state: "ready",
      title: "Post Coach",
      value: 74 - index,
      badge: {
        label: "Ship it",
        tone: "ship",
        tooltip: "Solid post. Ship it; higher scores are a bonus.",
      },
      target: 60,
      engageability: {
        engageable: true,
        reason: "Ends with a concrete question.",
      },
      failed: [],
      warned: [],
      passed: [
        {
          id: "specificity",
          label: "Specific proof",
          status: "pass",
        },
      ],
      counts: {
        flagged: 0,
        nudges: 0,
        onPoint: 1,
      },
      expanded: false,
      previewMode: true,
      sections: [
        {
          title: "On point",
          items: [
            {
              id: "specificity",
              label: "Specific proof",
              status: "pass",
            },
          ],
        },
      ],
      learnings: [],
      learningCaveat: "Static rule check. Imported performance data is not connected yet.",
      hiddenChecks: 0,
      helperText: "Signals, not verdicts.",
      footerText: "Static heuristic checks only.",
    },
    prediction: request.scoringContext.followers
      ? {
          status: "available",
          signals: [
            {
              signal_key: "quality_voice",
              label: "Static score 74",
              multiplier: 0.8,
            },
          ],
          // Four-regime reach fields (the only available-prediction shape now
          // that the RMU-006 legacy mirror is deleted).
          predictedMidImpressions: 230,
          stallRange: { low: 120, high: 276 },
          escapeRange: { low: 570, high: 2280 },
          escapeProbability: 0.1,
          expectedReplies: 3,
          baseImpressions: 190,
          baseSource: "follower_estimate",
          qualityBasis: "static",
          reachModelVersion: "reach-v1",
        }
      : {
          status: "disabled",
          reason: "missing_followers",
          message: "Prediction needs follower count.",
        },
    heuristicLabel: "Heuristic rank, not prediction.",
    analyzedAt: "2026-06-07T12:00:00.000Z",
    analyzerVersion: "deterministic-v1",
  })),
});

describe("posts analyze API", () => {
  it("returns scored results for a valid analysis request without calling idea generation", async () => {
    const generateCandidates = vi.fn();
    const request = analyzeRequest({
      items: [
        {
          id: "candidate-1",
          text: "genuine question: why do launches lose momentum after the first customer proof?",
          sourceFormat: "debate-question",
        },
        {
          id: "candidate-2",
          text: "hot take: a narrow launch with proof beats a broad launch with positioning",
          sourceFormat: "one-liner",
        },
      ],
      scoringContext: {
        followers: 2400,
      },
    });
    const app = buildServer({ generateCandidates });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: request,
      });

      expect(response.statusCode).toBe(200);
      expect(generateCandidates).not.toHaveBeenCalled();

      const result = parseAnalyzeResponse(parseJsonPayload(response.body));

      expect(result.items).toHaveLength(2);
      expect(result.items).toEqual([
        expect.objectContaining({
          status: "scored",
          id: "candidate-1",
          text: request.items[0]?.text,
          sourceFormat: "debate-question",
          postCoach: expect.objectContaining({
            state: "ready",
            title: "Post Coach",
          }),
        }),
        expect.objectContaining({
          status: "scored",
          id: "candidate-2",
          text: request.items[1]?.text,
          sourceFormat: "one-liner",
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it("returns Post Coach with a disabled missing-followers prediction when followers are omitted", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: analyzeRequest({
          scoringContext: {},
          presentation: {
            postCoachMode: "expanded",
          },
        }),
      });

      expect(response.statusCode).toBe(200);

      const result = parseAnalyzeResponse(parseJsonPayload(response.body));
      const item = expectScoredItem(result.items[0]);

      expect(item).toMatchObject({
        status: "scored",
        postCoach: {
          state: "ready",
          title: "Post Coach",
          expanded: true,
          previewMode: false,
        },
        prediction: {
          status: "disabled",
          reason: "missing_followers",
        },
      });
      expect(item.prediction).not.toHaveProperty("rangeLow");
      expect(item.prediction).not.toHaveProperty("rangeHigh");
      expect(item.prediction).not.toHaveProperty("midpoint");
    } finally {
      await app.close();
    }
  });

  it("returns an available prediction when request-scoped followers are provided", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: analyzeRequest({
          scoringContext: {
            followers: 3600,
          },
        }),
      });

      expect(response.statusCode).toBe(200);

      const result = parseAnalyzeResponse(parseJsonPayload(response.body));
      const item = expectScoredItem(result.items[0]);

      expect(item).toMatchObject({
        status: "scored",
        prediction: {
          status: "available",
          signals: expect.any(Array),
          qualityBasis: "static",
          baseSource: "follower_estimate",
        },
      });

      if (item.prediction.status !== "available") {
        throw new Error("Expected available engagement prediction.");
      }

      const prediction = item.prediction;

      // Two-regime reach output surfaced through the HTTP boundary.
      expect(prediction.baseImpressions).toBeGreaterThanOrEqual(1);
      expect(prediction.predictedMidImpressions).toBeGreaterThanOrEqual(1);
      expect(prediction.stallRange.low).toBeLessThanOrEqual(prediction.stallRange.high);
      expect(prediction.escapeRange).toEqual({
        low: Math.round(3 * prediction.baseImpressions),
        high: Math.round(12 * prediction.baseImpressions),
      });
      expect(prediction.escapeProbability).toBeGreaterThanOrEqual(0);
      expect(prediction.escapeProbability).toBeLessThanOrEqual(1);
      expect(typeof prediction.reachModelVersion).toBe("string");
      expect(prediction.reachModelVersion.length).toBeGreaterThan(0);

      // The deleted legacy mirror fields must not survive over the HTTP boundary.
      expect(prediction).not.toHaveProperty("rangeLow");
      expect(prediction).not.toHaveProperty("rangeHigh");
      expect(prediction).not.toHaveProperty("midpoint");
      expect(prediction).not.toHaveProperty("confidence");
    } finally {
      await app.close();
    }
  });

  it("detects founder_story through the real analyze route without amplifier-shaped response fields", async () => {
    const app = buildServer();
    const founderStoryDraft = [
      "I almost shut the product down last winter.",
      "We had two customers, no runway, and every investor said no.",
      "Then we shipped the workflow rewrite and signed our first paid customer.",
    ].join("\n");

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: analyzeRequest({
          items: [
            {
              id: "founder-story",
              text: founderStoryDraft,
            },
          ],
          scoringContext: {
            followers: 3600,
            judgeSignals: { impressions: 65, replies: 80 },
          },
        }),
      });

      expect(response.statusCode).toBe(200);

      const rawBody = parseJsonPayload(response.body);
      const result = parseAnalyzeResponse(rawBody);
      const item = expectScoredItem(result.items[0]);

      expect(item.detectedFormat).toBe("founder_story");
      expect(item.prediction.status).toBe("available");

      if (item.prediction.status !== "available") {
        throw new Error("Expected available founder-story prediction.");
      }

      expect(item.prediction.qualityBasis).toBe("judge");
      expect(item.prediction.signals.some((signal) => signal.signal_key.startsWith("founder_story_"))).toBe(false);

      const wire = JSON.stringify(rawBody);
      expect(wire).not.toContain("amplifierType");
      expect(wire).not.toContain("eventContext");
      expect(wire).not.toContain("founder_story_event");
      expect(wire).not.toContain("founder_story_personal_stakes");
      expect(wire).not.toContain("founder_story_reuse_decay");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid analysis requests with the existing validation error shape", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: {
          items: [],
          scoringContext: {
            followers: -1,
          },
          presentation: {
            postCoachMode: "preview",
          },
        },
      });

      const error = parseApiError(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(400);
      expect(error).toMatchObject({
        code: "validation_failed",
        scope: "field",
        retryable: false,
        status: 400,
      });
      expect(error.fieldErrors?.items).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(error.fieldErrors?.scoringContext).toEqual(expect.arrayContaining([expect.any(String)]));
    } finally {
      await app.close();
    }
  });

  it("keeps per-item score failures in a 200 response without dropping item text", async () => {
    const analyzePosts = vi.fn(async (request: AnalyzePostsRequest): Promise<AnalyzePostsResponse> => ({
      items: [
        scoredResponse(request).items[0]!,
        {
          status: "score_failed",
          id: request.items[1]!.id,
          text: request.items[1]!.text,
          sourceFormat: request.items[1]!.sourceFormat,
          reason: "analysis_failed",
          message: "This candidate could not be scored. Try again.",
          retryable: true,
        },
      ],
    }));
    const request = analyzeRequest({
      items: [
        {
          id: "candidate-1",
          text: "genuine question: which onboarding clue tells you the product is finally landing?",
          sourceFormat: "debate-question",
        },
        {
          id: "candidate-2",
          text: "hot take: vague launch stories hide the only feedback that matters",
          sourceFormat: "one-liner",
        },
      ],
      scoringContext: {
        followers: 1800,
      },
    });
    const app = buildServerWithAnalyzePosts(analyzePosts);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: request,
      });

      expect(response.statusCode).toBe(200);
      expect(analyzePosts).toHaveBeenCalledWith(request);

      const result = parseAnalyzeResponse(parseJsonPayload(response.body));

      expect(result.items).toHaveLength(2);
      expect(result.items[1]).toEqual({
        status: "score_failed",
        id: "candidate-2",
        text: request.items[1]?.text,
        sourceFormat: "one-liner",
        reason: "analysis_failed",
        message: "This candidate could not be scored. Try again.",
        retryable: true,
      });
    } finally {
      await app.close();
    }
  });

  it("normalizes full analysis failures as deterministic route-level API errors", async () => {
    const analyzePosts = vi.fn(async () => {
      throw new Error("Sensitive deterministic scorer internals");
    });
    const generateCandidates = vi.fn();
    const app = buildServerWithAnalyzePosts(analyzePosts, generateCandidates);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: analyzeRequest(),
      });

      expect(response.statusCode).toBe(500);
      expect(analyzePosts).toHaveBeenCalledOnce();
      expect(generateCandidates).not.toHaveBeenCalled();
      expect(response.body).not.toContain("Sensitive deterministic scorer internals");
      expect(response.body).not.toContain("stack");

      const error = parseApiError(parseJsonPayload(response.body));

      expect(error).toMatchObject({
        code: "deterministic_analysis_failed",
        scope: "deterministic",
        retryable: true,
        status: 500,
      });
    } finally {
      await app.close();
    }
  });

  it("reports a response-contract violation as a non-retryable internal error", async () => {
    // The operation succeeds but returns output that violates the response
    // schema (a server bug) — this must not be reported as a retryable domain
    // failure.
    const analyzePosts = vi.fn(
      async () => ({ items: [{ status: "scored" }] }) as unknown as AnalyzePostsResponse,
    );
    const app = buildServerWithAnalyzePosts(analyzePosts, vi.fn());

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: analyzeRequest(),
      });

      expect(response.statusCode).toBe(500);

      const error = parseApiError(parseJsonPayload(response.body));

      expect(error).toMatchObject({
        code: "internal_error",
        retryable: false,
        status: 500,
      });
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Live auto-context + per-item cooldown (route integration). These tests seed a
// real JsonFilePostLibraryRepository over a tmpdir, inject a LiveContextResolver
// + a shared RepetitionWindowService, and exercise the real deterministic
// scorer through the HTTP boundary.
//
// Corpus createdAt values are anchored to the REAL clock (Date.now() minus N
// days) because the route's per-item cooldown step computes its window against
// the default RepetitionWindowService (real clock). Keeping posts 0.5..3 days
// old keeps them in any reasonable 7-day window.
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const nowMinusDays = (days: number): string =>
  new Date(Date.now() - Math.round(days * DAY_MS)).toISOString();

// Verified hot_take fixtures (see the in-suite classification guard below).
const HOT_TAKE_CORPUS = [
  "Hot take: shipping fast beats shipping perfect every single time.",
  "Unpopular opinion: most startup advice is survivorship bias dressed up as wisdom.",
  "Real talk: your landing page does not need another testimonial section.",
  "Popular opinion: writing tests first actually saves you time later on.",
] as const;

const HOT_TAKE_REQUEST_TEXT =
  "Hot take: meetings that could be emails are quietly killing your team.";

const baseEntityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

let seedIdCounter = 0;

const liveOriginal = (
  text: string,
  impressions: number | undefined,
  createdAt: string,
): CanonicalOwnPostInput => {
  seedIdCounter += 1;
  const platformPostId = `190000000000000${String(seedIdCounter).padStart(4, "0")}`;

  return {
    id: `live-${seedIdCounter}`,
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
        ...(impressions === undefined ? {} : { impressions }),
        likes: 6,
      },
    ],
    sourceRefs: [
      {
        source: "x_live_capture",
        captureSessionId: "session-1",
        rawId: platformPostId,
      },
    ],
  };
};

describe("posts analyze API — live auto-context fixture guard", () => {
  it("classifies the cooldown corpus and request item as hot_take", () => {
    for (const text of HOT_TAKE_CORPUS) {
      expect(classifyPostFormat(text)).toBe("hot_take");
    }
    expect(classifyPostFormat(HOT_TAKE_REQUEST_TEXT)).toBe("hot_take");
  });
});

describe("posts analyze API — live auto-context and per-item cooldown", () => {
  let root: string;
  let repository: JsonFilePostLibraryRepository;

  const buildLiveServer = () => {
    const windowService = new RepetitionWindowService(repository);
    const liveContextResolver = new LiveContextResolver(repository, windowService);

    // `liveContextResolver` is the option Green adds to BuildServerOptions
    // (XOB-007). Until then this is an expected typecheck RED (TS2353).
    return buildServer({
      postLibraryRepository: repository,
      liveContextResolver,
    });
  };

  const liveAnalyzeBody = (
    overrides: Partial<AnalyzePostsRequest> = {},
  ): AnalyzePostsRequest => ({
    items: [
      {
        id: "candidate-1",
        text: "genuine question: which onboarding clue tells you the product is landing?",
        sourceFormat: "debate-question",
      },
    ],
    scoringContext: {},
    presentation: { postCoachMode: "preview" },
    ...overrides,
  });

  beforeEach(async () => {
    seedIdCounter = 0;
    root = await mkdtemp(join(tmpdir(), "x-builder-posts-analyze-live-"));
    repository = new JsonFilePostLibraryRepository({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("injects trailingMedianImpressions so the prediction base is trailing_median when followers are omitted", async () => {
    await repository.pushProfileSnapshot({
      platformUserId: "u-1",
      screenName: "founder",
      followers: 12000,
      capturedAt: nowMinusDays(1),
    });
    // Ten original live posts with varying impressions; median is well-defined.
    const impressions = [120, 240, 360, 90, 480, 200, 310, 150, 420, 270];
    await repository.upsertPosts(
      impressions.map((value, index) =>
        liveOriginal(`Live post number ${index} with an impressions snapshot here.`, value, nowMinusDays(index + 1)),
      ),
    );

    const app = buildLiveServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        // No followers in the body: the resolver must supply context.
        payload: liveAnalyzeBody(),
      });

      expect(response.statusCode).toBe(200);

      const result = analyzePostsResponseSchema.parse(JSON.parse(response.body));

      for (const item of result.items) {
        expect(item.status).toBe("scored");
        if (item.status !== "scored") {
          throw new Error("Expected scored item.");
        }
        expect(item.prediction.status).toBe("available");
        if (item.prediction.status !== "available") {
          throw new Error("Expected available prediction.");
        }
        // A trailing median was injected, so the reach base is the median, not a
        // follower estimate.
        expect(item.prediction.baseSource).toBe("trailing_median");
        // The only request item is a genuine_question, and the seeded corpus has
        // no in-window genuine_question activity (the filler posts classify as
        // wisdom_one_liner). With no signal for the item's format, cooldown is
        // absent — the designed state (cooldownSignalSchema is optional, and the
        // window service never emits a count-0 signal). A real present-signal case
        // is covered by the dedicated hot_take cooldown test below.
        expect(item).not.toHaveProperty("cooldown");
      }
    } finally {
      await app.close();
    }
  });

  it("does not overwrite caller-supplied followers in scoringContext", async () => {
    // A captured profile snapshot is present, but the body already sets
    // followers AND there are no live impressions, so the resolver must not
    // inject a trailing median either: the base stays follower_estimate at 5000.
    await repository.pushProfileSnapshot({
      platformUserId: "u-1",
      screenName: "founder",
      followers: 12000,
      capturedAt: nowMinusDays(1),
    });

    const app = buildLiveServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: liveAnalyzeBody({ scoringContext: { followers: 5000 } }),
      });

      expect(response.statusCode).toBe(200);

      const result = analyzePostsResponseSchema.parse(JSON.parse(response.body));
      const item = result.items[0];
      expect(item?.status).toBe("scored");
      if (!item || item.status !== "scored") {
        throw new Error("Expected scored item.");
      }
      expect(item.prediction.status).toBe("available");
      if (item.prediction.status !== "available") {
        throw new Error("Expected available prediction.");
      }
      // No trailing median seeded -> the caller-supplied followers (5000) anchor
      // the base, proving the resolver left followers as supplied.
      expect(item.prediction.baseSource).toBe("follower_estimate");
    } finally {
      await app.close();
    }
  });

  it("runs LiveContextResolver before the analysis step so the analyzed request already carries live-patched followers", async () => {
    // Observable-ordering assertion: the route constructs ArchiveStudioContextResolver
    // internally (no injection seam in BuildServerOptions). We instead capture the
    // request that reaches the analysis step via an injected analyzePosts spy. The
    // captured request has flowed through Live -> Archive -> analyze, so a body with
    // no followers reaching the scorer WITH followers patched proves the live
    // resolver ran first in the chain.
    await repository.pushProfileSnapshot({
      platformUserId: "u-1",
      screenName: "founder",
      followers: 12000,
      capturedAt: nowMinusDays(1),
    });

    const seenRequests: AnalyzePostsRequest[] = [];
    const windowService = new RepetitionWindowService(repository);
    const liveContextResolver = new LiveContextResolver(repository, windowService);
    const analyzeSpy = vi.fn(
      (request: AnalyzePostsRequest): AnalyzePostsResponse => {
        seenRequests.push(request);
        return {
          items: request.items.map((item) => ({
            status: "score_failed" as const,
            id: item.id,
            text: item.text,
            sourceFormat: item.sourceFormat,
            reason: "analysis_failed" as const,
            message: "Spy short-circuit; ordering only.",
            retryable: true,
          })),
        };
      },
    );

    const app = buildServer({
      postLibraryRepository: repository,
      liveContextResolver,
      analyzePosts: analyzeSpy,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: liveAnalyzeBody(),
      });

      expect(response.statusCode).toBe(200);
      expect(analyzeSpy).toHaveBeenCalledOnce();
      expect(seenRequests).toHaveLength(1);
      // followers was absent in the body; the live resolver patched it to 12000
      // before the analysis step received the request.
      expect(seenRequests[0]?.scoringContext.followers).toBe(12000);
    } finally {
      await app.close();
    }
  });

  it("attaches cooldown.status cooldown with countInWindow 4 to a hot_take item over a hot_take corpus", async () => {
    // Four in-window hot_take originals -> the hot_take format is in cooldown.
    await repository.upsertPosts(
      HOT_TAKE_CORPUS.map((text, index) => liveOriginal(text, 300, nowMinusDays(index + 0.5))),
    );

    const app = buildLiveServer();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: liveAnalyzeBody({
          items: [
            {
              id: "hot-take-1",
              text: HOT_TAKE_REQUEST_TEXT,
              sourceFormat: "one-liner",
            },
          ],
          // Supply followers so the prediction is available; cooldown is the focus.
          scoringContext: { followers: 4000 },
        }),
      });

      expect(response.statusCode).toBe(200);

      const result = analyzePostsResponseSchema.parse(JSON.parse(response.body));
      const item = result.items[0];
      expect(item?.status).toBe("scored");
      if (!item || item.status !== "scored") {
        throw new Error("Expected scored item.");
      }
      expect(item.detectedFormat).toBe("hot_take");
      expect(item.cooldown).toBeDefined();
      expect(item.cooldown?.status).toBe("cooldown");
      expect(item.cooldown?.countInWindow).toBe(4);
      expect(item.cooldown?.format).toBe("hot_take");
    } finally {
      await app.close();
    }
  });

  it("attaches no cooldown field to a score_failed item while keeping the response valid", async () => {
    await repository.upsertPosts(
      HOT_TAKE_CORPUS.map((text, index) => liveOriginal(text, 300, nowMinusDays(index + 0.5))),
    );

    // A per-item score_failed shape from an injected spy; the route must not add
    // a cooldown field to it.
    const windowService = new RepetitionWindowService(repository);
    const liveContextResolver = new LiveContextResolver(repository, windowService);
    const analyzeSpy = vi.fn(
      (request: AnalyzePostsRequest): AnalyzePostsResponse => ({
        items: [
          {
            status: "score_failed" as const,
            id: request.items[0]!.id,
            text: request.items[0]!.text,
            sourceFormat: request.items[0]!.sourceFormat,
            reason: "analysis_failed" as const,
            message: "This candidate could not be scored. Try again.",
            retryable: true,
          },
        ],
      }),
    );

    const app = buildServer({
      postLibraryRepository: repository,
      liveContextResolver,
      analyzePosts: analyzeSpy,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/analyze",
        payload: liveAnalyzeBody({
          items: [
            {
              id: "hot-take-1",
              text: HOT_TAKE_REQUEST_TEXT,
              sourceFormat: "one-liner",
            },
          ],
          scoringContext: { followers: 4000 },
        }),
      });

      expect(response.statusCode).toBe(200);

      const result = analyzePostsResponseSchema.parse(JSON.parse(response.body));
      const item = result.items[0];
      expect(item?.status).toBe("score_failed");
      expect(item).not.toHaveProperty("cooldown");
    } finally {
      await app.close();
    }
  });
});
