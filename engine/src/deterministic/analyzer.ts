import { classifyPostFormat } from "./format-classifier.js";
import { estimateEngagementRange } from "./prediction-estimator.js";
import type { AnalyzeOptions, AnalyzeResult } from "./types.js";
import { evaluateDraftVoice } from "./voice-score.js";

export function analyzeDraftText(
  text: string,
  options: AnalyzeOptions = {},
): AnalyzeResult {
  const format = classifyPostFormat(text);
  const score = evaluateDraftVoice(text, {
    enabled: options.enabled,
    varietyCheck: options.varietyCheck,
  });
  const prediction =
    options.followers === undefined
      ? null
      : estimateEngagementRange({
          text,
          score: score.value,
          format,
          followers: options.followers,
          aiRating: options.aiRating,
        });

  return {
    text,
    format,
    score,
    prediction,
  };
}
