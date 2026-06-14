import { engagementPredictionWeights } from "./const/scoring-weights.js";
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
} from "./const/reach-model-weights.js";
import { reachModelVersion } from "./deterministic-analysis-constants.js";
import { timelyTopicTerms } from "./rule-lexicon.js";
import type {
  EngagementPrediction,
  PostFormat,
  PredictionSignal,
  RepeatHistoryEntry,
} from "./types.js";

export type ReachModelInput = {
  text: string;
  score: number;
  format: PostFormat;
  followers: number | undefined;
  trailingMedianImpressions: number | undefined;
  hasExternalLink: boolean;
  repeatHistory: RepeatHistoryEntry[];
};

// Formats whose escape probability is halved relative to the table value: they
// trade on resonance over reach, so their escape ceiling is deliberately lower.
const halvedEscapeFormats = new Set<PostFormat>([
  "nuanced_question",
  "wisdom_one_liner",
  "insight_share",
]);

/**
 * Resolves the reach base. A supplied trailing median wins (zero counts as a
 * present value); otherwise the follower-estimate machinery scales 400
 * impressions per thousand followers, clamped to [80, 4000]. The base is
 * floored to at least one impression.
 */
function resolveBase(input: ReachModelInput): {
  base: number;
  baseSource: EngagementPrediction["baseSource"];
} | null {
  if (input.trailingMedianImpressions !== undefined) {
    return {
      base: Math.max(1, Math.round(input.trailingMedianImpressions)),
      baseSource: "trailing_median",
    };
  }

  if (input.followers === undefined) {
    return null;
  }

  const followerScale = Math.min(
    engagementPredictionWeights.maximumFollowerScale,
    Math.max(
      engagementPredictionWeights.minimumFollowerScale,
      input.followers / 1000,
    ),
  );
  const base =
    engagementPredictionWeights.baseImpressionsPerThousandFollowers * followerScale;

  return {
    base: Math.max(1, Math.round(base)),
    baseSource: "follower_estimate",
  };
}

/**
 * Assembles the two-regime reach model from the RMU-005 weight tables and
 * multiplier helpers. Returns `null` when neither a follower count nor a
 * trailing median is available to anchor the base, and when the draft text is
 * below the minimum length.
 */
export function computeReachModel(
  input: ReachModelInput,
): EngagementPrediction | null {
  if (input.text.trim().length < engagementPredictionWeights.minimumTextLength) {
    return null;
  }

  const resolved = resolveBase(input);

  if (resolved === null) {
    return null;
  }

  const { base, baseSource } = resolved;

  const formatMultiplier = formatReachTable[input.format].p50Multiplier;
  const qualityMultiplier = staticQualityCompression(input.score);
  const linkMultiplier = input.hasExternalLink ? externalLinkMidpointMultiplier : 1;
  const repeatMultiplier = computeRepeatMultiplier(input.repeatHistory, input.format);
  const statusMultiplier = computeStatusMultiplier(input.format, input.followers);

  const mid = Math.max(
    1,
    base *
      formatMultiplier *
      qualityMultiplier *
      linkMultiplier *
      repeatMultiplier *
      statusMultiplier,
  );
  const predictedMidImpressions = Math.round(mid);

  let escapeProbability = formatReachTable[input.format].escapeProbability;

  if (halvedEscapeFormats.has(input.format)) {
    escapeProbability *= 0.5;
  }

  if (input.hasExternalLink) {
    escapeProbability = Math.min(escapeProbability, externalLinkEscapeCap);
  }

  const stallRange = {
    low: Math.round(Math.min(stallRangeLowCoeff * base, mid)),
    high: Math.round(Math.max(stallRangeLowCoeff * base, stallRangeHighCoeff * mid)),
  };
  const escapeRange = {
    low: Math.round(escapeRangeLowCoeff * base),
    high: Math.round(escapeRangeHighCoeff * base),
  };
  const expectedReplies = mid * replyRateTable[input.format];

  const signals = collectReachSignals(input.text);
  const confidence = deriveConfidence(signals.length, input.score);

  return {
    predictedMidImpressions,
    stallRange,
    escapeRange,
    escapeProbability,
    expectedReplies,
    baseImpressions: base,
    baseSource,
    qualityBasis: "static",
    reachModelVersion,
    // Transitional legacy mirror (removed in RMU-011).
    rangeLow: stallRange.low,
    rangeHigh: escapeRange.high,
    midpoint: predictedMidImpressions,
    confidence,
    signals,
  };
}

/**
 * Text-derived reach signals that survive the two-regime rebuild: timely
 * wording and a tension/contradiction marker. These feed the transitional
 * confidence ladder and the legacy mirror's `signals` array. None of them carry
 * ranking, trend, or imported-data copy.
 */
function collectReachSignals(text: string): PredictionSignal[] {
  const trimmedText = text.trim();
  const lowerText = trimmedText.toLowerCase();
  const signals: PredictionSignal[] = [];

  const timelyTermCount = timelyTopicTerms.filter((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(lowerText),
  ).length;

  if (timelyTermCount > 0) {
    const timelyMultiplier =
      1 +
      Math.min(
        engagementPredictionWeights.timelyTermMaximumBonus,
        engagementPredictionWeights.timelyTermBonusPerMatch * timelyTermCount,
      );

    signals.push({
      signal_key: "timely_wording",
      label: "Timely wording",
      multiplier: timelyMultiplier,
    });
  }

  if (
    /\b(but|yet|never|actually|instead|however|rather|despite|supposed to)\b/i.test(
      trimmedText,
    )
  ) {
    signals.push({
      signal_key: "tension_contradiction",
      label: "Tension / contradiction +25%",
      multiplier: engagementPredictionWeights.tensionMultiplier,
    });
  }

  return signals;
}

/**
 * Transitional confidence ladder (bridge only, removed in RMU-011). Derives a
 * low/medium/high band from the surviving signal count and the static score.
 */
function deriveConfidence(
  signalCount: number,
  score: number,
): EngagementPrediction["confidence"] {
  if (
    signalCount >= engagementPredictionWeights.highConfidenceSignalCount &&
    score >= engagementPredictionWeights.highConfidenceScoreMinimum
  ) {
    return "high";
  }

  if (
    signalCount >= engagementPredictionWeights.mediumConfidenceSignalCount &&
    score >= engagementPredictionWeights.mediumConfidenceScoreMinimum
  ) {
    return "medium";
  }

  return "low";
}

/**
 * Compresses the static quality score into a reach-model multiplier band.
 * Higher-quality drafts earn a modest lift; lower-quality drafts are damped.
 */
export function staticQualityCompression(score: number): number {
  if (score >= 90) {
    return 1.3;
  }

  if (score >= 70) {
    return 1.1;
  }

  if (score >= 50) {
    return 1.0;
  }

  if (score >= 25) {
    return 0.8;
  }

  return 0.6;
}

/**
 * Decays reach for a format the author has posted recently. The decay base
 * raised to the recent count, floored, models diminishing returns from
 * repeating the same format. No matching history means no decay.
 */
export function computeRepeatMultiplier(
  repeatHistory: RepeatHistoryEntry[],
  format: PostFormat,
): number {
  const entry = repeatHistory.find((item) => item.format === format);

  if (!entry) {
    return 1;
  }

  return Math.max(repeatDecayFloor, repeatDecayBase ** entry.countLast7d);
}

/**
 * Scales wisdom_one_liner reach by author status (follower count): the format
 * trades on authority, so a low-follower account is damped and a high-follower
 * account is lifted, both clamped. Every other format is status-neutral, and a
 * wisdom_one_liner with unknown followers falls back to neutral.
 */
export function computeStatusMultiplier(
  format: PostFormat,
  followers: number | undefined,
): number {
  if (format !== "wisdom_one_liner" || followers === undefined) {
    return 1;
  }

  return Math.min(
    wisdomStatusMax,
    Math.max(wisdomStatusMin, followers / wisdomStatusDivisor),
  );
}
