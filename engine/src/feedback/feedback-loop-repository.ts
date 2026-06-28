import type {
  FeedbackPredictionLink,
  FeedbackPredictionRecord,
  GetFeedbackLoopSummaryRequest,
} from "@x-builder/shared";

export interface FeedbackLoopRepository {
  recordPrediction(
    input: FeedbackPredictionRecord,
  ): Promise<{ record: FeedbackPredictionRecord; duplicate: boolean }>;
  upsertLink(input: FeedbackPredictionLink): Promise<FeedbackPredictionLink>;
  listPredictions(request: GetFeedbackLoopSummaryRequest): Promise<FeedbackPredictionRecord[]>;
  listLinks(predictionIds: string[]): Promise<FeedbackPredictionLink[]>;
}
