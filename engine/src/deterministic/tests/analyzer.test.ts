import { describe, expect, it } from "vitest";

import { analyzeDraftText } from "../analyzer";

describe("analyzer", () => {
  it("composes format classification, voice scoring, and prediction", () => {
    const result = analyzeDraftText(
      "genuine question: why do agents fail at handoffs?",
      { followers: 1000 },
    );

    expect(result).toMatchObject({
      text: "genuine question: why do agents fail at handoffs?",
      format: "genuine_question",
      score: {
        engageability: {
          engageable: true,
        },
      },
      prediction: {
        confidence: expect.any(String),
      },
    });
    expect(result.score.checks.find((check) => check.id === "quality_hook")).toMatchObject({
      status: "pass",
    });
    expect(result.score.learnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relevance: "matched",
          text: expect.stringContaining("genuine question"),
        }),
      ]),
    );
  });

  it("does not compute engagement prediction without explicit followers", () => {
    const result = analyzeDraftText(
      "genuine question: why do deterministic scoring tools need explicit follower context?",
    );

    expect(result.prediction).toBeNull();
  });
});
