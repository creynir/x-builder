import { describe, expect, expectTypeOf, it } from "vitest";
import {
  analyzedPostItemSchema,
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  availableEngagementPredictionSchema,
  detectedPostFormatSchema,
  deterministicSourceFormatSchema,
  engagementPredictionSchema,
  judgeSignalsSchema,
  postCoachViewModelSchema,
  reachRangeSchema,
  repeatHistoryEntrySchema,
  scoringContextSchema,
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
        reason: "analysis_failed",
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
          reason: "analysis_failed",
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

  it("rejects an available prediction whose range is not ordered low <= midpoint <= high", () => {
    expect(
      engagementPredictionSchema.safeParse({
        status: "available",
        rangeLow: 420,
        rangeHigh: 180,
        midpoint: 999,
        confidence: "medium",
        signals: [],
      }).success,
    ).toBe(false);
    expect(engagementPredictionSchema.safeParse(availablePrediction).success).toBe(true);
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

const newDetectedFormats = [
  "fill_blank_tribal",
  "cta_farm",
  "fantasy_question",
  "binary_choice",
  "nuanced_question",
  "recognition_roast",
  "wisdom_one_liner",
  "milestone",
] as const;

describe("detected post format enum widening", () => {
  it("accepts each of the eight new detected post formats", () => {
    for (const format of newDetectedFormats) {
      expect(detectedPostFormatSchema.safeParse(format).success).toBe(true);
    }
  });

  it("still accepts the live classifier formats that are bridged until a later removal", () => {
    expect(detectedPostFormatSchema.safeParse("one_liner").success).toBe(true);
    expect(detectedPostFormatSchema.safeParse("goal_share").success).toBe(true);
  });

  it("still rejects an unknown detected post format string", () => {
    expect(detectedPostFormatSchema.safeParse("viral_thread").success).toBe(false);
    expect(detectedPostFormatSchema.safeParse("").success).toBe(false);
  });
});

describe("scoring context schema", () => {
  it("is re-exported from the shared entrypoint", () => {
    expect(scoringContextSchema).toBeDefined();
    expect(repeatHistoryEntrySchema).toBeDefined();
    expect(judgeSignalsSchema).toBeDefined();
  });

  it("parses a legacy followers-only context and applies the new defaults", () => {
    const parsed = scoringContextSchema.parse({ followers: 2400 });

    expect(parsed.followers).toBe(2400);
    expect(parsed.repeatHistory).toEqual([]);
    expect(parsed.willAttachMedia).toBe(false);
    expect(parsed.trailingMedianImpressions).toBeUndefined();
    expect(parsed.plannedHourUtc).toBeUndefined();
    expect(parsed.accountAgeYears).toBeUndefined();
    expect(parsed.judgeSignals).toBeUndefined();
  });

  it("parses an analyze request whose scoring context carries only followers and fills the widened defaults", () => {
    const parsed = analyzePostsRequestSchema.parse({
      items: [{ id: "candidate-1", text: "Ship the smaller version that creates proof." }],
      scoringContext: { followers: 2400 },
      presentation: {},
    });

    expect(parsed.scoringContext.repeatHistory).toEqual([]);
    expect(parsed.scoringContext.willAttachMedia).toBe(false);
    expect(parsed.scoringContext.trailingMedianImpressions).toBeUndefined();
    expect(parsed.scoringContext.plannedHourUtc).toBeUndefined();
    expect(parsed.scoringContext.accountAgeYears).toBeUndefined();
    expect(parsed.scoringContext.judgeSignals).toBeUndefined();
  });

  it("retains a fully populated scoring context including media, planning, and judge signals", () => {
    const result = scoringContextSchema.safeParse({
      followers: 5000,
      trailingMedianImpressions: 0,
      repeatHistory: [
        {
          format: "hot_take",
          lastPostedAt: "2026-06-10T08:00:00.000Z",
          countLast7d: 3,
        },
      ],
      plannedHourUtc: 14,
      willAttachMedia: true,
      accountAgeYears: 2,
      judgeSignals: { impressions: 60, replies: 40 },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected fully populated scoring context to parse.");
    }
    expect(result.data.trailingMedianImpressions).toBe(0);
    expect(result.data.willAttachMedia).toBe(true);
    expect(result.data.judgeSignals).toEqual({ impressions: 60, replies: 40 });
    expect(result.data.repeatHistory).toHaveLength(1);
  });

  it("treats trailingMedianImpressions of zero as a present value", () => {
    const parsed = scoringContextSchema.parse({ trailingMedianImpressions: 0 });

    expect(parsed.trailingMedianImpressions).toBe(0);
  });

  it("accepts judge signal boundaries at 0 and 100 but rejects values above 100", () => {
    expect(judgeSignalsSchema.safeParse({ impressions: 0, replies: 0 }).success).toBe(true);
    expect(judgeSignalsSchema.safeParse({ impressions: 100, replies: 100 }).success).toBe(true);
    expect(judgeSignalsSchema.safeParse({ impressions: 101, replies: 40 }).success).toBe(false);
    expect(
      scoringContextSchema.safeParse({ judgeSignals: { impressions: 101, replies: 40 } }).success,
    ).toBe(false);
  });

  it("accepts exactly forty repeat-history entries but rejects forty-one", () => {
    const entry = {
      format: "hot_take",
      lastPostedAt: "2026-06-10T08:00:00.000Z",
      countLast7d: 1,
    };
    const fortyEntries = Array.from({ length: 40 }, () => entry);
    const fortyOneEntries = Array.from({ length: 41 }, () => entry);

    expect(scoringContextSchema.safeParse({ repeatHistory: fortyEntries }).success).toBe(true);
    expect(scoringContextSchema.safeParse({ repeatHistory: fortyOneEntries }).success).toBe(false);
  });

  it("constrains repeat-history entries to a valid format, ISO timestamp, and 0..100 weekly count", () => {
    expect(
      repeatHistoryEntrySchema.safeParse({
        format: "hot_take",
        lastPostedAt: "2026-06-10T08:00:00.000Z",
        countLast7d: 0,
      }).success,
    ).toBe(true);
    expect(
      repeatHistoryEntrySchema.safeParse({
        format: "hot_take",
        lastPostedAt: "2026-06-10T08:00:00.000Z",
        countLast7d: 100,
      }).success,
    ).toBe(true);
    expect(
      repeatHistoryEntrySchema.safeParse({
        format: "not_a_format",
        lastPostedAt: "2026-06-10T08:00:00.000Z",
        countLast7d: 1,
      }).success,
    ).toBe(false);
    expect(
      repeatHistoryEntrySchema.safeParse({
        format: "hot_take",
        lastPostedAt: "2026-06-10",
        countLast7d: 1,
      }).success,
    ).toBe(false);
    expect(
      repeatHistoryEntrySchema.safeParse({
        format: "hot_take",
        lastPostedAt: "2026-06-10T08:00:00.000Z",
        countLast7d: 101,
      }).success,
    ).toBe(false);
  });

  it("constrains plannedHourUtc to the 0..23 range", () => {
    expect(scoringContextSchema.safeParse({ plannedHourUtc: 0 }).success).toBe(true);
    expect(scoringContextSchema.safeParse({ plannedHourUtc: 23 }).success).toBe(true);
    expect(scoringContextSchema.safeParse({ plannedHourUtc: 24 }).success).toBe(false);
    expect(scoringContextSchema.safeParse({ plannedHourUtc: -1 }).success).toBe(false);
  });
});

const completeAvailablePrediction = {
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
  predictedMidImpressions: 140,
  stallRange: { low: 10, high: 240 },
  escapeRange: { low: 300, high: 900 },
  escapeProbability: 0.35,
  expectedReplies: 4,
  baseImpressions: 200,
  baseSource: "trailing_median",
  qualityBasis: "static",
  reachModelVersion: "reach-v1",
};

describe("reach range schema", () => {
  it("is re-exported from the shared entrypoint", () => {
    expect(reachRangeSchema).toBeDefined();
  });

  it("accepts a non-negative range where low does not exceed high", () => {
    expect(reachRangeSchema.safeParse({ low: 10, high: 240 }).success).toBe(true);
    expect(reachRangeSchema.safeParse({ low: 0, high: 0 }).success).toBe(true);
  });

  it("rejects a reach range whose low exceeds its high", () => {
    expect(reachRangeSchema.safeParse({ low: 500, high: 100 }).success).toBe(false);
  });

  it("rejects a reach range with negative bounds", () => {
    expect(reachRangeSchema.safeParse({ low: -1, high: 240 }).success).toBe(false);
    expect(reachRangeSchema.safeParse({ low: 10, high: -240 }).success).toBe(false);
  });
});

describe("available engagement prediction four-regime widening", () => {
  it("is re-exported from the shared entrypoint", () => {
    expect(availableEngagementPredictionSchema).toBeDefined();
  });

  it("still parses a legacy available prediction that carries only the required fields", () => {
    expect(engagementPredictionSchema.safeParse(availablePrediction).success).toBe(true);
    expect(availableEngagementPredictionSchema.safeParse(availablePrediction).success).toBe(true);
  });

  it("retains the four-regime reach fields when an available prediction supplies them", () => {
    const result = engagementPredictionSchema.safeParse(completeAvailablePrediction);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected a four-regime available prediction to parse.");
    }
    expect(result.data).toMatchObject({
      status: "available",
      predictedMidImpressions: 140,
      stallRange: { low: 10, high: 240 },
      escapeRange: { low: 300, high: 900 },
      escapeProbability: 0.35,
      expectedReplies: 4,
      baseImpressions: 200,
      baseSource: "trailing_median",
      qualityBasis: "static",
      reachModelVersion: "reach-v1",
    });
  });

  it("rejects a stall range whose low exceeds its high", () => {
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        stallRange: { low: 300, high: 10 },
      }).success,
    ).toBe(false);
  });

  it("constrains escapeProbability to the 0..1 range", () => {
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        escapeProbability: 0,
      }).success,
    ).toBe(true);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        escapeProbability: 1,
      }).success,
    ).toBe(true);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        escapeProbability: 1.2,
      }).success,
    ).toBe(false);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        escapeProbability: -0.1,
      }).success,
    ).toBe(false);
  });

  it("constrains reachModelVersion to between one and forty characters", () => {
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        reachModelVersion: "",
      }).success,
    ).toBe(false);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        reachModelVersion: "v".repeat(41),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown baseSource and qualityBasis discriminants", () => {
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        baseSource: "guess",
      }).success,
    ).toBe(false);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        qualityBasis: "vibes",
      }).success,
    ).toBe(false);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        baseSource: "follower_estimate",
        qualityBasis: "judge",
      }).success,
    ).toBe(true);
  });

  it("rejects negative or non-integer base impression and reply counts", () => {
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        baseImpressions: -1,
      }).success,
    ).toBe(false);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        predictedMidImpressions: -5,
      }).success,
    ).toBe(false);
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        expectedReplies: -2,
      }).success,
    ).toBe(false);
  });

  it("still rejects an available prediction whose legacy range is mis-ordered", () => {
    expect(
      engagementPredictionSchema.safeParse({
        ...completeAvailablePrediction,
        rangeLow: 999,
        midpoint: 300,
        rangeHigh: 420,
      }).success,
    ).toBe(false);
  });
});
