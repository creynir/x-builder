import { z } from "zod";

const xHandleSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{1,15}$/, "X handle must be 1-15 letters, numbers, or underscores.");

const statusIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[0-9]+$/, "X status id must be numeric.");

const statusUrlSchema = z
  .string()
  .max(4_096)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return (
        (host === "x.com" ||
          host === "www.x.com" ||
          host === "mobile.x.com" ||
          host === "twitter.com" ||
          host === "www.twitter.com" ||
          host === "mobile.twitter.com") &&
        /^\/[^/]+\/status\/[0-9]+\/?$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  }, "Status URL must be an X/Twitter status URL.");

export const replyThreadContextMissingFieldSchema = z.enum([
  "root",
  "immediate_parent",
  "ancestor",
  "text",
  "author_handle",
  "timestamp",
]);

export const replyThreadContextDiagnosticsSchema = z.object({
  status: z.enum([
    "same_dialog_only",
    "thread_ready",
    "incomplete_observed_graph",
    "blocked_missing_required_parent",
  ]),
  missing: z.array(
    z.object({
      field: replyThreadContextMissingFieldSchema,
      statusId: statusIdSchema.optional(),
      reason: z.enum(["not_observed", "reference_only", "malformed_observed_record"]),
    }),
  ),
  uiMessages: z.array(z.string().min(1).max(400)).max(20),
  promptMessages: z.array(z.string().min(1).max(400)).max(20),
});

export const replyThreadWeakMetricsSchema = z.object({
  impressions: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  reposts: z.number().int().min(0).optional(),
  replies: z.number().int().min(0).optional(),
  quotes: z.number().int().min(0).optional(),
  bookmarks: z.number().int().min(0).optional(),
  favoriteCount: z.number().int().min(0).optional(),
  retweetCount: z.number().int().min(0).optional(),
});

export const replyThreadPostSchema = z.object({
  source: z.enum(["same_dialog_dom", "x_graphql_observed", "archive_tweets_js", "x_live_capture"]),
  role: z
    .enum(["root", "ancestor", "immediate_parent", "current_target", "previous_own_reply"])
    .optional(),
  statusId: statusIdSchema,
  url: statusUrlSchema.optional(),
  authorHandle: xHandleSchema.optional(),
  authorDisplayName: z.string().min(1).max(160).optional(),
  authorUserId: z.string().min(1).max(160).optional(),
  text: z
    .string()
    .min(1)
    .max(8_000)
    .refine((value) => value.trim().length > 0, "Thread post text is required."),
  createdAt: z.string().datetime().optional(),
  inReplyToStatusId: statusIdSchema.optional(),
  inReplyToUserId: z.string().min(1).max(160).optional(),
  conversationId: statusIdSchema.optional(),
  weakMetrics: replyThreadWeakMetricsSchema.optional(),
  observedAt: z.string().datetime(),
});

export const replyThreadDomEvidenceSchema = z.object({
  source: z.literal("same_dialog_dom"),
  observedAt: z.string().datetime(),
  role: z.literal("current_target"),
  currentTarget: z.object({
    authorHandle: xHandleSchema,
    displayName: z.string().min(1).max(160).optional(),
    statusId: statusIdSchema.optional(),
    url: statusUrlSchema.optional(),
    text: z
      .string()
      .min(1)
      .max(8_000)
      .refine((value) => value.trim().length > 0, "Current target text is required."),
    observedAt: z.string().datetime(),
  }),
  diagnostics: replyThreadContextDiagnosticsSchema.optional(),
});

export const replyThreadContextSchema = z.object({
  source: z.literal("resolved_observed_thread"),
  resolvedAt: z.string().datetime(),
  currentTarget: replyThreadPostSchema,
  root: replyThreadPostSchema.optional(),
  immediateParent: replyThreadPostSchema.optional(),
  orderedAncestors: z.array(replyThreadPostSchema).max(25),
  previousOwnReplies: z.array(replyThreadPostSchema).max(10),
  orderedStatusIds: z.array(statusIdSchema).max(80),
  replyThreadContextDiagnostics: replyThreadContextDiagnosticsSchema,
});

export type ReplyThreadContextMissingField = z.infer<typeof replyThreadContextMissingFieldSchema>;
export type ReplyThreadContextDiagnostics = z.infer<typeof replyThreadContextDiagnosticsSchema>;
export type ReplyThreadWeakMetrics = z.infer<typeof replyThreadWeakMetricsSchema>;
export type ReplyThreadPost = z.infer<typeof replyThreadPostSchema>;
export type ReplyThreadDomEvidence = z.infer<typeof replyThreadDomEvidenceSchema>;
export type ReplyThreadContext = z.infer<typeof replyThreadContextSchema>;
