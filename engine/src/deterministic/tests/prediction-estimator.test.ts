import { describe, expect, it } from "vitest";

import { estimateEngagementRange } from "../prediction-estimator";
import { bannedClaimPattern } from "./test-helpers";

describe("prediction-estimator", () => {
  it("keeps engagement prediction math stable", () => {
    const prediction = estimateEngagementRange({
      text: "Clear writing compounds when the point is specific.",
      score: 66,
      format: "insight_share",
      followers: 1000,
    });

    expect(prediction).toEqual({
      rangeLow: 160,
      rangeHigh: 372,
      midpoint: 266,
      confidence: "medium",
      signals: [
        {
          signal_key: "quality_voice",
          label: "Static score 66 (-30%)",
          multiplier: 0.7,
        },
        {
          signal_key: "format_insight_share",
          label: "Insight format -5%",
          multiplier: 0.95,
        },
      ],
    });
  });

  it("does not use an implicit follower fallback", () => {
    const prediction = estimateEngagementRange({
      text: "Clear writing compounds when the point is specific.",
      score: 66,
      format: "insight_share",
      followers: undefined,
    });

    expect(prediction).toBeNull();
  });

  it("documents timely wording math without live-trend copy claims", () => {
    const prediction = estimateEngagementRange({
      text: "AI onboarding gets easier when the first run has one clear success moment.",
      score: 66,
      format: "insight_share",
      followers: 1000,
    });

    const signal = prediction?.signals.find((item) => item.signal_key === "zeitgeist");

    expect(signal).toMatchObject({
      signal_key: "zeitgeist",
      multiplier: 1.4,
    });
    expect(signal?.label).not.toMatch(bannedClaimPattern);
  });
});
