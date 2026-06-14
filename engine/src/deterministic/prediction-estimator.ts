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
import { tribeVocativeTerms } from "./rule-lexicon.js";
import {
  trendingTopicBonusPerMatch,
  trendingTopicMaxBonus,
  trendingTopicTerms,
} from "./trending-topic-lexicon.js";
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
  // Pass-2 of the two-pass contract. When present, the judged 0..100 impressions
  // score drives the quality slot and the judged replies score drives the reply
  // rate, replacing the static-quality and format-reply-rate paths respectively.
  judgeSignals?: { impressions: number; replies: number };
};

// Formats whose escape probability is halved relative to the table value: they
// trade on resonance over reach, so their escape ceiling is deliberately lower.
const halvedEscapeFormats = new Set<PostFormat>([
  "nuanced_question",
  "wisdom_one_liner",
  "insight_share",
]);

// Reach-signal tuning constants. Each adjusts pEscape / expectedReplies only.
const tribeVocativeReplyMultiplier = 1.2; // CALIBRATE
const oneWordEscapeMultiplier = 1.4; // CALIBRATE
const oneWordReplyMultiplier = 2.0; // CALIBRATE
const answerEffortPenalty = 0.7; // CALIBRATE

// Judge-signal tuning constants (pass-2 only). The quality multiplier band maps
// a judged 0..100 impressions score geometrically into [floor, ceiling]; the
// reply-rate band maps a judged 0..100 replies score linearly into [low, high].
const judgedQualityFloor = 0.5; // CALIBRATE
const judgedQualityCeiling = 2.5; // CALIBRATE
const judgedReplyRateLow = 0.002; // CALIBRATE
const judgedReplyRateHigh = 0.025; // CALIBRATE

// Linear interpolation helper used by the judged reply-rate band.
const lerp = (low: number, high: number, t: number): number => low + (high - low) * t;

// Self-disclosure of failure or money specifics. A bare dollar amount or a
// confession of loss reads as vulnerable rather than escape-worthy, so pEscape
// is damped.
const selfDisclosurePattern =
  /\$[\d,]+|\b(?:lost|burned|wasted|blew)\b[^.?!]*\$?[\d,]+|\b(?:failed|failure|broke|bankrupt)\b/i; // CALIBRATE

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
  // Pass-2: a judged impressions score swaps the static-quality slot for the
  // continuous judged-quality multiplier; every other slot is untouched.
  const qualityBasis: EngagementPrediction["qualityBasis"] =
    input.judgeSignals !== undefined ? "judge" : "static";
  const qualityMultiplier =
    input.judgeSignals !== undefined
      ? toJudgedQualityMultiplier(input.judgeSignals.impressions)
      : staticQualityCompression(input.score);
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

  // Reach-signal adjustments (pEscape / expectedReplies only — never midpoint).
  const lowerText = input.text.trim().toLowerCase();
  // Pass-2: a judged replies score swaps the format reply-rate table for the
  // judged reply-rate lerp. The downstream signal bonuses (e.g. tribe +20%)
  // still compose on top of whichever base reply figure is selected here.
  let expectedReplies =
    input.judgeSignals !== undefined
      ? mid * lerp(judgedReplyRateLow, judgedReplyRateHigh, input.judgeSignals.replies / 100)
      : mid * replyRateTable[input.format];

  // Trending-topic bonus lifts pEscape per matching term, capped.
  const trendingMatchCount = trendingTopicTerms.filter((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(lowerText),
  ).length;

  if (trendingMatchCount > 0) {
    escapeProbability *=
      1 +
      Math.min(
        trendingTopicMaxBonus,
        trendingTopicBonusPerMatch * trendingMatchCount,
      );
  }

  // Tribe vocative lifts expectedReplies only.
  const tribeVocative = tribeVocativeTerms.some((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(lowerText),
  );

  if (tribeVocative) {
    expectedReplies *= tribeVocativeReplyMultiplier;
  }

  // Answer-effort: an explicit one-word constraint lifts both pEscape and
  // replies; an anecdote/justification question or a self-disclosure of failure
  // or money specifics dampens pEscape.
  if (/\bin (?:1|one) word\b/i.test(lowerText)) {
    escapeProbability *= oneWordEscapeMultiplier;
    expectedReplies *= oneWordReplyMultiplier;
  }

  if (
    /\bhow did you\b|\bwhat made you\b|\band why\?/i.test(lowerText) ||
    selfDisclosurePattern.test(lowerText)
  ) {
    escapeProbability *= answerEffortPenalty;
  }

  // Clamp the composed pEscape, then apply the external-link cap LAST so the cap
  // always wins over any signal bonus.
  escapeProbability = Math.min(1, Math.max(0, escapeProbability));

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

  const signals = collectReachSignals(input.text);

  return {
    predictedMidImpressions,
    stallRange,
    escapeRange,
    escapeProbability,
    expectedReplies,
    baseImpressions: base,
    baseSource,
    qualityBasis,
    reachModelVersion,
    signals,
  };
}

/**
 * Text-derived reach signals that survive the two-regime rebuild: timely
 * wording keyed to the trending-topic lexicon. These populate the prediction's
 * `signals` array. They carry no ranking, trend, or imported-data copy.
 */
function collectReachSignals(text: string): PredictionSignal[] {
  const lowerText = text.trim().toLowerCase();
  const signals: PredictionSignal[] = [];

  const timelyTermCount = trendingTopicTerms.filter((term) =>
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

  return signals;
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
 * Maps a judged 0..100 impressions score into the reach-model quality slot via a
 * geometric sweep: clamp(floor · (ceiling/floor)^(impressions/100), floor,
 * ceiling). 0 -> floor (0.5), 100 -> ceiling (2.5), 50 -> the geometric midpoint
 * (~1.118). This replaces staticQualityCompression in pass-2.
 *
 * Double-count risk: the judge also reads the draft's FORMAT when it scores
 * impressions, while computeReachModel applies a separate per-format multiplier
 * (formatReachTable). The judged-quality multiplier therefore risks
 * double-counting format strength. The clamped [0.5, 2.5] band keeps this
 * bounded for now; calibration (the // CALIBRATE constants) is expected to
 * disentangle the format contribution from the judged-quality contribution once
 * real two-pass data is available.
 */
export function toJudgedQualityMultiplier(impressions: number): number {
  const swept =
    judgedQualityFloor *
    (judgedQualityCeiling / judgedQualityFloor) ** (impressions / 100); // CALIBRATE
  return Math.min(judgedQualityCeiling, Math.max(judgedQualityFloor, swept));
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
