import { z } from "zod";
import {
  replyThreadContextSchema,
  replyThreadDomEvidenceSchema,
} from "./reply-thread-context.js";

const xHandleSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{1,15}$/, "X handle must be 1-15 letters, numbers, or underscores.");

const targetStatusIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[0-9]+$/, "X status id must be numeric.");

const targetUrlSchema = z
  .string()
  .max(4_096)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const isXHost =
        host === "x.com" ||
        host === "www.x.com" ||
        host === "mobile.x.com" ||
        host === "twitter.com" ||
        host === "www.twitter.com" ||
        host === "mobile.twitter.com";

      return isXHost && /^\/[^/]+\/status\/[0-9]+\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }, "Target URL must be an X/Twitter status URL.");

export const replyComposerContextSchema = z.object({
  source: z.literal("same_dialog_dom"),
  targetAuthorHandle: xHandleSchema,
  targetDisplayName: z.string().min(1).max(160).optional(),
  targetText: z
    .string()
    .min(1)
    .max(8_000)
    .refine((value) => value.trim().length > 0, "Target text is required."),
  targetStatusId: targetStatusIdSchema.optional(),
  targetUrl: targetUrlSchema.optional(),
  leadingTargetHandle: z.object({
    handle: xHandleSchema,
    state: z.enum(["present", "user_deleted"]),
  }),
  replyThreadDomEvidence: replyThreadDomEvidenceSchema.optional(),
  replyThreadContext: replyThreadContextSchema.optional(),
});

export type ReplyComposerContext = z.infer<typeof replyComposerContextSchema>;
