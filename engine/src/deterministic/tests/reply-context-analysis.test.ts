import { describe, expect, it } from "vitest";
import type { ReplyComposerContext } from "@x-builder/shared";

import { analyzeDraftText } from "../analyzer";
import { DeterministicAnalysisService } from "../deterministic-analysis-service";

const replyContext: ReplyComposerContext = {
  source: "same_dialog_dom",
  targetAuthorHandle: "alice",
  targetDisplayName: "Alice Example",
  targetText: "Ship the boring version first. The clever version rarely survives contact.",
  targetStatusId: "1930000000000000001",
  targetUrl: "https://x.com/alice/status/1930000000000000001",
  leadingTargetHandle: {
    handle: "alice",
    state: "present",
  },
};

describe("DeterministicAnalysisService reply context handling", () => {
  it("strips a duplicate structural target handle before scoring reply text and emits a reply-only warning", () => {
    const capturedTexts: string[] = [];
    const service = new DeterministicAnalysisService({
      analyzePost: (text, options) => {
        capturedTexts.push(text);
        return analyzeDraftText(text, options);
      },
    });

    const response = service.analyzePosts({
      items: [
        {
          id: "reply-1",
          text: "@alice good point",
          replyContext,
        },
      ],
      scoringContext: {},
      presentation: {
        postCoachMode: "expanded",
      },
    });

    const item = response.items[0];
    expect(capturedTexts).toEqual(["good point"]);
    expect(item?.status).toBe("scored");
    if (item?.status !== "scored") throw new Error("Expected scored reply item.");
    expect(item.score.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reply.duplicate-leading-target-handle",
          status: "warn",
        }),
      ]),
    );
  });

  it("does not apply reply-only stripping or warnings without replyContext", () => {
    const capturedTexts: string[] = [];
    const service = new DeterministicAnalysisService({
      analyzePost: (text, options) => {
        capturedTexts.push(text);
        return analyzeDraftText(text, options);
      },
    });

    const response = service.analyzePosts({
      items: [
        {
          id: "post-1",
          text: "@alice good point",
        },
      ],
      scoringContext: {},
      presentation: {
        postCoachMode: "expanded",
      },
    });

    const item = response.items[0];
    expect(capturedTexts).toEqual(["@alice good point"]);
    expect(item?.status).toBe("scored");
    if (item?.status !== "scored") throw new Error("Expected scored post item.");
    expect(item.score.checks.some((check) => check.id === "reply.duplicate-leading-target-handle"))
      .toBe(false);
  });

  it("does not score a prefix-only reply body after removing the structural target handle", () => {
    const capturedTexts: string[] = [];
    const service = new DeterministicAnalysisService({
      analyzePost: (text, options) => {
        capturedTexts.push(text);
        return analyzeDraftText(text, options);
      },
    });

    const response = service.analyzePosts({
      items: [
        {
          id: "reply-empty",
          text: "@alice",
          replyContext,
        },
      ],
      scoringContext: {},
      presentation: {
        postCoachMode: "expanded",
      },
    });

    const item = response.items[0];
    expect(capturedTexts).toEqual([]);
    expect(item).toMatchObject({
      status: "score_failed",
      id: "reply-empty",
      text: "@alice",
      retryable: false,
    });
    if (item?.status !== "score_failed") throw new Error("Expected prefix-only reply to fail.");
    expect(item.message.toLowerCase()).toContain("reply body");
  });
});
