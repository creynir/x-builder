import type { PostFormat } from "../types";
import type { VoiceCheck } from "../voice-check";

export type RepeatHistoryEntry = {
  format: PostFormat;
  lastPostedAt: string;
  countLast7d: number;
};

export type JudgeSignals = {
  impressions: number;
  replies: number;
};

export type ReachInput = {
  text: string;
  score: number;
  format: PostFormat;
  followers: number | undefined;
  trailingMedianImpressions: number | undefined;
  hasExternalLink: boolean;
  repeatHistory: RepeatHistoryEntry[];
  judgeSignals?: JudgeSignals;
};

/**
 * Test-owned builder for reach-model inputs. Shared with the two-regime
 * assembly suite so both suites describe the same input shape. Override only
 * the fields a given test cares about.
 */
export function buildReachInput(overrides: Partial<ReachInput> = {}): ReachInput {
  return {
    text: "Clear writing compounds when the point is specific.",
    score: 66,
    format: "insight_share",
    followers: 1000,
    trailingMedianImpressions: undefined,
    hasExternalLink: false,
    repeatHistory: [],
    ...overrides,
  };
}

export const enrichedTextCheckIds = [
  "quality_answerable_question",
  "quality_vague_curiosity",
  "quality_standalone_context",
  "quality_claim_evidence",
  "quality_profile_click_reason",
  "quality_one_idea_focus",
  "line_length",
  "link_density",
  "mention_density",
] as const;

export const bannedClaimPattern =
  /\b(ranking|rank|algorithm|profile health|trends?|trending|live trend|zeitgeist|your data|last 30 days|imported metrics|reply_score|profile_click_score|dwell_score)\b/i;

export function findCheck(checks: readonly VoiceCheck[], id: string): VoiceCheck {
  const check = checks.find((item) => item.id === id);

  if (!check) {
    throw new Error(`Expected check "${id}" to be present.`);
  }

  return check;
}
