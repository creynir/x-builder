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
import { analyzeDraftText } from "./analyzer.js";
import { sanitizeScoreLearnings } from "./learning-copy.js";
import { deriveApiPostCoach } from "./post-coach-view-model.js";
import { toEngagementPrediction } from "./prediction-view-model.js";

const nowIso = (): string => new Date().toISOString();
type AnalyzePost = typeof analyzeDraftText;

export class DeterministicAnalysisService {
  private readonly analyzePost: AnalyzePost;

  constructor(options: { analyzePost?: AnalyzePost } = {}) {
    this.analyzePost = options.analyzePost ?? analyzeDraftText;
  }

  analyzePosts(request: AnalyzePostsRequest): AnalyzePostsResponse {
    const parsedRequest = analyzePostsRequestSchema.parse(request);
    const analyzedAt = nowIso();
    const items = parsedRequest.items.map((item): AnalyzedPostItem => {
      let analysis: ReturnType<AnalyzePost>;

      try {
        analysis = this.analyzePost(item.text, {
          followers: parsedRequest.scoringContext.followers,
        });
      } catch (error) {
        console.error("[deterministic-analysis] failed to score candidate", {
          id: item.id,
          error,
        });
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
    });

    return analyzePostsResponseSchema.parse({ items });
  }
}
