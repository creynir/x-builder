import { z } from "zod";

import {
  statusIdFromStatusUrl,
  xHandleSchema,
  xStatusIdSchema,
  xStatusUrlSchema,
} from "./x-status.js";

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
      statusId: xStatusIdSchema.optional(),
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

export const replyThreadPostSchema = z
  .object({
    source: z.enum(["same_dialog_dom", "x_graphql_observed", "archive_tweets_js", "x_live_capture"]),
    role: z
      .enum(["root", "ancestor", "immediate_parent", "current_target", "previous_own_reply"])
      .optional(),
    statusId: xStatusIdSchema,
    url: xStatusUrlSchema.optional(),
    authorHandle: xHandleSchema.optional(),
    authorDisplayName: z.string().min(1).max(160).optional(),
    authorUserId: z.string().min(1).max(160).optional(),
    text: z
      .string()
      .min(1)
      .max(8_000)
      .refine((value) => value.trim().length > 0, "Thread post text is required."),
    createdAt: z.string().datetime().optional(),
    inReplyToStatusId: xStatusIdSchema.optional(),
    inReplyToUserId: z.string().min(1).max(160).optional(),
    conversationId: xStatusIdSchema.optional(),
    weakMetrics: replyThreadWeakMetricsSchema.optional(),
    observedAt: z.string().datetime(),
  })
  .superRefine((post, ctx) => {
    if (post.url === undefined) return;
    const urlStatusId = statusIdFromStatusUrl(post.url);
    if (urlStatusId !== post.statusId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Status URL id must match statusId.",
      });
    }
  });

export const replyThreadDomEvidenceSchema = z.object({
  source: z.literal("same_dialog_dom"),
  observedAt: z.string().datetime(),
  role: z.literal("current_target"),
  currentTarget: z
    .object({
      authorHandle: xHandleSchema,
      displayName: z.string().min(1).max(160).optional(),
      statusId: xStatusIdSchema.optional(),
      url: xStatusUrlSchema.optional(),
      text: z
        .string()
        .min(1)
        .max(8_000)
        .refine((value) => value.trim().length > 0, "Current target text is required."),
      observedAt: z.string().datetime(),
    })
    .superRefine((target, ctx) => {
      if (target.statusId === undefined || target.url === undefined) return;
      const urlStatusId = statusIdFromStatusUrl(target.url);
      if (urlStatusId !== target.statusId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: "Status URL id must match statusId.",
        });
      }
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
  orderedStatusIds: z.array(xStatusIdSchema).max(80),
  replyThreadContextDiagnostics: replyThreadContextDiagnosticsSchema,
});

export type ReplyThreadContextMissingField = z.infer<typeof replyThreadContextMissingFieldSchema>;
export type ReplyThreadContextDiagnostics = z.infer<typeof replyThreadContextDiagnosticsSchema>;
export type ReplyThreadWeakMetrics = z.infer<typeof replyThreadWeakMetricsSchema>;
export type ReplyThreadPost = z.infer<typeof replyThreadPostSchema>;
export type ReplyThreadDomEvidence = z.infer<typeof replyThreadDomEvidenceSchema>;
export type ReplyThreadContext = z.infer<typeof replyThreadContextSchema>;
