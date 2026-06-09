import {
  checkScorePoints,
  scoreDefaults,
} from "./const/scoring-weights.js";
import type { VoiceCheck } from "./voice-check.js";

export function calculateDeterministicScore(input: {
  checks: readonly VoiceCheck[];
  isEmpty: boolean;
  isTooShort: boolean;
  isThin: boolean;
}): number {
  if (input.isEmpty) {
    return 0;
  }

  const standardChecks = input.checks.filter((check) => check.kind !== "quality");
  const qualityChecks = input.checks.filter((check) => check.kind === "quality");
  const standardPoints = standardChecks.reduce((sum, check) => {
    return sum + checkScorePoints[check.status];
  }, 0);
  const standardScore =
    standardChecks.length === 0
      ? scoreDefaults.fullScore
      : Math.round((standardPoints / standardChecks.length) * scoreDefaults.fullScore);
  const qualityPassCount = qualityChecks.filter((check) => check.status === "pass").length;
  const qualityScore =
    qualityChecks.length === 0
      ? scoreDefaults.fullScore
      : Math.round(
          scoreDefaults.qualityFloor +
          (qualityPassCount / qualityChecks.length) * scoreDefaults.qualityRange,
        );
  let finalScore = Math.min(standardScore, qualityScore);

  if (input.isTooShort) {
    finalScore = Math.min(finalScore, scoreDefaults.tooShortMaximum);
  } else if (input.isThin) {
    finalScore = Math.min(finalScore, scoreDefaults.thinDraftMaximum);
  }

  return finalScore;
}
