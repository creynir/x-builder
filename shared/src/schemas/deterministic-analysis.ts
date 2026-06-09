import { z } from "zod";

export const deterministicSourceFormatSchema = z.enum([
  "one-liner",
  "mini-framework",
  "debate-question",
]);

export const detectedPostFormatSchema = z.enum([
  "one_liner",
  "genuine_question",
  "hot_take",
  "audience_question",
  "story",
  "insight_share",
  "goal_share",
  "ab_choice",
  "connect",
  "other",
]);

const voiceCheckSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(["quality"]).optional(),
  label: z.string().min(1).max(160),
  status: z.enum(["pass", "warn", "fail"]),
});

const learningSchema = z.object({
  text: z.string().min(1).max(1_000),
  relevance: z.enum(["matched", "general"]),
});

const engageabilitySchema = z.object({
  engageable: z.boolean(),
  reason: z.string().min(1).max(240),
});

const postScoreSchema = z.object({
  value: z.number().min(0).max(100),
  checks: z.array(voiceCheckSchema),
  learnings: z.array(learningSchema),
  engageability: engageabilitySchema,
});

const postCoachBadgeSchema = z.object({
  label: z.enum(["Top tier", "Ship it", "Almost there", "Rework"]),
  tone: z.enum(["top", "ship", "almost", "rework"]),
  tooltip: z.string().min(1).max(240),
});

const postCoachSectionSchema = z.object({
  title: z.enum(["Worth a look", "Nudges", "On point", "Sample"]),
  items: z.array(voiceCheckSchema),
});

const learningCaveatSchema = z.literal(
  "Static rule check. Imported performance data is not connected yet.",
);

const emptyPostCoachViewModelSchema = z.object({
  state: z.literal("empty"),
  title: z.literal("Post Coach"),
  message: z.string().min(1).max(400),
});

const readyPostCoachViewModelSchema = z.object({
  state: z.literal("ready"),
  title: z.literal("Post Coach"),
  value: z.number().min(0).max(100),
  badge: postCoachBadgeSchema,
  target: z.literal(60),
  engageability: engageabilitySchema,
  failed: z.array(voiceCheckSchema),
  warned: z.array(voiceCheckSchema),
  passed: z.array(voiceCheckSchema),
  counts: z.object({
    flagged: z.number().int().min(0),
    nudges: z.number().int().min(0),
    onPoint: z.number().int().min(0),
  }),
  expanded: z.boolean(),
  previewMode: z.boolean(),
  sections: z.array(postCoachSectionSchema),
  learnings: z.array(learningSchema),
  learningCaveat: learningCaveatSchema,
  hiddenChecks: z.number().int().min(0),
  helperText: z.string().min(1).max(600),
  footerText: z.string().min(1).max(800),
});

export const postCoachViewModelSchema = z.discriminatedUnion("state", [
  emptyPostCoachViewModelSchema,
  readyPostCoachViewModelSchema,
]);

const predictionSignalSchema = z.object({
  signal_key: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  multiplier: z.number().positive(),
});

const availableEngagementPredictionSchema = z.object({
  status: z.literal("available"),
  rangeLow: z.number().int().min(0),
  rangeHigh: z.number().int().min(0),
  midpoint: z.number().int().min(0),
  confidence: z.enum(["low", "medium", "high"]),
  signals: z.array(predictionSignalSchema),
});

const disabledEngagementPredictionSchema = z.object({
  status: z.literal("disabled"),
  reason: z.enum(["missing_followers", "text_too_short"]),
  message: z.string().min(1).max(240),
});

export const engagementPredictionSchema = z.discriminatedUnion("status", [
  availableEngagementPredictionSchema,
  disabledEngagementPredictionSchema,
]);

const analyzePostsRequestItemSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string().min(1).max(8_000),
  sourceFormat: deterministicSourceFormatSchema.optional(),
});

export const analyzePostsRequestSchema = z.object({
  items: z.array(analyzePostsRequestItemSchema).min(1).max(10),
  scoringContext: z.object({
    followers: z.number().int().positive().optional(),
  }),
  presentation: z
    .object({
      postCoachMode: z.enum(["preview", "expanded"]).default("preview"),
    })
    .default({}),
});

const scoredPostItemSchema = z.object({
  status: z.literal("scored"),
  id: z.string().min(1).max(120),
  text: z.string().min(1).max(8_000),
  sourceFormat: deterministicSourceFormatSchema.optional(),
  detectedFormat: detectedPostFormatSchema,
  score: postScoreSchema,
  postCoach: postCoachViewModelSchema,
  prediction: engagementPredictionSchema,
  heuristicLabel: z.literal("Heuristic rank, not prediction."),
  analyzedAt: z.string().datetime(),
  analyzerVersion: z.string().min(1).max(120),
});

const scoreFailedPostItemSchema = z.object({
  status: z.literal("score_failed"),
  id: z.string().min(1).max(120),
  text: z.string().min(1).max(8_000),
  sourceFormat: deterministicSourceFormatSchema.optional(),
  reason: z.string().min(1).max(120),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
});

export const analyzedPostItemSchema = z.discriminatedUnion("status", [
  scoredPostItemSchema,
  scoreFailedPostItemSchema,
]);

export const analyzePostsResponseSchema = z.object({
  items: z.array(analyzedPostItemSchema).min(1).max(10),
});

export type DeterministicSourceFormat = z.infer<typeof deterministicSourceFormatSchema>;
export type DetectedPostFormat = z.infer<typeof detectedPostFormatSchema>;
export type PostCoachViewModel = z.infer<typeof postCoachViewModelSchema>;
export type EngagementPrediction = z.infer<typeof engagementPredictionSchema>;
export type AnalyzePostsRequest = z.infer<typeof analyzePostsRequestSchema>;
export type AnalyzedPostItem = z.infer<typeof analyzedPostItemSchema>;
export type AnalyzePostsResponse = z.infer<typeof analyzePostsResponseSchema>;
