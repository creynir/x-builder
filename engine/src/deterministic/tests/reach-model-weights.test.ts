import { describe, expect, it } from "vitest";

import {
  escapeRangeHighCoeff,
  escapeRangeLowCoeff,
  externalLinkEscapeCap,
  externalLinkMidpointMultiplier,
  formatReachTable,
  repeatDecayBase,
  repeatDecayFloor,
  replyRateTable,
  stallRangeHighCoeff,
  stallRangeLowCoeff,
  wisdomStatusDivisor,
  wisdomStatusMax,
  wisdomStatusMin,
} from "../const/reach-model-weights";
import type { PostFormat } from "../types";

// Every member of the PostFormat union, enumerated independently of the source
// tables so a missing or extra key is caught at runtime as well as by typecheck.
const allFormats: readonly PostFormat[] = [
  "genuine_question",
  "hot_take",
  "audience_question",
  "story",
  "insight_share",
  "ab_choice",
  "connect",
  "other",
  "fill_blank_tribal",
  "cta_farm",
  "fantasy_question",
  "binary_choice",
  "nuanced_question",
  "recognition_roast",
  "wisdom_one_liner",
  "milestone",
];

// Members deleted in the classifier rebuild; they must never reappear in any map.
const deletedFormats = ["one_liner", "goal_share"] as const;

describe("formatReachTable", () => {
  const expected: Record<
    PostFormat,
    { p50Multiplier: number; escapeProbability: number }
  > = {
    fill_blank_tribal: { p50Multiplier: 3.0, escapeProbability: 0.3 },
    cta_farm: { p50Multiplier: 3.0, escapeProbability: 0.3 },
    fantasy_question: { p50Multiplier: 2.5, escapeProbability: 0.25 },
    binary_choice: { p50Multiplier: 2.0, escapeProbability: 0.2 },
    connect: { p50Multiplier: 1.8, escapeProbability: 0.15 },
    audience_question: { p50Multiplier: 1.6, escapeProbability: 0.15 },
    genuine_question: { p50Multiplier: 1.2, escapeProbability: 0.1 },
    recognition_roast: { p50Multiplier: 1.5, escapeProbability: 0.12 },
    hot_take: { p50Multiplier: 1.1, escapeProbability: 0.08 },
    milestone: { p50Multiplier: 1.0, escapeProbability: 0.05 },
    ab_choice: { p50Multiplier: 1.2, escapeProbability: 0.1 },
    story: { p50Multiplier: 0.8, escapeProbability: 0.04 },
    nuanced_question: { p50Multiplier: 0.5, escapeProbability: 0.03 },
    wisdom_one_liner: { p50Multiplier: 1.0, escapeProbability: 0.03 },
    insight_share: { p50Multiplier: 0.3, escapeProbability: 0.02 },
    other: { p50Multiplier: 1.0, escapeProbability: 0.05 },
  };

  it.each(allFormats)(
    "carries the exact p50 multiplier and escape probability for %s",
    (format) => {
      expect(formatReachTable[format]).toEqual(expected[format]);
    },
  );

  it("is exhaustive over PostFormat with no extra keys", () => {
    expect(Object.keys(formatReachTable).sort()).toEqual([...allFormats].sort());
  });

  it("does not contain the deleted one_liner or goal_share members", () => {
    for (const deleted of deletedFormats) {
      expect(formatReachTable).not.toHaveProperty(deleted);
    }
  });
});

describe("replyRateTable", () => {
  const expected: Record<PostFormat, number> = {
    cta_farm: 0.02,
    fill_blank_tribal: 0.015,
    binary_choice: 0.018,
    fantasy_question: 0.012,
    audience_question: 0.012,
    connect: 0.015,
    milestone: 0.02,
    genuine_question: 0.012,
    recognition_roast: 0.008,
    hot_take: 0.008,
    // everything else falls to the 0.005 floor
    other: 0.005,
    story: 0.005,
    nuanced_question: 0.005,
    ab_choice: 0.005,
    wisdom_one_liner: 0.005,
    insight_share: 0.005,
  };

  it.each(allFormats)("carries the exact reply rate for %s", (format) => {
    expect(replyRateTable[format]).toBe(expected[format]);
  });

  it("defaults all unlisted formats to 0.005", () => {
    for (const format of [
      "other",
      "story",
      "nuanced_question",
      "ab_choice",
      "wisdom_one_liner",
      "insight_share",
    ] as const) {
      expect(replyRateTable[format]).toBe(0.005);
    }
  });

  it("is exhaustive over PostFormat with no extra keys", () => {
    expect(Object.keys(replyRateTable).sort()).toEqual([...allFormats].sort());
  });

  it("does not contain the deleted one_liner or goal_share members", () => {
    for (const deleted of deletedFormats) {
      expect(replyRateTable).not.toHaveProperty(deleted);
    }
  });
});

describe("reach-model coefficients", () => {
  it.each([
    ["stallRangeLowCoeff", stallRangeLowCoeff, 0.3],
    ["stallRangeHighCoeff", stallRangeHighCoeff, 1.2],
    ["escapeRangeLowCoeff", escapeRangeLowCoeff, 3],
    ["escapeRangeHighCoeff", escapeRangeHighCoeff, 12],
    ["externalLinkMidpointMultiplier", externalLinkMidpointMultiplier, 0.2],
    ["externalLinkEscapeCap", externalLinkEscapeCap, 0.03],
    ["repeatDecayBase", repeatDecayBase, 0.55],
    ["repeatDecayFloor", repeatDecayFloor, 0.2],
    ["wisdomStatusDivisor", wisdomStatusDivisor, 20000],
    ["wisdomStatusMin", wisdomStatusMin, 0.3],
    ["wisdomStatusMax", wisdomStatusMax, 1.5],
  ])("%s equals %s", (_name, actual, value) => {
    expect(actual).toBe(value);
  });
});
