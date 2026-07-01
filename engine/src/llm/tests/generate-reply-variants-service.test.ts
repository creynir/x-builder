import { describe, expect, it, vi } from "vitest";

import { GenerateReplyVariantsService } from "../generate-reply-variants-service.js";
import type { StructuredLlmRequest } from "../structured-llm-service.js";

const replyContext = {
  source: "same_dialog_dom" as const,
  targetAuthorHandle: "alice",
  targetText: "The boring version is usually the one people can ship.",
  leadingTargetHandle: { handle: "alice", state: "present" as const },
};

const success = {
  variants: [
    { id: "direct", body: "@alice Agree, but only if the boring path is actually shippable." },
    { id: "ask", body: "What made the boring version easier to trust?" },
    { id: "reframe", body: "The boring version usually wins because it leaves fewer hiding places." },
  ],
};

const makeLlm = (raw = success) => {
  const generateStructured = vi.fn(async (request: StructuredLlmRequest<unknown>) => ({
    status: "success" as const,
    provider: "codex-cli",
    requestId: "req-1",
    output: request.structuredOutput.parser(raw),
    durationMs: 1,
    completedAt: "2026-07-01T12:00:00.000Z",
  }));

  return { generateStructured, llm: { generateStructured } as never };
};

describe("GenerateReplyVariantsService", () => {
  it("generates 3-4 unscored reply variants and strips the structural target handle", async () => {
    const { generateStructured, llm } = makeLlm();
    const service = new GenerateReplyVariantsService(llm, "codex-cli");

    const result = await service.generate({
      replyContext,
      currentAuthoredBody: "current user draft",
    });

    expect(result.variants).toHaveLength(3);
    expect(result.variants[0]).toMatchObject({
      id: "direct",
      body: "Agree, but only if the boring path is actually shippable.",
    });
    expect(result.variants[0]).not.toHaveProperty("verdict");
    expect(result.variants[0]).not.toHaveProperty("approved");

    const request = generateStructured.mock.calls[0]?.[0];
    expect(request?.purpose).toBe("reply_variants");
    expect(request?.instructions).toContain("Do not score, rank, approve, judge");
    expect(request?.instructions).toContain("Do not invent missing thread context");
    expect(request?.instructions).toContain("current user draft");
  });

  it("rejects off-contract variant counts through the structured parser", async () => {
    const { llm } = makeLlm({
      variants: [
        { id: "a", body: "one" },
        { id: "b", body: "two" },
      ],
    });
    const service = new GenerateReplyVariantsService(llm, "codex-cli");

    await expect(service.generate({ replyContext })).rejects.toThrow();
  });
});
