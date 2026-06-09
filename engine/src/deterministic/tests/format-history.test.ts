import { describe, expect, it } from "vitest";

import {
  appendPostFormatHistory,
  buildFormatVarietyCheck,
  countRecentFormatStreak,
} from "../format-history";
import type { PostHistoryEntry } from "../types";

describe("format-history", () => {
  it("derives a variety check from recent post history", () => {
    const history: PostHistoryEntry[] = [
      { format: "insight_share", at: "2026-06-07T09:00:00.000Z" },
      { format: "insight_share", at: "2026-06-06T09:00:00.000Z" },
      { format: "hot_take", at: "2026-06-05T09:00:00.000Z" },
    ];
    const insightDraft =
      "Specificity creates trust when you show proof from launch week instead of asking people to believe your roadmap";

    expect(buildFormatVarietyCheck(insightDraft, [])).toEqual({
      id: "variety",
      label: "Format mix (insight share)",
      status: "pass",
    });
    expect(buildFormatVarietyCheck(insightDraft, history)).toEqual({
      id: "variety",
      label: "3 insight shares in a row - mix it up",
      status: "fail",
    });
    expect(countRecentFormatStreak(history, "insight_share")).toBe(2);
  });

  it("records bounded post history in newest-first order", () => {
    const history = Array.from({ length: 10 }, (_, index): PostHistoryEntry => ({
      format: index % 2 === 0 ? "story" : "hot_take",
      at: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
    }));
    const next = appendPostFormatHistory(
      history,
      {
        format: "genuine_question",
        kind: "published",
      },
      new Date("2026-06-07T12:00:00.000Z"),
    );

    expect(next).toHaveLength(10);
    expect(next[0]).toEqual({
      format: "genuine_question",
      kind: "published",
      at: "2026-06-07T12:00:00.000Z",
    });
    expect(next).not.toContain(history[9]);
  });
});
