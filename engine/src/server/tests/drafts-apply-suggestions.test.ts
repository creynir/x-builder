import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  applyJudgeSuggestionsResponseSchema,
  type ApplyJudgeSuggestionsRequest,
  type ApplyJudgeSuggestionsResponse,
  type JudgeVerdict,
} from "@x-builder/shared";

import { buildServer } from "../server";

const parseJson = (payload: string): unknown => JSON.parse(payload);

const originalText = "The original draft worth improving.";
const rewrittenText = "A sharper, reply-friendlier rewrite of the draft.";

// A verdict at a given overall score so the band and approved flag stay honest.
const verdictWithOverall = (overall: number): JudgeVerdict => ({
  verdict:
    overall >= 85
      ? "post_now"
      : overall >= 70
        ? "slight_rework"
        : overall >= 40
          ? "major_rework"
          : "do_not_post",
  confidence: "medium",
  scores: {
    overall,
    replies: 80,
    profileClicks: 72,
    impressions: 65,
    bookmarkValue: 60,
    dwellProxy: 70,
    voiceMatch: 85,
    negativeRisk: 10,
    answerEffort: 55,
    strangerAnswerability: 48,
    statusDependency: 30,
    replyVsQuoteOrientation: 62,
    audienceMatch: null,
  },
  headline: "A controlled verdict for the route fake.",
  strengths: ["Concrete claim"],
  improvements: ["Trim the close"],
  annotations: [],
});

// The route only depends on a service exposing `apply`; build the smallest fake
// that satisfies the injected service slot.
const serviceWith = (
  apply: (request: ApplyJudgeSuggestionsRequest) => Promise<ApplyJudgeSuggestionsResponse>,
) =>
  ({ apply: vi.fn(apply) }) as unknown as NonNullable<
    Parameters<typeof buildServer>[0]
  >["applyJudgeSuggestionsService"];

const improvedResponse = (): ApplyJudgeSuggestionsResponse => ({
  text: rewrittenText,
  verdict: verdictWithOverall(78),
  approved: true,
  improvedOverOriginal: true,
});

const notImprovedResponse = (): ApplyJudgeSuggestionsResponse => ({
  text: originalText,
  verdict: verdictWithOverall(80),
  approved: true,
  improvedOverOriginal: false,
});

describe("POST /drafts/apply-suggestions", () => {
  it("returns 200 with the rewritten text when the rewrite improves over the original", async () => {
    const app = buildServer({
      applyJudgeSuggestionsService: serviceWith(async () => improvedResponse()),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/apply-suggestions",
        payload: { text: originalText },
      });

      expect(response.statusCode).toBe(200);

      const body = applyJudgeSuggestionsResponseSchema.parse(parseJson(response.body));
      expect(body.improvedOverOriginal).toBe(true);
      expect(body.text).toBe(rewrittenText);
      expect(body.text).not.toBe(originalText);
    } finally {
      await app.close();
    }
  });

  it("returns 200 with the original text when the never-worse guard keeps the original", async () => {
    const app = buildServer({
      applyJudgeSuggestionsService: serviceWith(async () => notImprovedResponse()),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/apply-suggestions",
        payload: { text: originalText },
      });

      expect(response.statusCode).toBe(200);

      const body = applyJudgeSuggestionsResponseSchema.parse(parseJson(response.body));
      expect(body.improvedOverOriginal).toBe(false);
      expect(body.text).toBe(originalText);
    } finally {
      await app.close();
    }
  });

  it("returns 500 with generation_failed when the service throws", async () => {
    const app = buildServer({
      applyJudgeSuggestionsService: serviceWith(async () => {
        throw new Error("the apply chain failed");
      }),
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/apply-suggestions",
        payload: { text: originalText },
      });

      expect(response.statusCode).toBe(500);

      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error.code).toBe("generation_failed");
    } finally {
      await app.close();
    }
  });
});
