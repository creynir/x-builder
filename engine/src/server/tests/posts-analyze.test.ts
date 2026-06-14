import { describe, expect, it, vi } from "vitest";
import {
  analyzePostsResponseSchema,
  apiErrorSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
} from "@x-builder/shared";
import { buildServer } from "../server";

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
