import { z } from "zod";

import { detectedPostFormatSchema } from "./post-formats.js";

const isoDateTimeSchema = z.string().datetime();
const platformSchema = z.literal("x").default("x");
const sourceIdSchema = z.string().trim().min(1).max(160);
const platformPostIdSchema = z.string().trim().min(1).max(160);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nonEmptyTextSchema = z.string().trim().min(1).max(8_000);

const normalizeScreenName = (value: string): string =>
  value.trim().replace(/^@+/, "").trim().toLowerCase();

const externalScreenNameSchema = z
  .string()
  .trim()
  .max(80)
  .transform(normalizeScreenName)
  .pipe(z.string().min(1).max(80));

export const externalXSignalSourceStatusSchema = z.enum([
  "active",
  "removed",
  "waiting_for_observation",
  "refresh_failed",
]);

export const externalXSignalEvidenceSourceSchema = z.enum([
  "external_x_graphql_observe",
  "external_fixture_import",
]);

export const externalXSignalPatternTypeSchema = z.enum([
  "format",
  "hook",
  "cadence",
  "entity_mix",
  "engagement_outlier",
]);

export const externalXSignalMetricSnapshotSchema = z.object({
  impressions: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  reposts: z.number().int().min(0).optional(),
  replies: z.number().int().min(0).optional(),
  quotes: z.number().int().min(0).optional(),
  bookmarks: z.number().int().min(0).optional(),
});

export const externalXSignalSourceSchema = z.object({
  id: sourceIdSchema,
  platform: platformSchema,
  screenName: externalScreenNameSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  platformUserId: z.string().trim().min(1).max(160).optional(),
  status: externalXSignalSourceStatusSchema,
  evidenceCount: z.number().int().min(0).default(0),
  patternCount: z.number().int().min(0).default(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lastObservedAt: isoDateTimeSchema.optional(),
});

export const externalXSignalEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(160),
  sourceId: sourceIdSchema,
  platform: platformSchema,
  platformPostId: platformPostIdSchema,
  screenName: externalScreenNameSchema,
  text: nonEmptyTextSchema,
  previewText: z.string().trim().min(1).max(280).optional(),
  createdAt: isoDateTimeSchema.optional(),
  kind: z.enum(["original", "reply", "repost_reference", "unknown"]).default("unknown"),
  language: z.string().trim().min(1).max(40).optional(),
  inReplyToPostId: z.string().trim().min(1).max(160).optional(),
  inReplyToUserId: z.string().trim().min(1).max(160).optional(),
  hasUrls: z.boolean().default(false),
  hasMedia: z.boolean().default(false),
  hasHashtags: z.boolean().default(false),
  hasMentions: z.boolean().default(false),
  metrics: externalXSignalMetricSnapshotSchema.default({}),
  evidenceSource: externalXSignalEvidenceSourceSchema,
  observedAt: isoDateTimeSchema,
  importedAt: isoDateTimeSchema.optional(),
  contentHash: sha256Schema.optional(),
  rawId: z.string().trim().min(1).max(160).optional(),
  sourceHash: sha256Schema.optional(),
  captureSessionId: z.string().trim().min(1).max(160).optional(),
});

export const externalXSignalRefreshRunSchema = z.object({
  id: z.string().trim().min(1).max(160),
  sourceId: sourceIdSchema,
  status: z.enum(["pending", "captured", "no_observation", "failed"]),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.optional(),
  evidenceCount: z.number().int().min(0).default(0),
  warningCount: z.number().int().min(0).default(0),
  message: z.string().trim().min(1).max(240).optional(),
});

export const externalXSignalEvidencePreviewSchema = z.object({
  evidenceId: z.string().trim().min(1).max(160),
  sourceId: sourceIdSchema,
  screenName: externalScreenNameSchema,
  platformPostId: platformPostIdSchema,
  text: z.string().trim().min(1).max(280),
  metrics: externalXSignalMetricSnapshotSchema.default({}),
});

export const externalXSignalPatternSchema = z.object({
  id: z.string().trim().min(1).max(160),
  patternType: externalXSignalPatternTypeSchema,
  format: detectedPostFormatSchema.optional(),
  label: z.string().trim().min(1).max(120),
  statement: z.string().trim().min(1).max(400),
  confidence: z.number().min(0).max(1),
  supportCount: z.number().int().min(0),
  sourceIds: z.array(sourceIdSchema).max(50).default([]),
  evidenceIds: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  evidence: z.array(externalXSignalEvidencePreviewSchema).max(10).default([]),
  generatedAt: isoDateTimeSchema,
  version: z.string().trim().min(1).max(80),
});

export const externalXSignalsTotalsSchema = z.object({
  sources: z.number().int().min(0),
  activeSources: z.number().int().min(0),
  evidence: z.number().int().min(0),
  patterns: z.number().int().min(0),
  refreshRuns: z.number().int().min(0),
});

export const getExternalXSignalsOverviewRequestSchema = z
  .object({
    sourceId: sourceIdSchema.optional(),
    includeRemoved: z.boolean().default(false),
    sourceLimit: z.number().int().min(1).max(100).default(25),
    patternLimit: z.number().int().min(1).max(100).default(20),
    recentEvidenceLimit: z.number().int().min(1).max(100).default(20),
    refreshRunLimit: z.number().int().min(1).max(100).default(20),
  })
  .default({});

export const getExternalXSignalsOverviewResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  sources: z.array(externalXSignalSourceSchema).max(100),
  totals: externalXSignalsTotalsSchema,
  patterns: z.array(externalXSignalPatternSchema).max(100),
  recentEvidence: z.array(externalXSignalEvidenceSchema).max(100),
  refreshRuns: z.array(externalXSignalRefreshRunSchema).max(100),
});

export const addExternalXSignalSourceRequestSchema = z.object({
  screenName: externalScreenNameSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  platformUserId: z.string().trim().min(1).max(160).optional(),
});

export const addExternalXSignalSourceResponseSchema = z.object({
  source: externalXSignalSourceSchema,
  duplicate: z.boolean().default(false),
});

export const removeExternalXSignalSourceRequestSchema = z.object({
  sourceId: sourceIdSchema,
});

export const removeExternalXSignalSourceResponseSchema = z.object({
  source: externalXSignalSourceSchema,
  removed: z.boolean().default(true),
});

export const refreshExternalXSignalSourceRequestSchema = z.object({
  sourceId: sourceIdSchema,
});

export const refreshExternalXSignalSourceResponseSchema = z.object({
  source: externalXSignalSourceSchema,
  run: externalXSignalRefreshRunSchema,
});

export type ExternalXSignalSourceStatus = z.infer<typeof externalXSignalSourceStatusSchema>;
export type ExternalXSignalEvidenceSource = z.infer<typeof externalXSignalEvidenceSourceSchema>;
export type ExternalXSignalPatternType = z.infer<typeof externalXSignalPatternTypeSchema>;
export type ExternalXSignalSource = z.infer<typeof externalXSignalSourceSchema>;
export type ExternalXSignalEvidence = z.infer<typeof externalXSignalEvidenceSchema>;
export type ExternalXSignalMetricSnapshot = z.infer<typeof externalXSignalMetricSnapshotSchema>;
export type ExternalXSignalRefreshRun = z.infer<typeof externalXSignalRefreshRunSchema>;
export type ExternalXSignalEvidencePreview = z.infer<typeof externalXSignalEvidencePreviewSchema>;
export type ExternalXSignalPattern = z.infer<typeof externalXSignalPatternSchema>;
export type ExternalXSignalsTotals = z.infer<typeof externalXSignalsTotalsSchema>;
export type GetExternalXSignalsOverviewRequest = z.input<typeof getExternalXSignalsOverviewRequestSchema>;
export type GetExternalXSignalsOverviewResponse = z.infer<typeof getExternalXSignalsOverviewResponseSchema>;
export type AddExternalXSignalSourceRequest = z.input<typeof addExternalXSignalSourceRequestSchema>;
export type AddExternalXSignalSourceResponse = z.infer<typeof addExternalXSignalSourceResponseSchema>;
export type RemoveExternalXSignalSourceRequest = z.input<typeof removeExternalXSignalSourceRequestSchema>;
export type RemoveExternalXSignalSourceResponse = z.infer<typeof removeExternalXSignalSourceResponseSchema>;
export type RefreshExternalXSignalSourceRequest = z.input<typeof refreshExternalXSignalSourceRequestSchema>;
export type RefreshExternalXSignalSourceResponse = z.infer<typeof refreshExternalXSignalSourceResponseSchema>;
