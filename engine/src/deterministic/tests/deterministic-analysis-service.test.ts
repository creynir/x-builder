import { describe, expect, it } from "vitest";

import {
  analyzePostsResponseSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
  type PostCoachViewModel,
} from "@x-builder/shared";
import { DeterministicAnalysisService } from "../deterministic-analysis-service";
import { analyzerVersion } from "../deterministic-analysis-constants";
import { analyzeDraftText as analyzePost } from "../analyzer";
import type { AnalyzeResult } from "../types";

const learningCaveat = "Static rule check. Imported performance data is not connected yet.";

const strongQuestion =
  "genuine question: why do agent handoffs fail when the context is hidden from the next step?";

type ScoredPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;

function createService(): DeterministicAnalysisService {
  return new DeterministicAnalysisService();
}

async function analyzeOne(
  request: AnalyzePostsRequest,
): Promise<ScoredPostItem> {
  const response = analyzePostsResponseSchema.parse(await createService().analyzePosts(request));

  expect(response).toMatchObject({
    items: expect.any(Array),
  });
  expect(response.items).toHaveLength(1);

  const item = response.items[0]!;
  expect(item.status).toBe("scored");

  if (item.status !== "scored") {
    throw new Error("Expected scored analysis item.");
  }

  return item;
}

function readyPostCoach(postCoach: PostCoachViewModel): Extract<PostCoachViewModel, { state: "ready" }> {
  expect(postCoach.state).toBe("ready");

  if (postCoach.state !== "ready") {
    throw new Error("Expected ready Post Coach view model.");
  }

  return postCoach;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectStrings(item));
  }

  return [];
}

function expectSharedScoredShape(item: ScoredPostItem): void {
  expect(item).toMatchObject({
    status: "scored",
    id: expect.any(String),
    text: expect.any(String),
    detectedFormat: expect.any(String),
    score: {
      value: expect.any(Number),
      checks: expect.any(Array),
      learnings: expect.any(Array),
      engageability: {
        engageable: expect.any(Boolean),
        reason: expect.any(String),
      },
    },
    postCoach: {
      state: "ready",
      title: "Post Coach",
      learningCaveat,
    },
    prediction: {
      status: expect.stringMatching(/^(available|disabled)$/),
    },
    heuristicLabel: "Heuristic rank, not prediction.",
    analyzedAt: expect.any(String),
    analyzerVersion,
  });
  expect(Number.isNaN(Date.parse(item.analyzedAt))).toBe(false);
  expect(item.score.value).toBeGreaterThanOrEqual(0);
  expect(item.score.value).toBeLessThanOrEqual(100);
}

describe("deterministic analysis service", () => {
  it("returns a shared-schema scored result with disabled prediction when followers are missing", async () => {
    const item = await analyzeOne({
      items: [
        {
          id: "candidate-1",
          text: strongQuestion,
          sourceFormat: "debate-question",
        },
      ],
      scoringContext: {},
      presentation: {
        postCoachMode: "preview",
      },
    });

    expectSharedScoredShape(item);
    expect(item).toMatchObject({
      status: "scored",
      id: "candidate-1",
      text: strongQuestion,
      sourceFormat: "debate-question",
      detectedFormat: "genuine_question",
      heuristicLabel: "Heuristic rank, not prediction.",
    });
    expect(item.score.value).toBeGreaterThan(0);
    expect(item.score.checks.length).toBeGreaterThan(0);
    expect(readyPostCoach(item.postCoach)).toMatchObject({
      previewMode: true,
      expanded: false,
      learningCaveat,
    });
    expect(item.prediction).toEqual({
      status: "disabled",
      reason: "missing_followers",
      message: expect.any(String),
    });
  });

  it("returns a shared-schema scored result with available prediction when manual followers are provided", async () => {
    const item = await analyzeOne({
      items: [
        {
          id: "candidate-1",
          text: "hot take: specific launch proof beats generic positioning every week",
          sourceFormat: "one-liner",
        },
      ],
      scoringContext: {
        followers: 2400,
      },
      presentation: {
        postCoachMode: "preview",
      },
    });

    expectSharedScoredShape(item);
    expect(item.status).toBe("scored");

    expect(item.prediction).toMatchObject({
      status: "available",
      signals: expect.any(Array),
      qualityBasis: "static",
      baseSource: "follower_estimate",
    });

    if (item.prediction.status !== "available") {
      throw new Error("Expected available engagement prediction.");
    }

    const prediction = item.prediction;

    // Four-regime reach output, derived from the produced base.
    expect(prediction.baseImpressions).toBeGreaterThanOrEqual(1);
    expect(prediction.predictedMidImpressions).toBeGreaterThanOrEqual(1);
    expect(prediction.stallRange.low).toBeLessThanOrEqual(prediction.stallRange.high);
    expect(prediction.escapeRange.low).toBeLessThanOrEqual(prediction.escapeRange.high);
    expect(prediction.escapeRange).toEqual({
      low: Math.round(3 * prediction.baseImpressions),
      high: Math.round(12 * prediction.baseImpressions),
    });
    expect(prediction.escapeProbability).toBeGreaterThanOrEqual(0);
    expect(prediction.escapeProbability).toBeLessThanOrEqual(1);
    expect(prediction.expectedReplies).toBeGreaterThanOrEqual(0);
    expect(typeof prediction.reachModelVersion).toBe("string");
    expect(prediction.reachModelVersion.length).toBeGreaterThan(0);
    expect(prediction.signals.length).toBeGreaterThanOrEqual(0);

    // The deleted legacy mirror fields must not survive on the produced output.
    expect(prediction).not.toHaveProperty("rangeLow");
    expect(prediction).not.toHaveProperty("rangeHigh");
    expect(prediction).not.toHaveProperty("midpoint");
    expect(prediction).not.toHaveProperty("confidence");
  });

  it("surfaces an available prediction from a trailing median when followers are absent", async () => {
    const item = await analyzeOne({
      items: [
        {
          id: "candidate-1",
          text: "hot take: specific launch proof beats generic positioning every week",
        },
      ],
      scoringContext: {
        trailingMedianImpressions: 2000,
      },
      presentation: {
        postCoachMode: "preview",
      },
    });

    expectSharedScoredShape(item);

    if (item.prediction.status !== "available") {
      throw new Error("Expected a trailing-median request to be available, not disabled.");
    }

    expect(item.prediction.baseSource).toBe("trailing_median");
    expect(item.prediction.baseImpressions).toBe(2000);
    expect(item.prediction.qualityBasis).toBe("static");
    expect(item.prediction.escapeRange).toEqual({ low: 6000, high: 24000 });
  });

  it("does not expose the analyzer implicit follower fallback as a prediction", async () => {
    const item = await analyzeOne({
      items: [
        {
          id: "candidate-1",
          text: "hot take: founders learn faster from one shipped feature than ten strategy docs",
        },
      ],
      scoringContext: {},
      presentation: {
        postCoachMode: "expanded",
      },
    });

    expectSharedScoredShape(item);
    expect(item.status).toBe("scored");

    expect(item.prediction.status).toBe("disabled");
    expect(item.prediction).not.toHaveProperty("rangeLow");
    expect(item.prediction).not.toHaveProperty("rangeHigh");
    expect(item.prediction).not.toHaveProperty("midpoint");
    expect(item.prediction).not.toHaveProperty("signals");
  });

  it("sanitizes imported personal performance claims from Post Coach output", async () => {
    const item = await analyzeOne({
      items: [
        {
          id: "candidate-1",
          text: [
            "genuine question: why do onboarding changes stop compounding after launch week?",
            "",
            "we shipped 42 experiments last week",
            "",
            "proof creates trust",
          ].join("\n"),
        },
      ],
      scoringContext: {
        followers: 1800,
      },
      presentation: {
        postCoachMode: "expanded",
      },
    });

    expectSharedScoredShape(item);
    expect(item.status).toBe("scored");

    const postCoach = readyPostCoach(item.postCoach);
    const postCoachText = collectStrings(postCoach).join("\n").toLowerCase();

    expect(postCoach.learningCaveat).toBe(learningCaveat);
    expect(postCoach.learnings.length).toBeGreaterThan(0);
    expect(postCoach.learnings.every((learning) => learning.text.includes("Static rule"))).toBe(true);
    expect(postCoachText).not.toMatch(/your data|last 30 days|averaged|replies for you|outperform/);
    expect(postCoachText).not.toMatch(/imported metrics|personal performance data exists/);
    expect(postCoachText).not.toMatch(/ai rate post|above the composer/);
  });

  it("sets preview and expanded Post Coach view-model flags for the requested presentation mode", async () => {
    const previewItem = await analyzeOne({
      items: [
        {
          id: "candidate-preview",
          text: strongQuestion,
        },
      ],
      scoringContext: {
        followers: 1200,
      },
      presentation: {
        postCoachMode: "preview",
      },
    });
    const expandedItem = await analyzeOne({
      items: [
        {
          id: "candidate-expanded",
          text: strongQuestion,
        },
      ],
      scoringContext: {
        followers: 1200,
      },
      presentation: {
        postCoachMode: "expanded",
      },
    });

    expect(previewItem.status).toBe("scored");
    expect(expandedItem.status).toBe("scored");
    expectSharedScoredShape(previewItem);
    expectSharedScoredShape(expandedItem);

    const previewPostCoach = readyPostCoach(previewItem.postCoach);
    const expandedPostCoach = readyPostCoach(expandedItem.postCoach);

    expect(previewPostCoach).toMatchObject({
      previewMode: true,
      expanded: false,
      learnings: [],
    });
    expect(previewPostCoach.sections.map((section) => section.title)).toEqual(["Sample"]);
    expect(expandedPostCoach.previewMode).toBe(false);
    expect(expandedPostCoach.expanded).toBe(true);
    expect(expandedPostCoach.sections.map((section) => section.title)).not.toEqual(["Sample"]);
    expect(expandedPostCoach.learnings.length).toBeGreaterThan(0);
  });

  it("returns item-level score_failed when the analyzer itself throws", () => {
    const service = new DeterministicAnalysisService({
      analyzePost: () => {
        throw new Error("Analyzer failed.");
      },
    });
    const response = service.analyzePosts({
      items: [
        {
          id: "candidate-1",
          text: strongQuestion,
        },
      ],
      scoringContext: {},
      presentation: {
        postCoachMode: "preview",
      },
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      status: "score_failed",
      id: "candidate-1",
      text: strongQuestion,
      retryable: true,
    });
  });

  it("does not downgrade response mapping failures to item-level score_failed", () => {
    const service = new DeterministicAnalysisService({
      analyzePost: (text, options) => ({
        ...analyzePost(text, options),
        format: "unsupported_format",
      }) as unknown as AnalyzeResult,
    });

    expect(() =>
      service.analyzePosts({
        items: [
          {
            id: "candidate-1",
            text: strongQuestion,
          },
        ],
        scoringContext: {},
        presentation: {
          postCoachMode: "preview",
        },
      }),
    ).toThrow();
  });
});
