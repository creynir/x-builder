import type Database from "better-sqlite3";
import {
  feedbackPredictionLinkSchema,
  feedbackPredictionRecordSchema,
  getFeedbackLoopSummaryRequestSchema,
  type FeedbackPredictionLink,
  type FeedbackPredictionRecord,
  type GetFeedbackLoopSummaryRequest,
} from "@x-builder/shared";
import { z } from "zod";

import { PostLibraryStorageError } from "../server/post-library-repository.js";
import type { FeedbackLoopRepository } from "./feedback-loop-repository.js";

type DatabaseHandle = Database.Database;

type FeedbackPredictionRow = {
  id: string;
  client_event_id: string | null;
  action: string;
  platform: string;
  content_hash: string;
  text: string;
  detected_format_snapshot: string;
  source_format: string | null;
  score_value: number;
  predicted_mid_impressions: number;
  stall_low: number;
  stall_high: number;
  escape_low: number;
  escape_high: number;
  escape_probability: number;
  expected_replies: number;
  base_impressions: number;
  base_source: string;
  quality_basis: string;
  reach_model_version: string;
  prediction_signals_json: string;
  scoring_context_json: string;
  analyzer_version: string;
  analyzed_at: string;
  created_at: string;
};

type FeedbackPredictionLinkRow = {
  prediction_id: string;
  platform: string;
  platform_post_id: string;
  method: string;
  linked_at: string;
};

const stableJson = (value: unknown): string => JSON.stringify(value);

const storageError = (message: string, cause?: unknown): PostLibraryStorageError =>
  new PostLibraryStorageError(message, cause);

const parseJson = (value: string): unknown => JSON.parse(value);

const toRecordRow = (record: FeedbackPredictionRecord): FeedbackPredictionRow => ({
  id: record.id,
  client_event_id: record.clientEventId ?? null,
  action: record.action,
  platform: record.platform,
  content_hash: record.contentHash,
  text: record.text,
  detected_format_snapshot: record.detectedFormat,
  source_format: record.sourceFormat ?? null,
  score_value: record.scoreValue,
  predicted_mid_impressions: record.prediction.predictedMidImpressions,
  stall_low: record.prediction.stallRange.low,
  stall_high: record.prediction.stallRange.high,
  escape_low: record.prediction.escapeRange.low,
  escape_high: record.prediction.escapeRange.high,
  escape_probability: record.prediction.escapeProbability,
  expected_replies: record.prediction.expectedReplies,
  base_impressions: record.prediction.baseImpressions,
  base_source: record.prediction.baseSource,
  quality_basis: record.prediction.qualityBasis,
  reach_model_version: record.prediction.reachModelVersion,
  prediction_signals_json: stableJson(record.prediction.signals),
  scoring_context_json: stableJson(record.scoringContext),
  analyzer_version: record.analyzerVersion,
  analyzed_at: record.analyzedAt,
  created_at: record.createdAt,
});

const fromRecordRow = (row: FeedbackPredictionRow): FeedbackPredictionRecord =>
  feedbackPredictionRecordSchema.parse({
    id: row.id,
    ...(row.client_event_id === null ? {} : { clientEventId: row.client_event_id }),
    action: row.action,
    platform: row.platform,
    text: row.text,
    contentHash: row.content_hash,
    detectedFormat: row.detected_format_snapshot,
    ...(row.source_format === null ? {} : { sourceFormat: row.source_format }),
    scoreValue: row.score_value,
    prediction: {
      status: "available",
      signals: parseJson(row.prediction_signals_json),
      predictedMidImpressions: row.predicted_mid_impressions,
      stallRange: { low: row.stall_low, high: row.stall_high },
      escapeRange: { low: row.escape_low, high: row.escape_high },
      escapeProbability: row.escape_probability,
      expectedReplies: row.expected_replies,
      baseImpressions: row.base_impressions,
      baseSource: row.base_source,
      qualityBasis: row.quality_basis,
      reachModelVersion: row.reach_model_version,
    },
    scoringContext: parseJson(row.scoring_context_json),
    analyzerVersion: row.analyzer_version,
    analyzedAt: row.analyzed_at,
    createdAt: row.created_at,
  });

const toLinkRow = (link: FeedbackPredictionLink): FeedbackPredictionLinkRow => ({
  prediction_id: link.predictionId,
  platform: link.platform,
  platform_post_id: link.platformPostId,
  method: link.method,
  linked_at: link.linkedAt,
});

const fromLinkRow = (row: FeedbackPredictionLinkRow): FeedbackPredictionLink =>
  feedbackPredictionLinkSchema.parse({
    predictionId: row.prediction_id,
    platform: row.platform,
    platformPostId: row.platform_post_id,
    method: row.method,
    linkedAt: row.linked_at,
  });

const cutoffIso = (windowDays: number): string =>
  new Date(Date.now() - windowDays * 24 * 60 * 60 * 1_000).toISOString();

export class SqliteFeedbackLoopRepository implements FeedbackLoopRepository {
  constructor(private readonly db: DatabaseHandle) {}

  async recordPrediction(
    input: FeedbackPredictionRecord,
  ): Promise<{ record: FeedbackPredictionRecord; duplicate: boolean }> {
    try {
      const record = feedbackPredictionRecordSchema.parse(input);
      const existing = record.clientEventId
        ? this.readRecordByClientEventId(record.clientEventId)
        : undefined;

      if (existing) {
        return { record: existing, duplicate: true };
      }

      const row = toRecordRow(record);
      this.db
        .prepare(
          `INSERT INTO feedback_prediction (
            id, client_event_id, action, platform, content_hash, text, detected_format_snapshot,
            source_format, score_value, predicted_mid_impressions, stall_low, stall_high,
            escape_low, escape_high, escape_probability, expected_replies, base_impressions,
            base_source, quality_basis, reach_model_version, prediction_signals_json,
            scoring_context_json, analyzer_version, analyzed_at, created_at
          ) VALUES (
            @id, @client_event_id, @action, @platform, @content_hash, @text, @detected_format_snapshot,
            @source_format, @score_value, @predicted_mid_impressions, @stall_low, @stall_high,
            @escape_low, @escape_high, @escape_probability, @expected_replies, @base_impressions,
            @base_source, @quality_basis, @reach_model_version, @prediction_signals_json,
            @scoring_context_json, @analyzer_version, @analyzed_at, @created_at
          )`,
        )
        .run(row);

      return { record, duplicate: false };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("Feedback prediction record failed schema validation.", error);
      }

      if (input.clientEventId) {
        const existing = this.readRecordByClientEventId(input.clientEventId);
        if (existing) {
          return { record: existing, duplicate: true };
        }
      }

      throw storageError("Failed to record feedback prediction.", error);
    }
  }

  async upsertLink(input: FeedbackPredictionLink): Promise<FeedbackPredictionLink> {
    try {
      const link = feedbackPredictionLinkSchema.parse(input);
      const row = toLinkRow(link);

      this.db
        .prepare(
          `INSERT INTO feedback_prediction_link (
            prediction_id, platform, platform_post_id, method, linked_at
          ) VALUES (
            @prediction_id, @platform, @platform_post_id, @method, @linked_at
          )
          ON CONFLICT(prediction_id) DO UPDATE SET
            platform = excluded.platform,
            platform_post_id = excluded.platform_post_id,
            method = excluded.method,
            linked_at = excluded.linked_at`,
        )
        .run(row);

      return link;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("Feedback prediction link failed schema validation.", error);
      }

      throw storageError("Failed to upsert feedback prediction link.", error);
    }
  }

  async listPredictions(
    request: GetFeedbackLoopSummaryRequest,
  ): Promise<FeedbackPredictionRecord[]> {
    try {
      const parsed = getFeedbackLoopSummaryRequestSchema.parse(request);
      const rows = parsed.format
        ? (this.db
            .prepare(
              `SELECT * FROM feedback_prediction
               WHERE created_at >= ? AND detected_format_snapshot = ?
               ORDER BY created_at DESC, id ASC
               LIMIT ?`,
            )
            .all(cutoffIso(parsed.windowDays), parsed.format, parsed.limit) as FeedbackPredictionRow[])
        : (this.db
            .prepare(
              `SELECT * FROM feedback_prediction
               WHERE created_at >= ?
               ORDER BY created_at DESC, id ASC
               LIMIT ?`,
            )
            .all(cutoffIso(parsed.windowDays), parsed.limit) as FeedbackPredictionRow[]);

      return rows.map(fromRecordRow);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("Feedback prediction list request failed schema validation.", error);
      }

      throw storageError("Failed to list feedback predictions.", error);
    }
  }

  async listLinks(predictionIds: string[]): Promise<FeedbackPredictionLink[]> {
    if (predictionIds.length === 0) {
      return [];
    }

    try {
      const placeholders = predictionIds.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `SELECT * FROM feedback_prediction_link
           WHERE prediction_id IN (${placeholders})
           ORDER BY linked_at DESC, prediction_id ASC`,
        )
        .all(...predictionIds) as FeedbackPredictionLinkRow[];

      return rows.map(fromLinkRow);
    } catch (error) {
      throw storageError("Failed to list feedback prediction links.", error);
    }
  }

  private readRecordByClientEventId(clientEventId: string): FeedbackPredictionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM feedback_prediction WHERE client_event_id = ?")
      .get(clientEventId) as FeedbackPredictionRow | undefined;

    return row === undefined ? undefined : fromRecordRow(row);
  }
}
