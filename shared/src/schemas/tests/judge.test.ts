import { describe, expect, it } from "vitest";

import {
  apiErrorSchema,
  deriveJudgeVerdict,
  judgeDraftRequestSchema,
  judgeDraftResponseSchema,
  judgeScoresSchema,
  judgeVerdictSchema,
} from "../../index.js";

const scores = {
  overall: 78,
  replies: 80,
  profileClicks: 72,
  impressions: 65,
  bookmarkValue: 60,
  dwellProxy: 70,
  voiceMatch: 85,
  negativeRisk: 10,
};

// The full RMU-001 score set: the existing eight dimensions plus the five new
// behavioral dimensions, with audienceMatch present-but-nullable on the wire.
const extendedScores = {
  ...scores,
  answerEffort: 55,
  strangerAnswerability: 48,
  statusDependency: 30,
  replyVsQuoteOrientation: 62,
  audienceMatch: null,
};

const validVerdict = {
  verdict: "slight_rework",
  confidence: "medium",
  scores,
  headline: "Strong hook, weak closer.",
  strengths: ["Opens with a concrete claim", "Ends on a reply-friendly question"],
  improvements: ["Tighten the middle paragraph"],
};

describe("judge schemas", () => {
  it("parses a valid judge draft request", () => {
    expect(judgeDraftRequestSchema.safeParse({ text: "A draft worth judging." }).success).toBe(true);
  });

  it("rejects an empty or whitespace-only draft request", () => {
    expect(judgeDraftRequestSchema.safeParse({ text: "" }).success).toBe(false);
    expect(judgeDraftRequestSchema.safeParse({ text: "   \n\t " }).success).toBe(false);
  });

  it("rejects a draft longer than 8000 characters", () => {
    expect(judgeDraftRequestSchema.safeParse({ text: "a".repeat(8_001) }).success).toBe(false);
  });

  it("parses a valid multi-dimensional verdict and a full judged response", () => {
    expect(judgeVerdictSchema.safeParse(validVerdict).success).toBe(true);
    expect(
      judgeDraftResponseSchema.safeParse({
        status: "judged",
        verdict: validVerdict,
        model: "codex",
        judgedAt: "2026-06-10T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects a score outside 0..100 or non-integer", () => {
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, scores: { ...scores, replies: 101 } }).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, scores: { ...scores, replies: -1 } }).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, scores: { ...scores, replies: 80.5 } }).success).toBe(false);
  });

  it("rejects a verdict that is missing a score dimension", () => {
    const { voiceMatch: _voiceMatch, ...partialScores } = scores;
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, scores: partialScores }).success).toBe(false);
  });

  it("rejects an unknown verdict label or confidence level", () => {
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, verdict: "ship_it" }).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, confidence: "certain" }).success).toBe(false);
  });

  it("rejects an empty or over-long headline and over-long critique items", () => {
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, headline: "" }).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, strengths: ["a".repeat(241)] }).success).toBe(false);
    expect(
      judgeVerdictSchema.safeParse({ ...validVerdict, improvements: ["a", "b", "c", "d", "e", "f"] }).success,
    ).toBe(false);
  });

  it("accepts a verdict with empty strengths and improvements arrays", () => {
    expect(
      judgeVerdictSchema.safeParse({ ...validVerdict, strengths: [], improvements: [] }).success,
    ).toBe(true);
  });

  it("rejects a response with a wrong status literal, blank model, or non-ISO judgedAt", () => {
    const base = {
      status: "judged",
      verdict: validVerdict,
      model: "codex",
      judgedAt: "2026-06-10T12:00:00.000Z",
    };
    expect(judgeDraftResponseSchema.safeParse({ ...base, status: "done" }).success).toBe(false);
    expect(judgeDraftResponseSchema.safeParse({ ...base, model: "" }).success).toBe(false);
    expect(judgeDraftResponseSchema.safeParse({ ...base, judgedAt: "2026-06-10" }).success).toBe(false);
  });

  it("derives the verdict band from the overall score", () => {
    expect(deriveJudgeVerdict(90)).toBe("post_now");
    expect(deriveJudgeVerdict(85)).toBe("post_now");
    expect(deriveJudgeVerdict(84)).toBe("slight_rework");
    expect(deriveJudgeVerdict(70)).toBe("slight_rework");
    expect(deriveJudgeVerdict(69)).toBe("major_rework");
    expect(deriveJudgeVerdict(40)).toBe("major_rework");
    expect(deriveJudgeVerdict(39)).toBe("do_not_post");
    expect(deriveJudgeVerdict(0)).toBe("do_not_post");
  });

  it("accepts the judge_failed api error code with the judge scope", () => {
    const result = apiErrorSchema.safeParse({
      code: "judge_failed",
      message: "The Codex judge could not score this draft.",
      scope: "judge",
      retryable: true,
      status: 503,
    });

    expect(result.success).toBe(true);
  });

  it("keeps pre-existing api error codes and scopes valid", () => {
    const result = apiErrorSchema.safeParse({
      code: "generation_failed",
      message: "Idea generation failed. Try again.",
      scope: "writer",
      retryable: true,
      status: 500,
    });

    expect(result.success).toBe(true);
  });
});

describe("judge score dimension widening", () => {
  it("retains the four new numeric dimensions and an explicit null audience match", () => {
    const result = judgeScoresSchema.safeParse(extendedScores);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected the extended judge score set to parse.");
    }
    expect(result.data).toMatchObject({
      answerEffort: 55,
      strangerAnswerability: 48,
      statusDependency: 30,
      replyVsQuoteOrientation: 62,
      audienceMatch: null,
    });
  });

  it("accepts a numeric audience match when a profile is supplied", () => {
    const result = judgeScoresSchema.safeParse({ ...extendedScores, audienceMatch: 70 });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected a numeric audience match to parse.");
    }
    expect(result.data.audienceMatch).toBe(70);
  });

  it("rejects each new dimension when out of the 0..100 integer range", () => {
    expect(judgeScoresSchema.safeParse({ ...extendedScores, answerEffort: 101 }).success).toBe(false);
    expect(
      judgeScoresSchema.safeParse({ ...extendedScores, strangerAnswerability: -1 }).success,
    ).toBe(false);
    expect(
      judgeScoresSchema.safeParse({ ...extendedScores, statusDependency: 50.5 }).success,
    ).toBe(false);
    expect(judgeScoresSchema.safeParse({ ...extendedScores, audienceMatch: 101 }).success).toBe(false);
  });

  it("parses a full verdict carrying the extended score set", () => {
    const result = judgeVerdictSchema.safeParse({ ...validVerdict, scores: extendedScores });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected a verdict with the extended score set to parse.");
    }
    expect(result.data.scores).toMatchObject({
      answerEffort: 55,
      audienceMatch: null,
    });
  });
});

describe("judge draft request account profile", () => {
  it("parses a draft request that omits the optional account profile", () => {
    const parsed = judgeDraftRequestSchema.parse({ text: "A draft worth judging." });

    expect(parsed.accountProfile).toBeUndefined();
  });

  it("retains a supplied account profile", () => {
    const result = judgeDraftRequestSchema.safeParse({
      text: "A draft worth judging.",
      accountProfile: "Indie hacker shipping a local-first writing tool.",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected a draft request with an account profile to parse.");
    }
    expect(result.data.accountProfile).toBe(
      "Indie hacker shipping a local-first writing tool.",
    );
  });

  it("rejects a whitespace-only account profile", () => {
    expect(
      judgeDraftRequestSchema.safeParse({ text: "A draft.", accountProfile: "   \n\t " }).success,
    ).toBe(false);
  });

  it("rejects an account profile longer than 600 characters", () => {
    expect(
      judgeDraftRequestSchema.safeParse({ text: "A draft.", accountProfile: "a".repeat(601) })
        .success,
    ).toBe(false);
  });
});
