import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GenerateReplyVariantsRequest,
  RecordGeneratedReplyRequest,
} from "@x-builder/shared";

import { buildServer } from "../server.js";

const replyContext = {
  source: "same_dialog_dom" as const,
  targetAuthorHandle: "alice",
  targetText: "The boring version is usually the one people can ship.",
  targetStatusId: "1800000000000000001",
  leadingTargetHandle: { handle: "alice", state: "present" as const },
};

const generatedAt = "2026-07-01T12:00:00.000Z";

const apps: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("reply assistant routes", () => {
  it("POST /replies/variants/generate validates, enriches, and returns unscored variants", async () => {
    const generateReplyVariants = vi.fn(async (request: GenerateReplyVariantsRequest) => {
      expect(request).toMatchObject({
        replyContext: {
          targetAuthorHandle: "alice",
          replyThreadContext: {
            currentTarget: { statusId: "1800000000000000001" },
          },
        },
        currentAuthoredBody: "current body",
      });

      return {
        variants: [
          { id: "a", body: "First reply", groundingNotes: [], warnings: [] },
          { id: "b", body: "Second reply", groundingNotes: [], warnings: [] },
          { id: "c", body: "Third reply", groundingNotes: [], warnings: [] },
        ],
      };
    });
    const app = buildServer({ generateReplyVariants });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/replies/variants/generate",
      payload: { replyContext, currentAuthoredBody: "current body" },
    });

    expect(response.statusCode).toBe(200);
    expect(generateReplyVariants).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({
      variants: [
        { id: "a", body: "First reply", groundingNotes: [], warnings: [] },
        { id: "b", body: "Second reply", groundingNotes: [], warnings: [] },
        { id: "c", body: "Third reply", groundingNotes: [], warnings: [] },
      ],
    });
  });

  it("rejects stale currentBody on reply variant generation requests", async () => {
    const generateReplyVariants = vi.fn();
    const app = buildServer({ generateReplyVariants });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/replies/variants/generate",
      payload: { replyContext, currentBody: "stale field" },
    });

    expect(response.statusCode).toBe(400);
    expect(generateReplyVariants).not.toHaveBeenCalled();
  });

  it("POST /generated-replies/record records the generated body and written text", async () => {
    const recordGeneratedReply = vi.fn(async (request: RecordGeneratedReplyRequest) => ({
      duplicate: false,
      record: {
        id: "generated-reply-1",
        clientEventId: request.clientEventId,
        bodyText: request.bodyText,
        writtenText: request.writtenText,
        bodyTextHash: "sha256:rva-generated-reply:v1:body",
        writtenTextHash: "sha256:rva-generated-reply:v1:written",
        targetStatusId: request.targetStatusId,
        chosenVariantId: request.chosenVariantId,
        replyMove: request.replyMove,
        generatedAt: request.generatedAt ?? generatedAt,
        recordedAt: "2026-07-01T12:00:01.000Z",
      },
    }));
    const app = buildServer({ recordGeneratedReply });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/generated-replies/record",
      payload: {
        clientEventId: "event-1",
        bodyText: "Generated body",
        writtenText: "@alice Generated body",
        targetStatusId: "1800000000000000001",
        chosenVariantId: "a",
        replyMove: "answer",
        generatedAt,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(recordGeneratedReply).toHaveBeenCalledTimes(1);
    expect(response.json()).toMatchObject({
      duplicate: false,
      record: {
        clientEventId: "event-1",
        bodyText: "Generated body",
        writtenText: "@alice Generated body",
      },
    });
  });
});
