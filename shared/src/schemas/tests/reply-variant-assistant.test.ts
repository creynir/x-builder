import { describe, expect, it } from "vitest";
import {
  generateReplyVariantsRequestSchema,
  generateReplyVariantsResponseSchema,
  recordGeneratedReplyRequestSchema,
  recordGeneratedReplyResponseSchema,
} from "../reply-variant-assistant.js";

const replyContext = {
  source: "same_dialog_dom",
  targetAuthorHandle: "alice",
  targetText: "The boring version is usually the one people can ship.",
  targetStatusId: "1234567890",
  leadingTargetHandle: { handle: "alice", state: "present" },
} as const;

function variant(id: string, body = `Reply body ${id}`) {
  return {
    id,
    body,
    replyMove: "answer",
    groundingNotes: ["Uses only observed parent context."],
    warnings: [],
  };
}

describe("reply variant assistant schemas", () => {
  it("accepts a reply generation request with currentAuthoredBody", () => {
    const result = generateReplyVariantsRequestSchema.parse({
      replyContext,
      currentAuthoredBody: "current draft body",
    });

    expect(result.currentAuthoredBody).toBe("current draft body");
  });

  it("rejects stale currentBody and post-generation fields on requests", () => {
    expect(() =>
      generateReplyVariantsRequestSchema.parse({
        replyContext,
        currentBody: "wrong field",
      }),
    ).toThrow();

    expect(() =>
      generateReplyVariantsRequestSchema.parse({
        replyContext,
        format: "hot_take",
        category: "debate",
      }),
    ).toThrow();
  });

  it("accepts 3 or 4 unscored reply variants", () => {
    expect(
      generateReplyVariantsResponseSchema.parse({
        variants: [variant("a"), variant("b"), variant("c")],
      }).variants,
    ).toHaveLength(3);

    expect(
      generateReplyVariantsResponseSchema.parse({
        variants: [variant("a"), variant("b"), variant("c"), variant("d")],
      }).variants,
    ).toHaveLength(4);
  });

  it("rejects too few, too many, scored, judged, or post-shaped variants", () => {
    expect(() =>
      generateReplyVariantsResponseSchema.parse({
        variants: [variant("a"), variant("b")],
      }),
    ).toThrow();
    expect(() =>
      generateReplyVariantsResponseSchema.parse({
        variants: [variant("a"), variant("b"), variant("c"), variant("d"), variant("e")],
      }),
    ).toThrow();

    for (const forbidden of [
      { verdict: { label: "ship", scores: { overall: 90 } } },
      { approved: true },
      { reach: 10_000 },
      { postCoach: { status: "ready" } },
      { format: "hot_take" },
      { category: "debate" },
      { applySuggestions: [] },
    ]) {
      expect(() =>
        generateReplyVariantsResponseSchema.parse({
          variants: [variant("a"), { ...variant("b"), ...forbidden }, variant("c")],
        }),
      ).toThrow();
    }
  });

  it("accepts generated reply ledger requests and responses", () => {
    const request = recordGeneratedReplyRequestSchema.parse({
      clientEventId: "event-1",
      bodyText: "Generated body",
      writtenText: "@alice Generated body",
      targetStatusId: "1234567890",
      chosenVariantId: "a",
      replyMove: "answer",
      generatedAt: "2026-07-01T12:00:00.000Z",
    });
    expect(request.bodyText).toBe("Generated body");

    const response = recordGeneratedReplyResponseSchema.parse({
      duplicate: false,
      record: {
        id: "generated-reply-1",
        clientEventId: "event-1",
        bodyText: "Generated body",
        writtenText: "@alice Generated body",
        bodyTextHash: "sha256:rva-generated-reply:v1:body",
        writtenTextHash: "sha256:rva-generated-reply:v1:written",
        targetStatusId: "1234567890",
        chosenVariantId: "a",
        replyMove: "answer",
        generatedAt: "2026-07-01T12:00:00.000Z",
        recordedAt: "2026-07-01T12:00:01.000Z",
      },
    });
    expect(response.duplicate).toBe(false);
  });
});
