import { describe, expect, it } from "vitest";

import {
  containsWord,
  countRawLines,
  countWords,
  getNonEmptyLines,
} from "../text-metrics";

describe("text-metrics", () => {
  it("counts words, visible lines, raw lines, and whole-word matches", () => {
    const text = "AI tools ship faster\n\nwhen teams write smaller specs";

    expect(countWords(text)).toBe(9);
    expect(getNonEmptyLines(text)).toEqual([
      "AI tools ship faster",
      "when teams write smaller specs",
    ]);
    expect(countRawLines(text)).toBe(3);
    expect(containsWord(text, "ship")).toBe(true);
    expect(containsWord(text, "hips")).toBe(false);
  });
});
