import { describe, expect, it } from "vitest";

import { deriveScoreLearnings } from "../learning-model";

describe("learning-model", () => {
  it("derives matched and fallback learning copy from draft shape", () => {
    expect(deriveScoreLearnings({
      trimmedText: "genuine question: why do handoffs fail?",
      wordCount: 6,
      lineCount: 1,
    })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relevance: "matched",
          text: expect.stringContaining("One-liners"),
        }),
        expect.objectContaining({
          relevance: "matched",
          text: expect.stringContaining("genuine question"),
        }),
      ]),
    );

    expect(deriveScoreLearnings({
      trimmedText: "Specific proof beats generic positioning",
      wordCount: 5,
      lineCount: 1,
    })).toHaveLength(1);
  });
});
