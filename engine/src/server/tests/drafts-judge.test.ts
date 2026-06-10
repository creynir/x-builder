import { describe, expect, it, vi } from "vitest";
import { apiErrorSchema, judgeDraftResponseSchema, type JudgeVerdict } from "@x-builder/shared";

import { buildServer } from "../server";

const parseJson = (payload: string): unknown => JSON.parse(payload);

const verdict: JudgeVerdict = {
  rating: 7,
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
        verdict: { ...verdict, rating: 99 },
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
