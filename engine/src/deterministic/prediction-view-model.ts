import type { EngagementPrediction as ApiEngagementPrediction } from "@x-builder/shared";

import type {
  EngagementPrediction as AnalyzerEngagementPrediction,
} from "./post-analyzer.js";

export const toEngagementPrediction = (input: {
  analyzerPrediction: AnalyzerEngagementPrediction | null;
  followers?: number;
}): ApiEngagementPrediction => {
  if (typeof input.followers !== "number") {
    return {
      status: "disabled",
      reason: "missing_followers",
      message: "Add a follower count to estimate engagement for this draft.",
    };
  }

  if (!input.analyzerPrediction) {
    return {
      status: "disabled",
      reason: "text_too_short",
      message: "Write a little more before estimating engagement.",
    };
  }

  return {
    status: "available",
    rangeLow: input.analyzerPrediction.rangeLow,
    rangeHigh: input.analyzerPrediction.rangeHigh,
    midpoint: input.analyzerPrediction.midpoint,
    confidence: input.analyzerPrediction.confidence,
    signals: input.analyzerPrediction.signals,
  };
};
