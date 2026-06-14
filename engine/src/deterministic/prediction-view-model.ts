import type { EngagementPrediction as ApiEngagementPrediction } from "@x-builder/shared";

import type {
  EngagementPrediction as AnalyzerEngagementPrediction,
} from "./types.js";

export const toEngagementPrediction = (input: {
  analyzerPrediction: AnalyzerEngagementPrediction | null;
  followers?: number;
  trailingMedianImpressions?: number;
}): ApiEngagementPrediction => {
  if (
    typeof input.followers !== "number" &&
    typeof input.trailingMedianImpressions !== "number"
  ) {
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

  const prediction = input.analyzerPrediction;

  return {
    status: "available",
    predictedMidImpressions: prediction.predictedMidImpressions,
    stallRange: prediction.stallRange,
    escapeRange: prediction.escapeRange,
    escapeProbability: prediction.escapeProbability,
    expectedReplies: prediction.expectedReplies,
    baseImpressions: prediction.baseImpressions,
    baseSource: prediction.baseSource,
    qualityBasis: prediction.qualityBasis,
    reachModelVersion: prediction.reachModelVersion,
    signals: prediction.signals,
  };
};
