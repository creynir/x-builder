import { describe, expect, it } from "vitest";

import {
  computeReachModel,
  computeRepeatMultiplier,
  computeStatusMultiplier,
  staticQualityCompression,
} from "../prediction-estimator";
import {
  formatReachTable,
  replyRateTable,
} from "../const/reach-model-weights";
import { buildReachInput } from "./test-helpers";

// Two-regime reach model assembly. `computeReachModel` replaces the old
// `estimateEngagementRange`: it assembles a stall regime and an escape regime
// from the RMU-005 weight tables and multiplier helpers. The dependent fields
// are derived from the produced `baseImpressions` so the assertions stay exact
// regardless of how the follower-estimate base is scaled internally — the AC
// pins the *relationships* (escapeRange = [3·base, 12·base], mid = base · the
// multiplier product), not the absolute base.

const QUALITY_SCORE = 66; // staticQualityCompression -> 1.0
const STATIC_LOW_SCORE = 10; // staticQualityCompression -> 0.6

describe("computeReachModel", () => {
  it("derives a follower-estimate base when no trailing median is supplied", () => {
    const input = buildReachInput({
      followers: 5000,
      trailingMedianImpressions: undefined,
      format: "cta_farm",
      score: QUALITY_SCORE,
    });

    const prediction = computeReachModel(input);

    if (prediction === null) {
      throw new Error("Expected an available reach prediction.");
    }

    expect(prediction.baseSource).toBe("follower_estimate");
    expect(prediction.qualityBasis).toBe("static");
    expect(prediction.baseImpressions).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(prediction.baseImpressions)).toBe(true);

    const base = prediction.baseImpressions;
    // escapeRange = [round(3·base), round(12·base)]
    expect(prediction.escapeRange).toEqual({
      low: Math.round(3 * base),
      high: Math.round(12 * base),
    });

    // mid = base · formatMult · qualityMult · linkMult · repeatMult · statusMult
    // cta_farm formatMult = 3.0, quality(66) = 1.0, no link, no repeat, non-wisdom status = 1.
    const expectedMid = Math.max(1, base * 3.0 * 1.0);
    expect(prediction.predictedMidImpressions).toBe(Math.round(expectedMid));

    expect(prediction.stallRange.low).toBeLessThanOrEqual(prediction.stallRange.high);
    expect(prediction.escapeRange.low).toBeLessThanOrEqual(prediction.escapeRange.high);
  });

  it.each([
    // base = baseImpressionsPerThousandFollowers(400) · clamp(followers/1000, 0.2, 10)
    //      = clamp(0.4·followers, 80, 4000)
    [5000, 2000], // mid-range: followerScale 5 -> 400·5
    [100, 80], // clamp floor: followerScale 0.1 -> clamped to 0.2 -> 400·0.2
    [50000, 4000], // clamp cap: followerScale 50 -> clamped to 10 -> 400·10
  ])(
    "pins the follower-estimate base to its absolute value for %s followers",
    (followers, expectedBase) => {
      const prediction = computeReachModel(
        buildReachInput({
          followers,
          trailingMedianImpressions: undefined,
          format: "cta_farm",
          score: QUALITY_SCORE,
        }),
      );

      if (prediction === null) {
        throw new Error("Expected an available reach prediction.");
      }

      expect(prediction.baseSource).toBe("follower_estimate");
      expect(prediction.baseImpressions).toBe(expectedBase);
    },
  );

  it("uses the trailing median as the base when followers are absent", () => {
    const input = buildReachInput({
      followers: undefined,
      trailingMedianImpressions: 2000,
      format: "cta_farm",
      score: QUALITY_SCORE,
    });

    const prediction = computeReachModel(input);

    if (prediction === null) {
      throw new Error("Expected an available reach prediction from a trailing median.");
    }

    expect(prediction.baseSource).toBe("trailing_median");
    expect(prediction.baseImpressions).toBe(2000);
  });

  it("prefers the trailing median over followers when both are present", () => {
    const input = buildReachInput({
      followers: 5000,
      trailingMedianImpressions: 2000,
      format: "cta_farm",
      score: QUALITY_SCORE,
    });

    const prediction = computeReachModel(input);

    if (prediction === null) {
      throw new Error("Expected an available reach prediction.");
    }

    expect(prediction.baseSource).toBe("trailing_median");
    expect(prediction.baseImpressions).toBe(2000);
  });

  it("treats a trailing median of zero as a present value and floors the base to at least one", () => {
    const input = buildReachInput({
      followers: undefined,
      trailingMedianImpressions: 0,
      format: "cta_farm",
      score: QUALITY_SCORE,
    });

    const prediction = computeReachModel(input);

    if (prediction === null) {
      throw new Error("Expected an available reach prediction from a zero trailing median.");
    }

    expect(prediction.baseSource).toBe("trailing_median");
    expect(prediction.baseImpressions).toBe(1);
  });

  it("multiplies the midpoint by the external-link damp and caps escape probability separately", () => {
    const linked = buildReachInput({
      followers: 5000,
      trailingMedianImpressions: undefined,
      format: "cta_farm",
      score: QUALITY_SCORE,
      hasExternalLink: true,
    });
    const unlinked = buildReachInput({
      followers: 5000,
      trailingMedianImpressions: undefined,
      format: "cta_farm",
      score: QUALITY_SCORE,
      hasExternalLink: false,
    });

    const linkedPrediction = computeReachModel(linked);
    const unlinkedPrediction = computeReachModel(unlinked);

    if (linkedPrediction === null || unlinkedPrediction === null) {
      throw new Error("Expected available reach predictions for both link states.");
    }

    // Same base; midpoint is damped by the 0.2 external-link multiplier.
    expect(linkedPrediction.baseImpressions).toBe(unlinkedPrediction.baseImpressions);
    const base = linkedPrediction.baseImpressions;
    expect(linkedPrediction.predictedMidImpressions).toBe(Math.round(Math.max(1, base * 3.0 * 1.0 * 0.2)));
    expect(unlinkedPrediction.predictedMidImpressions).toBe(Math.round(Math.max(1, base * 3.0 * 1.0)));

    // The escape probability is independently capped at 0.03 by the external link.
    expect(linkedPrediction.escapeProbability).toBeLessThanOrEqual(0.03);
    // cta_farm's table escape probability is 0.3, so an unlinked draft is far above the cap.
    expect(unlinkedPrediction.escapeProbability).toBe(formatReachTable.cta_farm.escapeProbability);
    expect(unlinkedPrediction.escapeProbability).toBeGreaterThan(0.03);
  });

  it("halves the escape probability for a nuanced question relative to its table value", () => {
    const input = buildReachInput({
      followers: 5000,
      trailingMedianImpressions: undefined,
      format: "nuanced_question",
      score: QUALITY_SCORE,
      hasExternalLink: false,
    });

    const prediction = computeReachModel(input);

    if (prediction === null) {
      throw new Error("Expected an available reach prediction.");
    }

    expect(prediction.escapeProbability).toBeCloseTo(
      formatReachTable.nuanced_question.escapeProbability * 0.5,
      10,
    );
  });

  it("emits expected replies from the static reply rate for the format", () => {
    const input = buildReachInput({
      followers: 5000,
      trailingMedianImpressions: undefined,
      format: "cta_farm",
      score: QUALITY_SCORE,
      hasExternalLink: false,
    });

    const prediction = computeReachModel(input);

    if (prediction === null) {
      throw new Error("Expected an available reach prediction.");
    }

    expect(prediction.expectedReplies).toBeCloseTo(
      prediction.predictedMidImpressions === 0
        ? 0
        : prediction.baseImpressions * 3.0 * 1.0 * replyRateTable.cta_farm,
      6,
    );
  });

  it("keeps a worst-case low-multiplier prediction ordered and honest, never clamping the midpoint up", () => {
    // insight_share (0.3) × static-low quality (0.6) × repeat (count>=10 -> 0.2)
    // × external link (0.2) -> product 0.3·0.6·0.2·0.2 = 0.0072 of base. With a
    // base in the hundreds this product drives mid far below 0.3·base, which a
    // naive [0.3·base, 1.2·mid] would invert.
    const input = buildReachInput({
      followers: 5000,
      trailingMedianImpressions: undefined,
      format: "insight_share",
      score: STATIC_LOW_SCORE,
      hasExternalLink: true,
      repeatHistory: [
        { format: "insight_share", lastPostedAt: "2026-06-13T10:00:00.000Z", countLast7d: 10 },
      ],
    });

    const prediction = computeReachModel(input);

    if (prediction === null) {
      throw new Error("Expected an available reach prediction for the worst-case draft.");
    }

    const base = prediction.baseImpressions;
    const product = 0.3 * 0.6 * 0.2 * 0.2; // formatMult · qualityMult · repeatMult · linkMult
    const expectedMid = Math.max(1, base * product);

    // Honest midpoint: round(mid), NOT clamped up to 0.3·base.
    expect(prediction.predictedMidImpressions).toBe(Math.round(expectedMid));
    expect(prediction.predictedMidImpressions).toBeLessThan(Math.round(0.3 * base));

    // Both ranges remain ordered even though mid << 0.3·base.
    expect(prediction.stallRange.low).toBeLessThanOrEqual(prediction.stallRange.high);
    expect(prediction.escapeRange.low).toBeLessThanOrEqual(prediction.escapeRange.high);
    // stallRange = [round(min(0.3·base, mid)), round(max(0.3·base, 1.2·mid))]
    expect(prediction.stallRange).toEqual({
      low: Math.round(Math.min(0.3 * base, expectedMid)),
      high: Math.round(Math.max(0.3 * base, 1.2 * expectedMid)),
    });
  });

  it("disables the prediction when both followers and a trailing median are absent", () => {
    const input = buildReachInput({
      followers: undefined,
      trailingMedianImpressions: undefined,
      format: "cta_farm",
      score: QUALITY_SCORE,
    });

    expect(computeReachModel(input)).toBeNull();
  });

  it("orders both regimes by construction across every format and multiplier product", () => {
    const formats = Object.keys(formatReachTable) as Array<keyof typeof formatReachTable>;

    for (const format of formats) {
      for (const score of [10, 50, 66, 92]) {
        for (const hasExternalLink of [false, true]) {
          const prediction = computeReachModel(
            buildReachInput({
              followers: 5000,
              trailingMedianImpressions: undefined,
              format,
              score,
              hasExternalLink,
              repeatHistory: [
                { format, lastPostedAt: "2026-06-13T10:00:00.000Z", countLast7d: 10 },
              ],
            }),
          );

          if (prediction === null) {
            throw new Error(`Expected an available prediction for ${format}/${score}.`);
          }

          expect(prediction.stallRange.low).toBeLessThanOrEqual(prediction.stallRange.high);
          expect(prediction.escapeRange.low).toBeLessThanOrEqual(prediction.escapeRange.high);
        }
      }
    }
  });
});

describe("staticQualityCompression", () => {
  it.each([
    [92, 1.3],
    [90, 1.3],
    [70, 1.1],
    [50, 1.0],
    [25, 0.8],
    [24, 0.6],
    [10, 0.6],
  ])("maps a static score of %s to the compression factor %s", (score, factor) => {
    expect(staticQualityCompression(score)).toBe(factor);
  });
});

describe("computeRepeatMultiplier", () => {
  it("decays a matching format by the repeat base raised to its recent count", () => {
    const input = buildReachInput({
      format: "hot_take",
      repeatHistory: [
        { format: "hot_take", lastPostedAt: "2026-06-13T10:00:00.000Z", countLast7d: 2 },
      ],
    });

    expect(computeRepeatMultiplier(input.repeatHistory, input.format)).toBeCloseTo(0.3025, 6);
  });

  it("floors the decay at the repeat floor for a heavily repeated format", () => {
    const input = buildReachInput({
      format: "hot_take",
      repeatHistory: [
        { format: "hot_take", lastPostedAt: "2026-06-13T10:00:00.000Z", countLast7d: 10 },
      ],
    });

    expect(computeRepeatMultiplier(input.repeatHistory, input.format)).toBe(0.2);
  });

  it("returns 1 when no history entry matches the current format", () => {
    const input = buildReachInput({
      format: "hot_take",
      repeatHistory: [
        { format: "story", lastPostedAt: "2026-06-13T10:00:00.000Z", countLast7d: 5 },
      ],
    });

    expect(computeRepeatMultiplier(input.repeatHistory, input.format)).toBe(1);
  });

  it("returns 1 when the repeat history is empty", () => {
    const input = buildReachInput({ format: "hot_take", repeatHistory: [] });

    expect(computeRepeatMultiplier(input.repeatHistory, input.format)).toBe(1);
  });
});

describe("computeStatusMultiplier", () => {
  it("floors a low-follower wisdom_one_liner at the status minimum", () => {
    expect(computeStatusMultiplier("wisdom_one_liner", 1400)).toBe(0.3);
  });

  it("returns the neutral status for a wisdom_one_liner at the divisor follower count", () => {
    expect(computeStatusMultiplier("wisdom_one_liner", 20000)).toBe(1.0);
  });

  it("caps a high-follower wisdom_one_liner at the status maximum", () => {
    expect(computeStatusMultiplier("wisdom_one_liner", 58000)).toBe(1.5);
  });

  it("returns 1 for a non-wisdom format regardless of follower count", () => {
    expect(computeStatusMultiplier("hot_take", 1400)).toBe(1);
    expect(computeStatusMultiplier("hot_take", 58000)).toBe(1);
  });

  it("falls back to 1 for a wisdom_one_liner with undefined followers", () => {
    expect(computeStatusMultiplier("wisdom_one_liner", undefined)).toBe(1);
  });
});
