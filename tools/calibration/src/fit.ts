import type { PostFormat } from "@x-builder/engine";

import type { CalibrationRow } from "./schema.js";

export type FormatReachWeights = { p50Multiplier: number; escapeProbability: number };

export type ReachConstantsFile = {
  formatReachTable: Record<PostFormat, FormatReachWeights>;
  replyRateTable: Record<PostFormat, number>;
  linkPenalty: number;
  fileContents: string;
};

// Seed placeholders mirroring engine/src/deterministic/const/reach-model-weights.ts.
// Formats absent from the corpus keep these live values UNCHANGED (no silent
// zero). Seeded locally rather than imported so the only engine surface this
// package consumes stays the format-classifier re-export.
const SEED_FORMAT_REACH_TABLE: Record<PostFormat, FormatReachWeights> = {
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

const SEED_REPLY_RATE_TABLE: Record<PostFormat, number> = {
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
  other: 0.005,
  story: 0.005,
  nuanced_question: 0.005,
  ab_choice: 0.005,
  wisdom_one_liner: 0.005,
  insight_share: 0.005,
};

const SEED_LINK_PENALTY = 0.2;
const SEED_REPEAT_DECAY_BASE = 0.55;
const SEED_WISDOM_STATUS_DIVISOR = 20_000;

const ALL_FORMATS = Object.keys(SEED_FORMAT_REACH_TABLE) as PostFormat[];

function isPostFormat(value: string): value is PostFormat {
  return Object.prototype.hasOwnProperty.call(SEED_FORMAT_REACH_TABLE, value);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
}

// Geometric median of a 1-D sample. In one dimension the point minimizing the
// sum of absolute distances IS the ordinary median, so the (hand-rolled) median
// is the exact geometric median — no iterative Weiszfeld approximation needed,
// and the result is exact to full precision for the toBeCloseTo(_, 10) checks.
export function geometricMedian1D(values: number[]): number {
  return median(values);
}

function ratiosByFormat(rows: CalibrationRow[]): Map<PostFormat, number[]> {
  const byFormat = new Map<PostFormat, number[]>();
  for (const row of rows) {
    if (!isPostFormat(row.detected_format) || row.trailing_median_imps === null) {
      continue;
    }
    if (row.trailing_median_imps === 0) {
      continue;
    }
    const ratio = row.impressions / row.trailing_median_imps;
    const bucket = byFormat.get(row.detected_format) ?? [];
    bucket.push(ratio);
    byFormat.set(row.detected_format, bucket);
  }
  return byFormat;
}

function escapeFractionByFormat(rows: CalibrationRow[]): Map<PostFormat, number> {
  const counts = new Map<PostFormat, { labeled: number; escaped: number }>();
  for (const row of rows) {
    if (!isPostFormat(row.detected_format) || row.escape_label === null) {
      continue;
    }
    const entry = counts.get(row.detected_format) ?? { labeled: 0, escaped: 0 };
    entry.labeled += 1;
    if (row.escape_label) {
      entry.escaped += 1;
    }
    counts.set(row.detected_format, entry);
  }
  const fractions = new Map<PostFormat, number>();
  for (const [format, entry] of counts) {
    if (entry.labeled > 0) {
      fractions.set(format, entry.escaped / entry.labeled);
    }
  }
  return fractions;
}

function replyRateByFormat(rows: CalibrationRow[]): Map<PostFormat, number> {
  const byFormat = new Map<PostFormat, number[]>();
  for (const row of rows) {
    if (!isPostFormat(row.detected_format) || row.impressions <= 0) {
      continue;
    }
    const bucket = byFormat.get(row.detected_format) ?? [];
    bucket.push(row.replies / row.impressions);
    byFormat.set(row.detected_format, bucket);
  }
  const rates = new Map<PostFormat, number>();
  for (const [format, bucket] of byFormat) {
    if (bucket.length > 0) {
      rates.set(format, median(bucket));
    }
  }
  return rates;
}

// Link penalty: ratio of the geometric-median reach lift of external-link posts
// to that of link-free posts, over rows whose link status is KNOWN. Rows with
// has_external_link === null carry no link signal and are excluded. With no
// labelled link rows in the corpus the seed placeholder is kept unchanged.
function fitLinkPenalty(rows: CalibrationRow[]): number {
  const linkRatios: number[] = [];
  const noLinkRatios: number[] = [];
  for (const row of rows) {
    if (row.has_external_link === null || row.trailing_median_imps === null) {
      continue;
    }
    if (row.trailing_median_imps === 0) {
      continue;
    }
    const ratio = row.impressions / row.trailing_median_imps;
    if (row.has_external_link) {
      linkRatios.push(ratio);
    } else {
      noLinkRatios.push(ratio);
    }
  }
  if (linkRatios.length === 0 || noLinkRatios.length === 0) {
    return SEED_LINK_PENALTY;
  }
  const linkLift = geometricMedian1D(linkRatios);
  const noLinkLift = geometricMedian1D(noLinkRatios);
  if (noLinkLift === 0) {
    return SEED_LINK_PENALTY;
  }
  return linkLift / noLinkLift;
}

// Aggregate impression-ratio decay across repeat_count buckets. Bucket 0 is the
// baseline; each higher bucket's decay is its geometric-median ratio relative to
// bucket 0. Falls back to the seed base when bucket 0 carries no signal.
function fitRepeatDecay(rows: CalibrationRow[]): number {
  const byBucket = new Map<number, number[]>();
  for (const row of rows) {
    if (row.trailing_median_imps === null || row.trailing_median_imps === 0) {
      continue;
    }
    const ratio = row.impressions / row.trailing_median_imps;
    const bucket = byBucket.get(row.repeat_count) ?? [];
    bucket.push(ratio);
    byBucket.set(row.repeat_count, bucket);
  }
  const baseline = byBucket.get(0);
  const repeated = byBucket.get(1);
  if (baseline === undefined || repeated === undefined || baseline.length === 0) {
    return SEED_REPEAT_DECAY_BASE;
  }
  const baselineLift = geometricMedian1D(baseline);
  if (baselineLift === 0) {
    return SEED_REPEAT_DECAY_BASE;
  }
  return geometricMedian1D(repeated) / baselineLift;
}

// Status curve for wisdom_one_liner: the divisor mapping follower count to a
// status multiplier (followers / divisor in the live engine). Fit so the median
// wisdom follower level lands at the neutral midpoint — i.e. divisor = the
// follower bucket center of wisdom posts. With no wisdom rows the seed is kept.
function fitWisdomStatusDivisor(rows: CalibrationRow[]): number {
  const wisdomFollowers = rows
    .filter((row) => row.detected_format === "wisdom_one_liner")
    .map((row) => row.followers_at_post)
    .filter((followers) => followers > 0);
  if (wisdomFollowers.length === 0) {
    return SEED_WISDOM_STATUS_DIVISOR;
  }
  return median(wisdomFollowers);
}

function renderFileContents(
  formatReachTable: Record<PostFormat, FormatReachWeights>,
  replyRateTable: Record<PostFormat, number>,
  linkPenalty: number,
  repeatDecayBase: number,
  wisdomStatusDivisor: number,
  corpusSize: number,
): string {
  const fitDate = new Date().toISOString().slice(0, 10);
  const reachLines = ALL_FORMATS.map((format) => {
    const weights = formatReachTable[format];
    return `  ${format}: { p50Multiplier: ${weights.p50Multiplier}, escapeProbability: ${weights.escapeProbability} },`;
  }).join("\n");
  const replyLines = ALL_FORMATS.map(
    (format) => `  ${format}: ${replyRateTable[format]},`,
  ).join("\n");

  return `// GENERATED by @x-builder/calibration fitReachConstants — do not edit by hand.
// Fit date: ${fitDate}
// Corpus size: ${corpusSize} rows
import type { PostFormat } from "../types.js";

export const formatReachTable: Record<
  PostFormat,
  { p50Multiplier: number; escapeProbability: number }
> = {
${reachLines}
};

export const replyRateTable: Record<PostFormat, number> = {
${replyLines}
};

export const externalLinkMidpointMultiplier = ${linkPenalty};
export const repeatDecayBase = ${repeatDecayBase};
export const wisdomStatusDivisor = ${wisdomStatusDivisor};
`;
}

/**
 * Fit per-format reach constants from a normalized corpus. Each fitted quantity
 * is a hand-rolled aggregate (geometric median == 1-D median, empirical escape
 * fraction, median reply rate); a format with ZERO rows keeps its seed
 * placeholder and is logged as not refit. The result mirrors the engine's live
 * reach-model-weights module and carries the generated source text in
 * `fileContents`.
 */
export function fitReachConstants(rows: CalibrationRow[]): ReachConstantsFile {
  const ratios = ratiosByFormat(rows);
  const escapeFractions = escapeFractionByFormat(rows);
  const replyRates = replyRateByFormat(rows);

  const formatReachTable = {} as Record<PostFormat, FormatReachWeights>;
  const replyRateTable = {} as Record<PostFormat, number>;

  for (const format of ALL_FORMATS) {
    const seed = SEED_FORMAT_REACH_TABLE[format];
    const formatRatios = ratios.get(format);
    const escapeFraction = escapeFractions.get(format);
    const replyRate = replyRates.get(format);

    const hasAnyRow = rows.some((row) => row.detected_format === format);
    if (!hasAnyRow) {
      console.warn(
        `[calibration] format "${format}" had zero corpus rows; keeping seed placeholder (not refit).`,
      );
      formatReachTable[format] = { ...seed };
      replyRateTable[format] = SEED_REPLY_RATE_TABLE[format];
      continue;
    }

    formatReachTable[format] = {
      p50Multiplier:
        formatRatios !== undefined && formatRatios.length > 0
          ? geometricMedian1D(formatRatios)
          : seed.p50Multiplier,
      escapeProbability:
        escapeFraction !== undefined ? escapeFraction : seed.escapeProbability,
    };
    replyRateTable[format] =
      replyRate !== undefined ? replyRate : SEED_REPLY_RATE_TABLE[format];
  }

  const linkPenalty = fitLinkPenalty(rows);
  const repeatDecayBase = fitRepeatDecay(rows);
  const wisdomStatusDivisor = fitWisdomStatusDivisor(rows);

  const fileContents = renderFileContents(
    formatReachTable,
    replyRateTable,
    linkPenalty,
    repeatDecayBase,
    wisdomStatusDivisor,
    rows.length,
  );

  return { formatReachTable, replyRateTable, linkPenalty, fileContents };
}
