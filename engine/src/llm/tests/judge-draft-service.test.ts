import { describe, expect, it, vi } from "vitest";
import type { JudgeVerdict } from "@x-builder/shared";

import { JudgeDraftService } from "../judge-draft-service";
import {
  StructuredLlmService,
  type StructuredLlmProviderResult,
  type StructuredLlmRequest,
} from "../structured-llm-service";

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

const verdict: JudgeVerdict = {
  verdict: "slight_rework",
  confidence: "medium",
  scores,
  headline: "Strong, specific, reply-friendly.",
  strengths: ["Concrete claim up front"],
  improvements: ["Trim the middle paragraph"],
};

const successResult: StructuredLlmProviderResult<JudgeVerdict> = {
  status: "success",
  provider: "codex-cli",
  requestId: "req-1",
  output: verdict,
  durationMs: 12,
  completedAt: "2026-06-10T12:00:00.000Z",
};

const failure = (
  code: string,
  retryable: boolean,
): StructuredLlmProviderResult<JudgeVerdict> => ({
  status: "failed",
  provider: "codex-cli",
  requestId: "req-x",
  code,
  message: "codex unavailable: /Users/secret/path",
  retryable,
  durationMs: 5,
  completedAt: "2026-06-10T12:00:00.000Z",
});

describe("JudgeDraftService", () => {
  it("builds a candidate_judge request and maps a success result to a judged response", async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredLlmRequest<JudgeVerdict>) => successResult,
    );
    const service = new JudgeDraftService({ generateStructured });

    const outcome = await service.judge("My draft worth judging.");

    expect(outcome).toEqual({
      status: "judged",
      response: {
        status: "judged",
        verdict,
        model: "codex-cli",
        judgedAt: "2026-06-10T12:00:00.000Z",
      },
    });

    const request = generateStructured.mock.calls[0]![0];
    expect(request.provider).toBe("codex-cli");
    expect(request.purpose).toBe("candidate_judge");
    expect(request.turns.find((turn) => turn.role === "user")?.content).toContain(
      "My draft worth judging.",
    );
  });

  it("derives the verdict band from overall in the structured-output parser", async () => {
    // The parser receives the model output (no verdict field) and derives the
    // verdict from scores.overall, so the verdict can never disagree with the score.
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });

    await service.judge("draft");

    const parse = captured[0]!.structuredOutput.parser;
    const modelOutput = {
      confidence: "medium",
      scores: { ...scores, overall: 90 },
      headline: "Strong.",
      strengths: ["clear"],
      improvements: ["trim"],
    };

    expect(parse(modelOutput).verdict).toBe("post_now");
    expect(parse({ ...modelOutput, scores: { ...scores, overall: 78 } }).verdict).toBe("slight_rework");
    expect(parse({ ...modelOutput, scores: { ...scores, overall: 55 } }).verdict).toBe("major_rework");
    expect(parse({ ...modelOutput, scores: { ...scores, overall: 30 } }).verdict).toBe("do_not_post");
    // A model-supplied verdict must be ignored; the derived band wins.
    expect(
      parse({ ...modelOutput, verdict: "post_now", scores: { ...scores, overall: 30 } }).verdict,
    ).toBe("do_not_post");
    expect(() => parse({ ...modelOutput, scores: { ...scores, replies: 999 } })).toThrow();
  });

  it("maps a retryable provider failure to a failed outcome", async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredLlmRequest<JudgeVerdict>) => failure("provider_unavailable", true),
    );
    const service = new JudgeDraftService({ generateStructured });

    const outcome = await service.judge("draft");

    expect(outcome).toEqual({
      status: "failed",
      retryable: true,
      code: "provider_unavailable",
      message: "codex unavailable: /Users/secret/path",
    });
  });

  it("preserves a non-retryable failure such as structured_output_invalid", async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredLlmRequest<JudgeVerdict>) =>
        failure("structured_output_invalid", false),
    );
    const service = new JudgeDraftService({ generateStructured });

    const outcome = await service.judge("draft");

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.retryable).toBe(false);
      expect(outcome.code).toBe("structured_output_invalid");
    }
  });

  it("returns a non-retryable provider_unconfigured failure when no provider is registered", async () => {
    const service = new JudgeDraftService(new StructuredLlmService({ providers: [] }));

    const outcome = await service.judge("draft");

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.retryable).toBe(false);
      expect(outcome.code).toBe("provider_unconfigured");
    }
  });

  it("resolves the provider id from a resolver function per call", async () => {
    const generateStructured = vi.fn(
      async (request: StructuredLlmRequest<JudgeVerdict>) => ({
        ...successResult,
        provider: request.provider,
      }),
    );
    const resolveProvider = vi.fn(() => "claude-cli");
    const service = new JudgeDraftService({ generateStructured }, resolveProvider);

    const outcome = await service.judge("My draft worth judging.");

    expect(resolveProvider).toHaveBeenCalledOnce();
    expect(generateStructured.mock.calls[0]![0].provider).toBe("claude-cli");
    expect(outcome).toMatchObject({
      status: "judged",
      response: { model: "claude-cli" },
    });
  });

  it("re-runs an async resolver function on every judge call (no caching)", async () => {
    const generateStructured = vi.fn(
      async (request: StructuredLlmRequest<JudgeVerdict>) => ({
        ...successResult,
        provider: request.provider,
      }),
    );
    const providers = ["codex-cli", "cursor-cli"];
    const resolveProvider = vi.fn(async () => providers.shift() ?? "codex-cli");
    const service = new JudgeDraftService({ generateStructured }, resolveProvider);

    await service.judge("first draft");
    await service.judge("second draft");

    expect(resolveProvider).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[0]![0].provider).toBe("codex-cli");
    expect(generateStructured.mock.calls[1]![0].provider).toBe("cursor-cli");
  });
});
