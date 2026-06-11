import { describe, expect, it, vi } from "vitest";
import { apiErrorSchema, judgeDraftResponseSchema, type JudgeVerdict } from "@x-builder/shared";

import { JudgeDraftService } from "../../llm/judge-draft-service";
import {
  StructuredLlmService,
  type LlmProvider,
  type NormalizedStructuredLlmRequest,
  type StructuredLlmProviderResult,
} from "../../llm/structured-llm-service";
import { buildServer } from "../server";

const generalizedJudgeFailedMessage = "The judge could not score this draft. Try again.";

const codexVerdictProvider = (): LlmProvider<JudgeVerdict> => ({
  id: "codex-cli",
  checkReadiness: () => ({
    state: "ready",
    label: "Codex CLI",
    retryable: false,
    checkedAt: "2026-06-10T12:00:00.000Z",
  }),
  generateStructured: <TOutput,>(
    request: NormalizedStructuredLlmRequest<TOutput>,
  ): StructuredLlmProviderResult<JudgeVerdict> => ({
    status: "success",
    provider: request.provider,
    requestId: "codex-req-1",
    output: request.structuredOutput.parser({
      confidence: "medium",
      scores: verdict.scores,
      headline: verdict.headline,
      strengths: verdict.strengths,
      improvements: verdict.improvements,
    }) as JudgeVerdict,
    durationMs: 7,
    completedAt: "2026-06-10T12:00:00.000Z",
  }),
});

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
  },
  headline: "Solid hook, weak closer.",
  strengths: ["Clear, concrete claim"],
  improvements: ["Cut the last sentence"],
};

const judgedOutcome = {
  status: "judged" as const,
  response: {
    status: "judged" as const,
    verdict,
    model: "codex-cli",
    judgedAt: "2026-06-10T12:00:00.000Z",
  },
};

describe("POST /drafts/judge", () => {
  it("returns a judged verdict for a valid draft", async () => {
    const judge = vi.fn(async () => judgedOutcome);
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft worth judging." },
      });

      expect(response.statusCode).toBe(200);
      expect(judge).toHaveBeenCalledWith("A draft worth judging.");

      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.verdict).toEqual(verdict);
      expect(body.model).toBe("codex-cli");
    } finally {
      await app.close();
    }
  });

  it("maps a provider failure to a retryable judge_failed error without leaking internals", async () => {
    const judge = vi.fn(async () => ({
      status: "failed" as const,
      retryable: true,
      code: "provider_unavailable",
      message: "codex unavailable: /Users/secret/path",
    }));
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "secret draft text" },
      });

      expect(response.statusCode).toBe(503);

      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({ code: "judge_failed", scope: "judge", retryable: true });
      expect(response.body).not.toContain("secret draft text");
      expect(response.body).not.toContain("/Users/secret/path");
      expect(response.body).not.toContain("stack");
    } finally {
      await app.close();
    }
  });

  it("maps a non-retryable failure to a 500 judge_failed error", async () => {
    const judge = vi.fn(async () => ({
      status: "failed" as const,
      retryable: false,
      code: "structured_output_invalid",
      message: "bad output",
    }));
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });

      expect(response.statusCode).toBe(500);
      expect(apiErrorSchema.parse(parseJson(response.body))).toMatchObject({
        code: "judge_failed",
        scope: "judge",
        retryable: false,
      });
    } finally {
      await app.close();
    }
  });

  it("maps a verdict that violates the response contract to a non-retryable internal_error", async () => {
    const judge = vi.fn(async () => ({
      status: "judged" as const,
      response: {
        status: "judged" as const,
        verdict: { ...verdict, scores: { ...verdict.scores, replies: 999 } },
        model: "codex-cli",
        judgedAt: "2026-06-10T12:00:00.000Z",
      },
    }));
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });

      expect(response.statusCode).toBe(500);
      expect(apiErrorSchema.parse(parseJson(response.body))).toMatchObject({
        code: "internal_error",
        retryable: false,
      });
    } finally {
      await app.close();
    }
  });

  it("generalizes the judge failure message across retryable and non-retryable failures", async () => {
    const retryableApp = buildServer({
      judgeDraftService: {
        judge: vi.fn(async () => ({
          status: "failed" as const,
          retryable: true,
          code: "provider_unavailable",
          message: "codex unavailable: /Users/secret/path",
        })),
      },
    });
    const nonRetryableApp = buildServer({
      judgeDraftService: {
        judge: vi.fn(async () => ({
          status: "failed" as const,
          retryable: false,
          code: "provider_unconfigured",
          message: "The requested LLM provider is not configured.",
        })),
      },
    });

    try {
      const retryableResponse = await retryableApp.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });
      const nonRetryableResponse = await nonRetryableApp.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "draft" },
      });

      expect(apiErrorSchema.parse(parseJson(retryableResponse.body)).message).toBe(
        generalizedJudgeFailedMessage,
      );
      expect(apiErrorSchema.parse(parseJson(nonRetryableResponse.body)).message).toBe(
        generalizedJudgeFailedMessage,
      );
    } finally {
      await retryableApp.close();
      await nonRetryableApp.close();
    }
  });

  it("returns non-retryable judge_failed when the resolved provider is not in the injected provider set", async () => {
    // Injection seam: a real judge service whose registered providers lack the
    // selected claude-cli id. Resolving claude-cli per call yields an internal
    // provider_unconfigured failure, surfaced as a generic non-retryable error.
    const judgeDraftService = new JudgeDraftService(
      new StructuredLlmService({ providers: [codexVerdictProvider()] }),
      () => "claude-cli",
    );
    const app = buildServer({ judgeDraftService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft selected for an unconfigured provider." },
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({
        code: "judge_failed",
        scope: "judge",
        retryable: false,
      });
      expect(error.message).toBe(generalizedJudgeFailedMessage);
    } finally {
      await app.close();
    }
  });

  it("judges successfully through the codex provider when claude-cli is the resolved selection but registered", async () => {
    // Sanity counterpart: when the resolved provider IS registered, the same
    // injected service path produces a judged verdict (no false unconfigured).
    const judgeDraftService = new JudgeDraftService(
      new StructuredLlmService({ providers: [codexVerdictProvider()] }),
      () => "codex-cli",
    );
    const app = buildServer({ judgeDraftService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "A draft for the registered provider." },
      });

      expect(response.statusCode).toBe(200);
      const body = judgeDraftResponseSchema.parse(parseJson(response.body));
      expect(body.model).toBe("codex-cli");
      expect(body.verdict.verdict).toBe(verdict.verdict);
    } finally {
      await app.close();
    }
  });

  it("rejects an empty draft with validation_failed and does not call the judge", async () => {
    const judge = vi.fn();
    const app = buildServer({ judgeDraftService: { judge } });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/drafts/judge",
        payload: { text: "   " },
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorSchema.parse(parseJson(response.body)).code).toBe("validation_failed");
      expect(judge).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
