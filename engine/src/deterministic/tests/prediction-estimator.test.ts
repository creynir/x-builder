import { describe, expect, it } from "vitest";

import {
  computeReachModel,
  computeRepeatMultiplier,
  computeStatusMultiplier,
  staticQualityCompression,
  toJudgedQualityMultiplier,
} from "../prediction-estimator";
import {
  accountAgeMultiplierFloor,
  accountAgeMultiplierMax,
  formatReachTable,
  mediaAttachmentMultiplier,
  postingHourMultipliers,
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

function requirePrediction(
  input: Parameters<typeof computeReachModel>[0],
): NonNullable<ReturnType<typeof computeReachModel>> {
  const prediction = computeReachModel(input);

  if (prediction === null) {
    throw new Error("Expected an available reach prediction.");
  }

  return prediction;
}

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

  it("uses story-like weights for founder_story without adding amplifier-shaped output", () => {
    const storyPrediction = requirePrediction(
      buildReachInput({
        followers: 5000,
        format: "story",
        score: QUALITY_SCORE,
      }),
    );
    const founderStoryPrediction = requirePrediction(
      buildReachInput({
        followers: 5000,
        format: "founder_story",
        score: QUALITY_SCORE,
      }),
    );
    const output = founderStoryPrediction as unknown as Record<string, unknown>;

    expect(founderStoryPrediction.predictedMidImpressions).toBe(
      storyPrediction.predictedMidImpressions,
    );
    expect(founderStoryPrediction.escapeProbability).toBe(
      storyPrediction.escapeProbability,
    );
    expect(founderStoryPrediction.expectedReplies).toBe(
      storyPrediction.expectedReplies,
    );
    expect(output).not.toHaveProperty("amplifierType");
    expect(output).not.toHaveProperty("amplifier");
    expect(
      founderStoryPrediction.signals.some((signal) =>
        signal.signal_key.startsWith("founder_story_"),
      ),
    ).toBe(false);
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

describe("computeReachModel advanced-context multipliers", () => {
  it("applies the planned posting-hour multiplier to the midpoint", () => {
    const baseline = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        plannedHourUtc: undefined,
      }),
    );
    const planned = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        plannedHourUtc: 14,
      }),
    );

    expect(postingHourMultipliers[14]).not.toBe(1);
    expect(planned.predictedMidImpressions).toBe(
      Math.round(baseline.predictedMidImpressions * postingHourMultipliers[14]),
    );
    expect(planned.expectedReplies).toBeGreaterThan(baseline.expectedReplies);
  });

  it("applies the media attachment multiplier to the midpoint", () => {
    const baseline = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        willAttachMedia: false,
      }),
    );
    const withMedia = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        willAttachMedia: true,
      }),
    );

    expect(mediaAttachmentMultiplier).toBeGreaterThan(1);
    expect(withMedia.predictedMidImpressions).toBe(
      Math.round(baseline.predictedMidImpressions * mediaAttachmentMultiplier),
    );
    expect(withMedia.expectedReplies).toBeGreaterThan(baseline.expectedReplies);
  });

  it("applies a bounded account-age maturity multiplier to the midpoint", () => {
    const baseline = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        accountAgeYears: undefined,
      }),
    );
    const newAccount = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        accountAgeYears: 0,
      }),
    );
    const matureAccount = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        accountAgeYears: 12,
      }),
    );

    expect(newAccount.predictedMidImpressions).toBe(
      Math.round(baseline.predictedMidImpressions * accountAgeMultiplierFloor),
    );
    expect(matureAccount.predictedMidImpressions).toBe(
      Math.round(baseline.predictedMidImpressions * accountAgeMultiplierMax),
    );
    expect(newAccount.predictedMidImpressions).toBeLessThan(baseline.predictedMidImpressions);
    expect(matureAccount.predictedMidImpressions).toBeGreaterThan(baseline.predictedMidImpressions);
  });

  it("keeps the composed placeholder multiplier inside a bounded band", () => {
    const neutral = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const low = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        plannedHourUtc: 3,
        willAttachMedia: false,
        accountAgeYears: 0,
      }),
    );
    const high = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        plannedHourUtc: 14,
        willAttachMedia: true,
        accountAgeYears: 20,
      }),
    );

    expect(low.predictedMidImpressions).toBeGreaterThanOrEqual(
      Math.round(neutral.predictedMidImpressions * 0.85),
    );
    expect(high.predictedMidImpressions).toBeLessThanOrEqual(
      Math.round(neutral.predictedMidImpressions * 1.25),
    );
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

// Reach-signal adjustments (trending lexicon, tribe vocative, answer-effort).
// These are pEscape / expectedReplies adjustments only: the load-bearing
// invariant for every case below is that `predictedMidImpressions` is identical
// to a baseline draft that differs solely by the trigger phrase. The shared
// inputs hold `score` and `format` fixed so the midpoint cannot drift through
// quality compression or a format reclassification.

const NEUTRAL_DRAFT = "Clear writing compounds when the point is specific.";

// cta_farm: escapeProbability 0.3 (not halved, well below any cap), replyRate
// 0.02. With followers 5000 the follower-estimate base is 2000.
function ctaFarmInput(text: string, overrides: Record<string, unknown> = {}) {
  return buildReachInput({
    text,
    followers: 5000,
    trailingMedianImpressions: undefined,
    format: "cta_farm",
    score: QUALITY_SCORE,
    hasExternalLink: false,
    repeatHistory: [],
    ...overrides,
  });
}

describe("tension signal removal", () => {
  it("emits no tension_contradiction signal for a draft containing 'but'", () => {
    const prediction = requirePrediction(
      ctaFarmInput("This shipped fast, but the docs lagged behind for weeks."),
    );

    const tensionSignal = prediction.signals.find(
      (signal) => signal.signal_key === "tension_contradiction",
    );

    expect(tensionSignal).toBeUndefined();
  });

  it("leaves the midpoint identical whether or not the draft contains 'but'", () => {
    const withTension = requirePrediction(
      ctaFarmInput("This shipped fast, but the docs lagged behind for weeks."),
    );
    const withoutTension = requirePrediction(
      ctaFarmInput("This shipped fast and the docs kept pace for weeks."),
    );

    expect(withTension.predictedMidImpressions).toBe(
      withoutTension.predictedMidImpressions,
    );
  });
});

describe("trending-topic lexicon escape bonus", () => {
  it("lifts pEscape by the per-match bonus for one trending term and leaves the midpoint unchanged", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const trending = requirePrediction(
      ctaFarmInput("Why did you reach for claude on that workflow?"),
    );

    // cta_farm base pEscape 0.3, one match -> 0.3 · (1 + 0.15) = 0.345.
    expect(trending.escapeProbability).toBeCloseTo(0.3 * (1 + 0.15), 10);
    expect(baseline.escapeProbability).toBeCloseTo(0.3, 10);

    // Midpoint unchanged: the trending bonus never touches the median regime.
    expect(trending.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });

  it("caps the pEscape bonus at +0.40 for three or more trending terms", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const trending = requirePrediction(
      ctaFarmInput("Comparing claude, codex, and gpt on the same task this week."),
    );

    // Three matches would be 3·0.15 = 0.45 uncapped; capped at +0.40 -> ×1.40.
    expect(trending.escapeProbability).toBeCloseTo(0.3 * 1.4, 10);
    expect(trending.escapeProbability).toBeLessThanOrEqual(1);

    expect(trending.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });
});

describe("tribe-vocative reply bonus", () => {
  it("adds +20% to expectedReplies for a tribe term while leaving pEscape and the midpoint unchanged", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const tribe = requirePrediction(
      ctaFarmInput("Every founder I know wrestles with the same first hire."),
    );

    // expectedReplies = mid · replyRate(cta_farm 0.02); the tribe term multiplies
    // that reply figure by 1.2 and nothing else.
    expect(tribe.expectedReplies).toBeCloseTo(baseline.expectedReplies * 1.2, 6);

    // pEscape and midpoint are untouched by the tribe vocative.
    expect(tribe.escapeProbability).toBeCloseTo(baseline.escapeProbability, 10);
    expect(tribe.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });
});

describe("answer-effort adjustments", () => {
  it("lifts pEscape ×1.4 and expectedReplies ×2.0 for an 'in 1 word' constraint, midpoint unchanged", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const constrained = requirePrediction(
      ctaFarmInput("Describe your last quarter in 1 word?"),
    );

    expect(constrained.escapeProbability).toBeCloseTo(baseline.escapeProbability * 1.4, 10);
    expect(constrained.expectedReplies).toBeCloseTo(baseline.expectedReplies * 2.0, 6);
    expect(constrained.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });

  it("recognises the spelled-out 'in one word' constraint", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const constrained = requirePrediction(
      ctaFarmInput("Describe your last quarter in one word?"),
    );

    expect(constrained.escapeProbability).toBeCloseTo(baseline.escapeProbability * 1.4, 10);
    expect(constrained.expectedReplies).toBeCloseTo(baseline.expectedReplies * 2.0, 6);
    expect(constrained.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });

  it("dampens pEscape ×0.7 for an anecdote/justification question, midpoint unchanged", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const anecdote = requirePrediction(
      ctaFarmInput("How did you build that, and why?"),
    );

    expect(anecdote.escapeProbability).toBeCloseTo(baseline.escapeProbability * 0.7, 10);
    expect(anecdote.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });

  it("dampens pEscape ×0.7 for self-disclosure of money specifics, midpoint unchanged", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const disclosure = requirePrediction(
      ctaFarmInput("I burned through $40,000 of savings last quarter."),
    );

    expect(disclosure.escapeProbability).toBeCloseTo(baseline.escapeProbability * 0.7, 10);
    expect(disclosure.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });
});

describe("reach-signal composition and clamps", () => {
  it("composes the 'in 1 word' lift and the anecdote penalty multiplicatively on pEscape, midpoint unchanged", () => {
    const baseline = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));
    const composed = requirePrediction(
      ctaFarmInput("How did you build that, and why? Answer in 1 word?"),
    );

    // 0.3 · 1.4 (in 1 word) · 0.7 (anecdote) = 0.294.
    expect(composed.escapeProbability).toBeCloseTo(0.3 * 1.4 * 0.7, 10);
    expect(composed.predictedMidImpressions).toBe(baseline.predictedMidImpressions);
  });

  it("applies the external-link 0.03 cap last so a trending term cannot lift pEscape past it", () => {
    const linkedTrending = requirePrediction(
      ctaFarmInput("Comparing claude, codex, and gpt on the same task this week.", {
        hasExternalLink: true,
      }),
    );

    // Even though three trending terms would push the uncapped value to 0.42,
    // the external-link cap is applied last and wins.
    expect(linkedTrending.escapeProbability).toBeLessThanOrEqual(0.03);
  });

  it("clamps the composed pEscape to at most 1", () => {
    const prediction = requirePrediction(
      ctaFarmInput("Comparing claude, codex, and gpt? Answer in 1 word?", {
        format: "fill_blank_tribal",
      }),
    );

    expect(prediction.escapeProbability).toBeLessThanOrEqual(1);
    expect(prediction.escapeProbability).toBeGreaterThanOrEqual(0);
  });
});

// The judge→reach bridge maps a judged 0..100 impressions score into a
// continuous quality multiplier: clamp(0.5 · (2.5/0.5)^(impressions/100), 0.5, 2.5).
describe("toJudgedQualityMultiplier", () => {
  it("maps a top judged impressions score of 100 to the multiplier ceiling 2.5", () => {
    expect(toJudgedQualityMultiplier(100)).toBeCloseTo(2.5, 10);
  });

  it("maps a judged impressions score of 0 to the multiplier floor 0.5", () => {
    expect(toJudgedQualityMultiplier(0)).toBeCloseTo(0.5, 10);
  });

  it("maps a mid judged impressions score of 50 to the geometric midpoint ~1.118", () => {
    // 0.5 · 5^0.5 = 0.5 · 2.2360679... = 1.1180339...
    expect(toJudgedQualityMultiplier(50)).toBeCloseTo(1.118, 3);
  });

  it("is monotonic increasing across the 0..100 judged impressions range", () => {
    let previous = toJudgedQualityMultiplier(0);

    for (let impressions = 10; impressions <= 100; impressions += 10) {
      const current = toJudgedQualityMultiplier(impressions);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("never escapes the clamped [0.5, 2.5] band across the range", () => {
    for (let impressions = 0; impressions <= 100; impressions += 5) {
      const multiplier = toJudgedQualityMultiplier(impressions);
      expect(multiplier).toBeGreaterThanOrEqual(0.5);
      expect(multiplier).toBeLessThanOrEqual(2.5);
    }
  });
});

// Pass-2 of the two-pass contract: when judgeSignals ride the input,
// computeReachModel swaps the static quality slot for the judged multiplier and
// the format reply rate for the judged reply lerp, and stamps qualityBasis="judge".
// Other multipliers (format/link/repeat/status) and the tribe +20% are untouched.
describe("computeReachModel judge-signal branch", () => {
  // lerp(0.002, 0.025, t) = 0.002 + (0.025 - 0.002) · t
  const lerp = (low: number, high: number, t: number): number => low + (high - low) * t;

  it("uses the judged quality multiplier in the quality slot and stamps qualityBasis=judge", () => {
    // cta_farm formatMult 3.0; followers 5000 -> base 2000; no link/repeat/status.
    // judged impressions 100 -> quality 2.5, so mid = 2000 · 3.0 · 2.5 = 15000.
    const prediction = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        judgeSignals: { impressions: 100, replies: 80 },
      }),
    );

    expect(prediction.qualityBasis).toBe("judge");

    const base = prediction.baseImpressions;
    const expectedMid = Math.max(1, base * 3.0 * 2.5);
    expect(prediction.predictedMidImpressions).toBe(Math.round(expectedMid));
  });

  it("overrides expectedReplies with the judged reply lerp instead of the format reply rate", () => {
    // judged replies 80 -> lerp(0.002, 0.025, 0.8) = 0.0204; mid = base · 3.0 · 2.5.
    const prediction = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        judgeSignals: { impressions: 100, replies: 80 },
      }),
    );

    const mid = prediction.baseImpressions * 3.0 * 2.5;
    expect(prediction.expectedReplies).toBeCloseTo(mid * lerp(0.002, 0.025, 0.8), 6);
    // The format reply-rate path (cta_farm 0.02) must NOT be the source here.
    expect(prediction.expectedReplies).not.toBeCloseTo(mid * 0.02, 6);
  });

  it("still applies the tribe +20% reply bonus on top of the judged reply lerp", () => {
    const judgeSignals = { impressions: 100, replies: 80 };
    const tribe = requirePrediction(
      ctaFarmInput("Every founder I know wrestles with the same first hire.", {
        judgeSignals,
      }),
    );

    // Concrete judged value: mid = base · 3.0 · 2.5; replies = mid · lerp(0.002,
    // 0.025, 0.8) · 1.2 (tribe). Anchored to the judged lerp so a static-path
    // reply figure (mid · 0.02 · 1.2) cannot satisfy it.
    const mid = tribe.baseImpressions * 3.0 * 2.5;
    expect(tribe.expectedReplies).toBeCloseTo(mid * lerp(0.002, 0.025, 0.8) * 1.2, 6);
    expect(tribe.predictedMidImpressions).toBe(Math.round(Math.max(1, mid)));
  });

  it("still applies the external-link midpoint damp alongside the judged quality slot", () => {
    // The judged quality replaces only the quality slot; the 0.2 link damp still applies.
    const linked = requirePrediction(
      ctaFarmInput(NEUTRAL_DRAFT, {
        judgeSignals: { impressions: 100, replies: 80 },
        hasExternalLink: true,
      }),
    );

    const base = linked.baseImpressions;
    expect(linked.qualityBasis).toBe("judge");
    expect(linked.predictedMidImpressions).toBe(Math.round(Math.max(1, base * 3.0 * 2.5 * 0.2)));
  });

  it("keeps qualityBasis=static and the static reply rate when no judgeSignals are present", () => {
    const prediction = requirePrediction(ctaFarmInput(NEUTRAL_DRAFT));

    expect(prediction.qualityBasis).toBe("static");
    const mid = prediction.baseImpressions * 3.0 * 1.0; // static quality(66) = 1.0
    expect(prediction.predictedMidImpressions).toBe(Math.round(Math.max(1, mid)));
    expect(prediction.expectedReplies).toBeCloseTo(mid * 0.02, 6);
  });
});
