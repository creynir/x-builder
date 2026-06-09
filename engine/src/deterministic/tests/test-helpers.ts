import type { VoiceCheck } from "../voice-check";

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
