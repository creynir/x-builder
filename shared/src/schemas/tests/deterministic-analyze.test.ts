import { describe, expect, expectTypeOf, it } from "vitest";
import {
  analyzedPostItemSchema,
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  detectedPostFormatSchema,
  deterministicSourceFormatSchema,
  engagementPredictionSchema,
  postCoachViewModelSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type DetectedPostFormat,
  type DeterministicSourceFormat,
  type EngagementPrediction,
  type PostCoachViewModel,
} from "../../index";

const analyzedAt = "2026-06-07T12:00:00.000Z";
const learningCaveat = "Static rule check. Imported performance data is not connected yet.";

const score = {
  value: 72,
  checks: [
    {
      id: "quality_hook",
      label: "Clear hook",
      status: "pass",
    },
    {
      id: "specificity",
      label: "Specific proof",
      status: "warn",
    },
  ],
  learnings: [
    {
      text: "Static rule evidence: specific launch details tend to make posts easier to evaluate.",
      relevance: "general",
    },
  ],
  engageability: {
    engageable: true,
    reason: "Ends with a concrete question.",
  },
};

const postCoach = {
  state: "ready",
  title: "Post Coach",
  value: 72,
  badge: {
    label: "Ship it",
    tone: "ship",
    tooltip: "Solid post. Ship it; higher scores are a bonus.",
  },
  target: 60,
  engageability: score.engageability,
  failed: [],
  warned: [score.checks[1]],
  passed: [score.checks[0]],
  counts: {
    flagged: 0,
    nudges: 1,
    onPoint: 1,
  },
  expanded: false,
  previewMode: true,
  sections: [
    {
      title: "Sample",
      items: [score.checks[0], score.checks[1]],
    },
  ],
  learnings: [],
  learningCaveat,
  hiddenChecks: 0,
  helperText: "Signals, not verdicts.",
  footerText: "Static heuristic checks only.",
};

const availablePrediction = {
  status: "available",
  rangeLow: 180,
  rangeHigh: 420,
  midpoint: 300,
  confidence: "medium",
  signals: [
    {
      signal_key: "quality_voice",
      label: "Static score 72",
      multiplier: 0.8,
    },
  ],
};

const missingFollowersPrediction = {
  status: "disabled",
  reason: "missing_followers",
  message: "Prediction needs follower count.",
};

const scoredItem = {
  status: "scored",
  id: "candidate-1",
  text: "genuine question: what made your onboarding finally click?",
  sourceFormat: "debate-question",
  detectedFormat: "genuine_question",
  score,
  postCoach,
  prediction: availablePrediction,
  heuristicLabel: "Heuristic rank, not prediction.",
  analyzedAt,
  analyzerVersion: "deterministic-v1",
};

describe("deterministic analyze schemas", () => {
  it("exports deterministic analyze schemas and inferred types from the shared entrypoint", () => {
    expect(analyzePostsRequestSchema).toBeDefined();
    expect(analyzePostsResponseSchema).toBeDefined();
    expect(analyzedPostItemSchema).toBeDefined();
    expect(postCoachViewModelSchema).toBeDefined();
    expect(engagementPredictionSchema).toBeDefined();
    expect(deterministicSourceFormatSchema).toBeDefined();
    expect(detectedPostFormatSchema).toBeDefined();

    expectTypeOf<AnalyzePostsRequest>().toMatchTypeOf<
      ReturnType<typeof analyzePostsRequestSchema.parse>
    >();
    expectTypeOf<AnalyzePostsResponse>().toMatchTypeOf<
      ReturnType<typeof analyzePostsResponseSchema.parse>
    >();
    expectTypeOf<AnalyzedPostItem>().toMatchTypeOf<
      ReturnType<typeof analyzedPostItemSchema.parse>
    >();
    expectTypeOf<PostCoachViewModel>().toMatchTypeOf<
      ReturnType<typeof postCoachViewModelSchema.parse>
    >();
    expectTypeOf<EngagementPrediction>().toMatchTypeOf<
      ReturnType<typeof engagementPredictionSchema.parse>
    >();
    expectTypeOf<DeterministicSourceFormat>().toMatchTypeOf<
      ReturnType<typeof deterministicSourceFormatSchema.parse>
    >();
    expectTypeOf<DetectedPostFormat>().toMatchTypeOf<
      ReturnType<typeof detectedPostFormatSchema.parse>
    >();
  });

  it("parses request-scoped analysis input and defaults Post Coach presentation to preview", () => {
    const parsed = analyzePostsRequestSchema.parse({
      items: [
        {
          id: "candidate-1",
          text: "Ship the smaller version that creates proof.",
          sourceFormat: "one-liner",
        },
      ],
      scoringContext: {},
      presentation: {},
    });

    expect(parsed).toMatchObject({
      items: [
        {
          id: "candidate-1",
          text: "Ship the smaller version that creates proof.",
          sourceFormat: "one-liner",
        },
      ],
      scoringContext: {},
      presentation: {
        postCoachMode: "preview",
      },
    });
  });

  it("accepts one to ten items and rejects empty or oversized batches", () => {
    const tenItems = Array.from({ length: 10 }, (_, index) => ({
      id: `candidate-${index + 1}`,
      text: `Candidate ${index + 1} has enough text to analyze.`,
    }));

    expect(
      analyzePostsRequestSchema.safeParse({
        items: [tenItems[0]],
        scoringContext: { followers: 2400 },
        presentation: { postCoachMode: "expanded" },
      }).success,
    ).toBe(true);
    expect(
      analyzePostsRequestSchema.safeParse({
        items: tenItems,
        scoringContext: { followers: 2400 },
        presentation: { postCoachMode: "expanded" },
      }).success,
    ).toBe(true);
    expect(
      analyzePostsRequestSchema.safeParse({
        items: [],
        scoringContext: {},
        presentation: {},
      }).success,
    ).toBe(false);
    expect(
      analyzePostsRequestSchema.safeParse({
        items: [...tenItems, { id: "candidate-11", text: "This pushes the batch over the limit." }],
        scoringContext: {},
        presentation: {},
      }).success,
    ).toBe(false);
  });

  it("parses scored responses with required Post Coach, prediction, labels, and analyzer metadata", () => {
    const result = analyzedPostItemSchema.safeParse(scoredItem);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected scored deterministic item to parse.");
    }
    expect(result.data).toMatchObject({
      status: "scored",
      id: "candidate-1",
      sourceFormat: "debate-question",
      detectedFormat: "genuine_question",
      heuristicLabel: "Heuristic rank, not prediction.",
      analyzedAt,
      analyzerVersion: "deterministic-v1",
      postCoach: {
        state: "ready",
        title: "Post Coach",
        learningCaveat,
      },
      prediction: {
        status: "available",
        confidence: "medium",
      },
    });
  });

  it("rejects scored responses that omit the engine-produced Post Coach view model", () => {
    const { postCoach: _postCoach, ...withoutPostCoach } = scoredItem;

    expect(analyzedPostItemSchema.safeParse(withoutPostCoach).success).toBe(false);
    expect(
      analyzePostsResponseSchema.safeParse({
        items: [withoutPostCoach],
      }).success,
    ).toBe(false);
  });

  it("rejects ready Post Coach view models that omit the learning caveat", () => {
    const { learningCaveat: _learningCaveat, ...withoutLearningCaveat } = postCoach;

    expect(postCoachViewModelSchema.safeParse(withoutLearningCaveat).success).toBe(false);
    expect(
      analyzedPostItemSchema.safeParse({
        ...scoredItem,
        postCoach: withoutLearningCaveat,
      }).success,
    ).toBe(false);
  });

  it("parses ready Post Coach view models with the day-one learning caveat", () => {
    const result = postCoachViewModelSchema.safeParse(postCoach);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected ready Post Coach with learning caveat to parse.");
    }
    expect(result.data).toMatchObject({
      state: "ready",
      learningCaveat,
    });
  });

  it("parses per-item score failures while preserving candidate text and retry metadata", () => {
    expect(
      analyzedPostItemSchema.safeParse({
        status: "score_failed",
        id: "candidate-2",
        text: "Hot take: unclear drafts are usually missing one concrete tradeoff.",
        sourceFormat: "mini-framework",
        reason: "analyzer_exception",
        message: "Deterministic analysis failed for this candidate.",
        retryable: true,
      }).success,
    ).toBe(true);
  });

  it("parses mixed analyze responses so item failures stay inside the success body", () => {
    const result = analyzePostsResponseSchema.safeParse({
      items: [
        scoredItem,
        {
          status: "score_failed",
          id: "candidate-2",
          text: "Hot take: unclear drafts are usually missing one concrete tradeoff.",
          reason: "analyzer_exception",
          message: "Deterministic analysis failed for this candidate.",
          retryable: true,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected mixed deterministic response to parse.");
    }
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[1]).toMatchObject({
      status: "score_failed",
      id: "candidate-2",
      text: "Hot take: unclear drafts are usually missing one concrete tradeoff.",
      retryable: true,
    });
  });

  it("models missing followers as an explicit disabled prediction state", () => {
    expect(engagementPredictionSchema.safeParse(missingFollowersPrediction).success).toBe(true);
    expect(
      analyzedPostItemSchema.safeParse({
        ...scoredItem,
        prediction: missingFollowersPrediction,
      }).success,
    ).toBe(true);
    expect(
      engagementPredictionSchema.safeParse({
        rangeLow: 120,
        rangeHigh: 280,
        midpoint: 200,
        confidence: "low",
        signals: [],
      }).success,
    ).toBe(false);
  });

  it("keeps writer source format separate from analyzer detected format", () => {
    expect(deterministicSourceFormatSchema.safeParse("one-liner").success).toBe(true);
    expect(deterministicSourceFormatSchema.safeParse("mini-framework").success).toBe(true);
    expect(deterministicSourceFormatSchema.safeParse("debate-question").success).toBe(true);
    expect(deterministicSourceFormatSchema.safeParse("genuine_question").success).toBe(false);

    expect(detectedPostFormatSchema.safeParse("genuine_question").success).toBe(true);
    expect(detectedPostFormatSchema.safeParse("insight_share").success).toBe(true);
    expect(detectedPostFormatSchema.safeParse("one-liner").success).toBe(false);
  });
});
