import { z } from "zod";
import { replyThreadPostSchema } from "./reply-thread-context.js";

export const liveCapturedPostSchema = z.object({
  platformPostId: z.string().max(160),
  text: z.string().min(1).max(8_000),
  createdAt: z.string().datetime(),
  kind: z.enum(["original", "reply", "repost_reference", "unknown"]),
  language: z.string().optional(),
  replyReferences: z
    .object({
      inReplyToPostId: z.string().optional(),
      inReplyToUserId: z.string().optional(),
    })
    .default({}),
  entityFlags: z.object({
    hasUrls: z.boolean(),
    hasMedia: z.boolean(),
    hasHashtags: z.boolean(),
    hasMentions: z.boolean(),
  }),
  liveMetrics: z
    .object({
      impressions: z.number().int().min(0).optional(),
      likes: z.number().int().min(0).optional(),
      reposts: z.number().int().min(0).optional(),
      replies: z.number().int().min(0).optional(),
      quotes: z.number().int().min(0).optional(),
      bookmarks: z.number().int().min(0).optional(),
    })
    .default({}),
  capturedAt: z.string().datetime(),
});

export const liveCapturedProfileSchema = z.object({
  platformUserId: z.string(),
  screenName: z.string(),
  followers: z.number().int().min(0).optional(),
  capturedAt: z.string().datetime(),
});

export const captureIngestRequestSchema = z.object({
  posts: z.array(liveCapturedPostSchema).max(200).default([]),
  profile: liveCapturedProfileSchema.optional(),
  observedThreadPosts: z.array(replyThreadPostSchema).max(400).optional(),
});

export const captureIngestResponseSchema = z.object({
  insertedCount: z.number().int().min(0),
  updatedCount: z.number().int().min(0),
  unchangedCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  profileApplied: z.boolean(),
  corpusSize: z.number().int().min(0),
});

export const captureSummarySchema = z.object({
  postsCaptured: z.number().int().min(0),
  lastCaptureAt: z.string().datetime().optional(),
  followers: z.number().int().min(0).optional(),
  screenName: z.string().max(80).optional(),
  profileCapturedAt: z.string().datetime().optional(),
});

export type LiveCapturedPost = z.infer<typeof liveCapturedPostSchema>;
export type LiveCapturedProfile = z.infer<typeof liveCapturedProfileSchema>;
export type CaptureIngestRequest = z.infer<typeof captureIngestRequestSchema>;
export type CaptureIngestResponse = z.infer<typeof captureIngestResponseSchema>;
export type CaptureSummary = z.infer<typeof captureSummarySchema>;
