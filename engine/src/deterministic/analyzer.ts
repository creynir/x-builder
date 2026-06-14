import { classifyPostFormat } from "./format-classifier.js";
import { computeReachModel } from "./prediction-estimator.js";
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
  const prediction = computeReachModel({
    text,
    score: score.value,
    format,
    followers: options.followers,
    trailingMedianImpressions: options.trailingMedianImpressions,
    hasExternalLink: options.hasExternalLink ?? false,
    repeatHistory: options.repeatHistory ?? [],
    ...(options.judgeSignals !== undefined ? { judgeSignals: options.judgeSignals } : {}),
  });

  return {
    text,
    format,
    score,
    prediction,
  };
}
