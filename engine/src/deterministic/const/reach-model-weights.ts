import type { PostFormat } from "../types.js";

/**
 * Per-format reach-model weights. `p50Multiplier` scales the stall-regime
 * median; `escapeProbability` is the chance a post escapes its initial
 * audience into broader distribution. Exhaustive over `PostFormat`.
 */
export const formatReachTable: Record<
  PostFormat,
  { p50Multiplier: number; escapeProbability: number }
> = {
  fill_blank_tribal: { p50Multiplier: 3.0, escapeProbability: 0.3 }, // CALIBRATE
  cta_farm: { p50Multiplier: 3.0, escapeProbability: 0.3 }, // CALIBRATE
  fantasy_question: { p50Multiplier: 2.5, escapeProbability: 0.25 }, // CALIBRATE
  binary_choice: { p50Multiplier: 2.0, escapeProbability: 0.2 }, // CALIBRATE
  connect: { p50Multiplier: 1.8, escapeProbability: 0.15 }, // CALIBRATE
  audience_question: { p50Multiplier: 1.6, escapeProbability: 0.15 }, // CALIBRATE
  genuine_question: { p50Multiplier: 1.2, escapeProbability: 0.1 }, // CALIBRATE
  recognition_roast: { p50Multiplier: 1.5, escapeProbability: 0.12 }, // CALIBRATE
  hot_take: { p50Multiplier: 1.1, escapeProbability: 0.08 }, // CALIBRATE
  milestone: { p50Multiplier: 1.0, escapeProbability: 0.05 }, // CALIBRATE
  ab_choice: { p50Multiplier: 1.2, escapeProbability: 0.1 }, // CALIBRATE
  story: { p50Multiplier: 0.8, escapeProbability: 0.04 }, // CALIBRATE
  founder_story: { p50Multiplier: 0.8, escapeProbability: 0.04 }, // CALIBRATE
  nuanced_question: { p50Multiplier: 0.5, escapeProbability: 0.03 }, // CALIBRATE
  wisdom_one_liner: { p50Multiplier: 1.0, escapeProbability: 0.03 }, // CALIBRATE
  insight_share: { p50Multiplier: 0.3, escapeProbability: 0.02 }, // CALIBRATE
  other: { p50Multiplier: 1.0, escapeProbability: 0.05 }, // CALIBRATE
};

/**
 * Expected reply rate per format. Formats not deliberately tuned fall to the
 * 0.005 floor. Exhaustive over `PostFormat`.
 */
export const replyRateTable: Record<PostFormat, number> = {
  cta_farm: 0.02, // CALIBRATE
  fill_blank_tribal: 0.015, // CALIBRATE
  binary_choice: 0.018, // CALIBRATE
  fantasy_question: 0.012, // CALIBRATE
  audience_question: 0.012, // CALIBRATE
  connect: 0.015, // CALIBRATE
  milestone: 0.02, // CALIBRATE
  genuine_question: 0.012, // CALIBRATE
  recognition_roast: 0.008, // CALIBRATE
  hot_take: 0.008, // CALIBRATE
  other: 0.005, // CALIBRATE
  story: 0.005, // CALIBRATE
  founder_story: 0.005, // CALIBRATE
  nuanced_question: 0.005, // CALIBRATE
  ab_choice: 0.005, // CALIBRATE
  wisdom_one_liner: 0.005, // CALIBRATE
  insight_share: 0.005, // CALIBRATE
};

export const stallRangeLowCoeff = 0.3; // CALIBRATE
export const stallRangeHighCoeff = 1.2; // CALIBRATE
export const escapeRangeLowCoeff = 3; // CALIBRATE
export const escapeRangeHighCoeff = 12; // CALIBRATE
export const externalLinkMidpointMultiplier = 0.2; // CALIBRATE
export const externalLinkEscapeCap = 0.03; // CALIBRATE
export const repeatDecayBase = 0.55; // CALIBRATE
export const repeatDecayFloor = 0.2; // CALIBRATE
export const wisdomStatusDivisor = 20000; // CALIBRATE
export const wisdomStatusMin = 0.3; // CALIBRATE
export const wisdomStatusMax = 1.5; // CALIBRATE

/**
 * Placeholder advanced-context multipliers. These are intentionally narrow until
 * the calibration workspace has a labeled corpus for time-of-day, media, and
 * account-maturity effects.
 */
export const postingHourMultipliers = [
  0.95, 0.94, 0.93, 0.92, 0.93, 0.95, 0.98, 1.0,
  1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.07,
  1.05, 1.03, 1.02, 1.01, 1.0, 0.98, 0.97, 0.96,
] as const; // CALIBRATE

export const mediaAttachmentMultiplier = 1.06; // CALIBRATE
export const accountAgeMultiplierFloor = 0.95; // CALIBRATE
export const accountAgeMultiplierMax = 1.08; // CALIBRATE
export const accountAgeMaturityYears = 10; // CALIBRATE
