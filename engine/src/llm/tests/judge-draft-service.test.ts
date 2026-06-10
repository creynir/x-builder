import { describe, expect, it, vi } from "vitest";
import type { JudgeVerdict } from "@x-builder/shared";

import { JudgeDraftService } from "../judge-draft-service";
import {
  StructuredLlmService,
  type StructuredLlmProviderResult,
  type StructuredLlmRequest,
} from "../structured-llm-service";

const verdict: JudgeVerdict = {
  rating: 8,
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
    // The structured-output contract must actually validate the verdict shape.
    expect(request.structuredOutput.parser(verdict)).toEqual(verdict);
    expect(() => request.structuredOutput.parser({ rating: 99 })).toThrow();
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
    // Mirrors the no-workspace-root path: createDefaultJudgeDraftService builds an
    // empty provider list, so the real StructuredLlmService resolves to
    // provider_unconfigured rather than throwing.
    const service = new JudgeDraftService(new StructuredLlmService({ providers: [] }));

    const outcome = await service.judge("draft");

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.retryable).toBe(false);
      expect(outcome.code).toBe("provider_unconfigured");
    }
  });
});

