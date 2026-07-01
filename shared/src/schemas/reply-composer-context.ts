import { z } from "zod";
import {
  replyThreadContextSchema,
  replyThreadDomEvidenceSchema,
} from "./reply-thread-context.js";
import {
  xHandleSchema,
  xStatusIdSchema,
  xStatusUrlSchema,
} from "./x-status.js";

export const replyComposerContextSchema = z.object({
  source: z.literal("same_dialog_dom"),
  targetAuthorHandle: xHandleSchema,
  targetDisplayName: z.string().min(1).max(160).optional(),
  targetText: z
    .string()
    .min(1)
    .max(8_000)
    .refine((value) => value.trim().length > 0, "Target text is required."),
  targetStatusId: xStatusIdSchema.optional(),
  targetUrl: xStatusUrlSchema.optional(),
  leadingTargetHandle: z.object({
    handle: xHandleSchema,
    state: z.enum(["present", "user_deleted"]),
  }),
  replyThreadDomEvidence: replyThreadDomEvidenceSchema.optional(),
  replyThreadContext: replyThreadContextSchema.optional(),
});

export type ReplyComposerContext = z.infer<typeof replyComposerContextSchema>;
