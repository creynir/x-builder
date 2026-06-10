import { describe, expect, it } from "vitest";

import {
  apiErrorSchema,
  judgeDraftRequestSchema,
  judgeDraftResponseSchema,
  judgeVerdictSchema,
} from "../../index.js";

const validVerdict = {
  rating: 7,
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

  it("parses a valid verdict and a full judged response", () => {
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

  it("rejects a rating outside 0..10", () => {
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, rating: 11 }).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, rating: -1 }).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, rating: 7.5 }).success).toBe(false);
  });

  it("rejects more than five strengths or improvements", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, strengths: six }).success).toBe(false);
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, improvements: six }).success).toBe(false);
  });

  it("accepts empty strengths and improvements arrays", () => {
    expect(
      judgeVerdictSchema.safeParse({ ...validVerdict, strengths: [], improvements: [] }).success,
    ).toBe(true);
  });

  it("rejects empty or over-long strength/improvement items", () => {
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, strengths: [""] }).success).toBe(false);
    expect(
      judgeVerdictSchema.safeParse({ ...validVerdict, improvements: ["a".repeat(241)] }).success,
    ).toBe(false);
  });

  it("rejects an empty or over-long headline", () => {
    expect(judgeVerdictSchema.safeParse({ ...validVerdict, headline: "" }).success).toBe(false);
    expect(
      judgeVerdictSchema.safeParse({ ...validVerdict, headline: "h".repeat(161) }).success,
    ).toBe(false);
  });

  it("rejects a verdict missing a required field", () => {
    const { rating: _rating, ...withoutRating } = validVerdict;
    expect(judgeVerdictSchema.safeParse(withoutRating).success).toBe(false);
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

  it("keeps pre-existing api error codes and scopes valid after the judge additions", () => {
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
