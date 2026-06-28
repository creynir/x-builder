import { z } from "zod";
import {
  availableEngagementPredictionSchema,
  scoringContextSchema,
} from "./deterministic-analysis.js";
import { detectedPostFormatSchema, deterministicSourceFormatSchema } from "./post-formats.js";

const isoDateTimeSchema = z.string().datetime();
const platformPostIdSchema = z.string().trim().min(1).max(160);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nonEmptyTextSchema = z.string().trim().min(1).max(8_000);

export const feedbackPlatformSchema = z.literal("x").default("x");

export const feedbackPredictionActionSchema = z.enum([
  "generated_draft_written",
  "apply_all_result_written",
  "manual_record_posted_draft",
]);

export const feedbackLinkMethodSchema = z.enum([
  "recorded_platform_post_id",
  "manual_platform_post_id",
  "normalized_content_hash",
]);

export const feedbackOutcomeStatusSchema = z.enum([
  "linked",
  "pending_unlinked",
  "ambiguous",
  "partial_actuals",
]);

export const feedbackPredictionSnapshotSchema = z.object({
  detectedFormat: detectedPostFormatSchema,
  sourceFormat: deterministicSourceFormatSchema.optional(),
  scoreValue: z.number().min(0).max(100),
  prediction: availableEngagementPredictionSchema,
  scoringContext: scoringContextSchema,
  analyzerVersion: z.string().min(1).max(120),
  analyzedAt: isoDateTimeSchema,
});

export const recordFeedbackPredictionRequestSchema = z.object({
  clientEventId: z.string().trim().min(1).max(160).optional(),
  action: feedbackPredictionActionSchema,
  platform: feedbackPlatformSchema.optional().default("x"),
  text: nonEmptyTextSchema,
  platformPostId: platformPostIdSchema.optional(),
  snapshot: feedbackPredictionSnapshotSchema,
});

export const feedbackPredictionRecordSchema = z.object({
  id: z.string().min(1).max(160),
  clientEventId: z.string().min(1).max(160).optional(),
  action: feedbackPredictionActionSchema,
  platform: feedbackPlatformSchema.optional().default("x"),
  text: nonEmptyTextSchema,
  contentHash: sha256Schema,
  detectedFormat: detectedPostFormatSchema,
  sourceFormat: deterministicSourceFormatSchema.optional(),
  scoreValue: z.number().min(0).max(100),
  prediction: availableEngagementPredictionSchema,
  scoringContext: scoringContextSchema,
  analyzerVersion: z.string().min(1).max(120),
  analyzedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const feedbackPredictionLinkSchema = z.object({
  predictionId: z.string().min(1).max(160),
  platform: feedbackPlatformSchema.optional().default("x"),
  platformPostId: platformPostIdSchema,
  method: feedbackLinkMethodSchema,
  linkedAt: isoDateTimeSchema,
});

export const recordFeedbackPredictionResponseSchema = z.object({
  record: feedbackPredictionRecordSchema,
  link: feedbackPredictionLinkSchema.optional(),
  duplicate: z.boolean().default(false),
});

export const linkFeedbackPredictionRequestSchema = z.object({
  predictionId: z.string().min(1).max(160),
  platform: feedbackPlatformSchema.optional().default("x"),
  platformPostId: platformPostIdSchema,
  method: z.literal("manual_platform_post_id").default("manual_platform_post_id"),
});

export const linkFeedbackPredictionResponseSchema = z.object({
  link: feedbackPredictionLinkSchema,
});

export const getFeedbackLoopSummaryRequestSchema = z
  .object({
    windowDays: z.number().int().min(1).max(365).default(90),
    limit: z.number().int().min(1).max(200).default(50),
    format: detectedPostFormatSchema.optional(),
  })
  .default({});

export const feedbackActualMetricsSchema = z.object({
  platformPostId: platformPostIdSchema,
  postCreatedAt: isoDateTimeSchema.optional(),
  observedAt: isoDateTimeSchema.optional(),
  source: z.enum(["x_live_capture", "archive_tweets_js"]),
  impressions: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  reposts: z.number().int().min(0).optional(),
  replies: z.number().int().min(0).optional(),
  quotes: z.number().int().min(0).optional(),
  bookmarks: z.number().int().min(0).optional(),
  favoriteCount: z.number().int().min(0).optional(),
  retweetCount: z.number().int().min(0).optional(),
});

export const feedbackPredictionDeltaSchema = z.object({
  predictedMidImpressions: z.number().int().min(0),
  actualImpressions: z.number().int().min(0).optional(),
  absoluteDelta: z.number().int().optional(),
  ratio: z.number().min(0).optional(),
  bucket: z.enum(["below_stall", "within_stall", "between_ranges", "within_escape", "above_escape", "unknown"]),
});

export const feedbackAmbiguitySchema = z.object({
  candidatePlatformPostIds: z.array(platformPostIdSchema).min(2).max(20),
});

export const feedbackOutcomeSchema = z.object({
  status: feedbackOutcomeStatusSchema,
  prediction: feedbackPredictionRecordSchema,
  link: feedbackPredictionLinkSchema.optional(),
  actual: feedbackActualMetricsSchema.optional(),
  ambiguity: feedbackAmbiguitySchema.optional(),
  delta: feedbackPredictionDeltaSchema.optional(),
});

export const feedbackFormatLearningSchema = z.object({
  format: detectedPostFormatSchema,
  predictionCount: z.number().int().min(0),
  linkedCount: z.number().int().min(0),
  actualCount: z.number().int().min(0),
  medianPredictedImpressions: z.number().int().min(0).optional(),
  medianActualImpressions: z.number().int().min(0).optional(),
  medianRatio: z.number().min(0).optional(),
  escapeRate: z.number().min(0).max(1).optional(),
  direction: z.enum(["up", "down", "stable", "insufficient_data"]),
  adjustment: z.string().min(1).max(240),
});

export const getFeedbackLoopSummaryResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  windowDays: z.number().int().min(1).max(365),
  totals: z.object({
    predictions: z.number().int().min(0),
    linked: z.number().int().min(0),
    pendingUnlinked: z.number().int().min(0),
    ambiguous: z.number().int().min(0),
    partialActuals: z.number().int().min(0),
    actuals: z.number().int().min(0),
  }),
  formatLearnings: z.array(feedbackFormatLearningSchema).max(50),
  recent: z.array(feedbackOutcomeSchema),
});

export type FeedbackPlatform = z.infer<typeof feedbackPlatformSchema>;
export type FeedbackPredictionAction = z.infer<typeof feedbackPredictionActionSchema>;
export type FeedbackLinkMethod = z.infer<typeof feedbackLinkMethodSchema>;
export type FeedbackOutcomeStatus = z.infer<typeof feedbackOutcomeStatusSchema>;
export type FeedbackPredictionSnapshot = z.infer<typeof feedbackPredictionSnapshotSchema>;
export type RecordFeedbackPredictionRequest = z.input<typeof recordFeedbackPredictionRequestSchema>;
export type FeedbackPredictionRecord = z.infer<typeof feedbackPredictionRecordSchema>;
export type FeedbackPredictionLink = z.infer<typeof feedbackPredictionLinkSchema>;
export type RecordFeedbackPredictionResponse = z.infer<typeof recordFeedbackPredictionResponseSchema>;
export type LinkFeedbackPredictionRequest = z.input<typeof linkFeedbackPredictionRequestSchema>;
export type LinkFeedbackPredictionResponse = z.infer<typeof linkFeedbackPredictionResponseSchema>;
export type GetFeedbackLoopSummaryRequest = z.input<typeof getFeedbackLoopSummaryRequestSchema>;
export type FeedbackActualMetrics = z.infer<typeof feedbackActualMetricsSchema>;
export type FeedbackPredictionDelta = z.infer<typeof feedbackPredictionDeltaSchema>;
export type FeedbackAmbiguity = z.infer<typeof feedbackAmbiguitySchema>;
export type FeedbackOutcome = z.infer<typeof feedbackOutcomeSchema>;
export type FeedbackFormatLearning = z.infer<typeof feedbackFormatLearningSchema>;
export type GetFeedbackLoopSummaryResponse = z.infer<typeof getFeedbackLoopSummaryResponseSchema>;
