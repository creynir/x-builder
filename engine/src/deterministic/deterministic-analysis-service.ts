import {
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type AnalyzedPostItem,
} from "@x-builder/shared";

import {
  analyzerVersion,
  heuristicLabel,
} from "./deterministic-analysis-constants.js";
import { sanitizeScoreLearnings } from "./learning-copy.js";
import { analyzePost } from "./post-analyzer.js";
import { deriveApiPostCoach } from "./post-coach-view-model.js";
import { toEngagementPrediction } from "./prediction-view-model.js";

const nowIso = (): string => new Date().toISOString();

export class DeterministicAnalysisService {
  analyzePosts(request: AnalyzePostsRequest): AnalyzePostsResponse {
    const parsedRequest = analyzePostsRequestSchema.parse(request);
    const analyzedAt = nowIso();
    const items = parsedRequest.items.map((item): AnalyzedPostItem => {
      try {
        const analysis = analyzePost(item.text, {
          followers: parsedRequest.scoringContext.followers,
        });
        const score = sanitizeScoreLearnings(analysis.score);
        const postCoach = deriveApiPostCoach({
          score,
          text: item.text,
          mode: parsedRequest.presentation.postCoachMode,
        });
        const prediction = toEngagementPrediction({
          analyzerPrediction: analysis.prediction,
          followers: parsedRequest.scoringContext.followers,
        });

        return {
          status: "scored",
          id: item.id,
          text: item.text,
          sourceFormat: item.sourceFormat,
          detectedFormat: analysis.format,
          score,
          postCoach,
          prediction,
          heuristicLabel,
          analyzedAt,
          analyzerVersion,
        };
      } catch {
        return {
          status: "score_failed",
          id: item.id,
          text: item.text,
          sourceFormat: item.sourceFormat,
          reason: "analysis_failed",
          message: "This candidate could not be scored. Try again.",
          retryable: true,
        };
      }
    });

    return analyzePostsResponseSchema.parse({ items });
  }
}
