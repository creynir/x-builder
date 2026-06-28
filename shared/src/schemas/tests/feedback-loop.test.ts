import { describe, expect, expectTypeOf, it } from "vitest";
import {
  apiErrorSchema,
  feedbackOutcomeSchema,
  getFeedbackLoopSummaryRequestSchema,
  getFeedbackLoopSummaryResponseSchema,
  recordFeedbackPredictionRequestSchema,
  type FeedbackOutcome,
  type GetFeedbackLoopSummaryResponse,
} from "../../index";

const analyzedAt = "2026-06-28T09:00:00.000Z";

const availablePrediction = {
  status: "available",
  signals: [
    {
      signal_key: "quality_score",
      label: "Score 72",
      multiplier: 0.9,
    },
  ],
  predictedMidImpressions: 480,
  stallRange: { low: 200, high: 420 },
  escapeRange: { low: 900, high: 2600 },
  escapeProbability: 0.18,
  expectedReplies: 4,
  baseImpressions: 320,
  baseSource: "follower_estimate",
  qualityBasis: "static",
  reachModelVersion: "reach-v1",
};

const snapshot = {
  detectedFormat: "insight_share",
  sourceFormat: "mini-framework",
  scoreValue: 72,
  prediction: availablePrediction,
  scoringContext: {
    followers: 1_200,
    trailingMedianImpressions: 350,
  },
  analyzerVersion: "deterministic-v1",
  analyzedAt,
};

const recordRequest = {
  clientEventId: "event-1",
  action: "generated_draft_written",
  text: "  The interesting part of local feedback loops is the matching boundary.  ",
  platform: "x",
  snapshot,
};

const record = {
  id: "feedback-1",
  clientEventId: "event-1",
  action: "generated_draft_written",
  platform: "x",
  text: "The interesting part of local feedback loops is the matching boundary.",
  contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  detectedFormat: "insight_share",
  sourceFormat: "mini-framework",
  scoreValue: 72,
  prediction: availablePrediction,
  scoringContext: snapshot.scoringContext,
  analyzerVersion: "deterministic-v1",
  analyzedAt,
  createdAt: analyzedAt,
};

describe("feedback-loop schemas", () => {
  it("exports inferred record and summary types from the shared entrypoint", () => {
    expect(recordFeedbackPredictionRequestSchema).toBeDefined();
    expect(getFeedbackLoopSummaryResponseSchema).toBeDefined();

    expectTypeOf<GetFeedbackLoopSummaryResponse>().toMatchTypeOf<
      ReturnType<typeof getFeedbackLoopSummaryResponseSchema.parse>
    >();
    expectTypeOf<FeedbackOutcome>().toMatchTypeOf<ReturnType<typeof feedbackOutcomeSchema.parse>>();
  });

  it("accepts a valid record request with an available prediction and trims text", () => {
    const parsed = recordFeedbackPredictionRequestSchema.parse(recordRequest);

    expect(parsed.text).toBe(
      "The interesting part of local feedback loops is the matching boundary.",
    );
    expect(parsed.platform).toBe("x");
    expect(parsed.snapshot.prediction.status).toBe("available");
  });

  it("rejects disabled predictions for record requests", () => {
    const result = recordFeedbackPredictionRequestSchema.safeParse({
      ...recordRequest,
      snapshot: {
        ...snapshot,
        prediction: {
          status: "disabled",
          reason: "missing_followers",
          message: "Prediction needs follower count.",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects stale summary statuses such as auto_linked", () => {
    const result = feedbackOutcomeSchema.safeParse({
      status: "auto_linked",
      prediction: record,
    });

    expect(result.success).toBe(false);
  });

  it("preserves ambiguity metadata on summary outcomes", () => {
    const parsed = feedbackOutcomeSchema.parse({
      status: "ambiguous",
      prediction: record,
      ambiguity: {
        candidatePlatformPostIds: ["100", "101"],
      },
    });

    expect(parsed.ambiguity?.candidatePlatformPostIds).toEqual(["100", "101"]);
  });

  it("defaults optional summary request values", () => {
    expect(getFeedbackLoopSummaryRequestSchema.parse({})).toEqual({
      windowDays: 90,
      limit: 50,
    });
  });

  it("rejects non-x platforms", () => {
    const result = recordFeedbackPredictionRequestSchema.safeParse({
      ...recordRequest,
      platform: "threads",
    });

    expect(result.success).toBe(false);
  });

  it("accepts feedback-scoped API errors", () => {
    expect(
      apiErrorSchema.safeParse({
        code: "feedback_summary_failed",
        scope: "feedback",
        message: "Feedback summary failed.",
        retryable: true,
        status: 500,
      }).success,
    ).toBe(true);
  });
});
