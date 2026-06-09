import { assessEngagementReadiness } from "./engagement-readiness.js";
import { deriveScoreLearnings } from "./learning-model.js";
import { calculateDeterministicScore } from "./score-aggregator.js";
import { countWords, getNonEmptyLines } from "./text-metrics.js";
import type { DeterministicPostScore } from "./types.js";
import { evaluateWritingChecks } from "./writing-checks.js";
import type { VoiceCheck } from "./voice-check.js";

export function evaluateDraftVoice(
  text: string,
  options: {
    enabled?: Partial<Record<string, boolean>>;
    varietyCheck?: VoiceCheck;
  } = {},
): DeterministicPostScore {
  const trimmedText = text.trim();
  const isEmpty = trimmedText.length === 0;
  const lowerText = trimmedText.toLowerCase();
  const visibleLines = getNonEmptyLines(trimmedText);
  const draftWordCount = countWords(trimmedText);
  const characterCount = trimmedText.length;
  const isTooShort = !isEmpty && (draftWordCount < 4 || characterCount < 15);
  const isThin = !isEmpty && !isTooShort && (draftWordCount < 7 || characterCount < 30);
  const checksBeforeSettings = evaluateWritingChecks({
    trimmedText,
    lowerText,
    visibleLines,
    draftWordCount,
    characterCount,
    isEmpty,
    isTooShort,
    isThin,
    varietyCheck: options.varietyCheck,
  });
  const enabledChecks = options.enabled
    ? checksBeforeSettings.filter((check) => options.enabled?.[check.id] !== false)
    : checksBeforeSettings;
  const engageability = assessEngagementReadiness(trimmedText, visibleLines);

  return {
    value: calculateDeterministicScore({
      checks: enabledChecks,
      isEmpty,
      isTooShort,
      isThin,
    }),
    checks: enabledChecks,
    learnings: isEmpty
      ? []
      : deriveScoreLearnings({
          trimmedText,
          wordCount: draftWordCount,
          lineCount: visibleLines.length,
        }),
    engageability,
  };
}
