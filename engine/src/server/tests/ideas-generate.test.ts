import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  generateIdeaResponseSchema,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
  type JudgeVerdict,
} from "@x-builder/shared";

import { buildServer } from "../server";

const parseJson = (payload: string): unknown => JSON.parse(payload);

const verdict: JudgeVerdict = {
  verdict: "slight_rework",
  confidence: "medium",
  scores: {
    overall: 78,
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
  headline: "Solid, reply-friendly.",
  strengths: ["Concrete claim"],
  improvements: ["Trim the close"],
  annotations: [],
};

// A format-path response shaped exactly like the contract: three candidates,
// each carrying a verdict and an approved flag.
const formatPathResponse = (): GenerateIdeaResponse => ({
  candidates: [
    { id: "cand-0", format: "one-liner", text: "First angle.", verdict, approved: true },
    { id: "cand-1", format: "mini-framework", text: "Second angle.", verdict, approved: true },
    { id: "cand-2", format: "debate-question", text: "Third angle.", verdict, approved: true },
  ],
});

const formatBody: GenerateIdeaRequest = { format: "hot_take" };

describe("POST /ideas/generate", () => {
  it("returns 200 with exactly three candidates for a format-path request", async () => {
    const generateCandidates = vi.fn(
      async (_input: GenerateIdeaRequest): Promise<GenerateIdeaResponse> => formatPathResponse(),
    );
    const app = buildServer({ generateCandidates });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: formatBody,
      });

      expect(response.statusCode).toBe(200);
      expect(generateCandidates).toHaveBeenCalledTimes(1);

      const result = generateIdeaResponseSchema.parse(parseJson(response.body));
      expect(result.candidates).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it("returns 500 with generation_failed when the generate step throws", async () => {
    const generateCandidates = vi.fn(async (_input: GenerateIdeaRequest) => {
      throw new Error("generate step failed");
    });
    const app = buildServer({ generateCandidates });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ideas/generate",
        payload: formatBody,
      });

      expect(response.statusCode).toBe(500);
      expect(generateCandidates).toHaveBeenCalledTimes(1);

      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error.code).toBe("generation_failed");
      expect(error.status).toBe(500);
    } finally {
      await app.close();
    }
  });
});
