import { z } from "zod";
import { replyComposerContextSchema } from "./reply-composer-context.js";
import { xStatusIdSchema } from "./x-status.js";

const replyTextSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine((value) => value.trim().length > 0, "Reply text must not be empty.");

export const generateReplyVariantsRequestSchema = z
  .object({
    replyContext: replyComposerContextSchema,
    currentAuthoredBody: z.string().max(1_000).optional(),
  })
  .strict();

export const replyVariantSchema = z
  .object({
    id: z.string().min(1).max(120),
    body: replyTextSchema,
    replyMove: z.string().min(1).max(80).optional(),
    groundingNotes: z.array(z.string().min(1).max(400)).max(8).default([]),
    warnings: z.array(z.string().min(1).max(300)).max(8).default([]),
  })
  .strict();

export const generateReplyVariantsResponseSchema = z
  .object({
    variants: z.array(replyVariantSchema).min(3).max(4),
  })
  .strict();

export const recordGeneratedReplyRequestSchema = z
  .object({
    clientEventId: z.string().min(1).max(160),
    bodyText: replyTextSchema,
    writtenText: replyTextSchema,
    targetStatusId: xStatusIdSchema.optional(),
    chosenVariantId: z.string().min(1).max(120).optional(),
    replyMove: z.string().min(1).max(80).optional(),
    generatedAt: z.string().datetime().optional(),
  })
  .strict();

export const generatedReplyRecordSchema = z
  .object({
    id: z.string().min(1).max(160),
    clientEventId: z.string().min(1).max(160),
    bodyText: replyTextSchema,
    writtenText: replyTextSchema,
    bodyTextHash: z.string().min(1).max(160),
    writtenTextHash: z.string().min(1).max(160),
    targetStatusId: xStatusIdSchema.optional(),
    chosenVariantId: z.string().min(1).max(120).optional(),
    replyMove: z.string().min(1).max(80).optional(),
    generatedAt: z.string().datetime(),
    recordedAt: z.string().datetime(),
  })
  .strict();

export const recordGeneratedReplyResponseSchema = z
  .object({
    record: generatedReplyRecordSchema,
    duplicate: z.boolean(),
  })
  .strict();

export type GenerateReplyVariantsRequest = z.infer<typeof generateReplyVariantsRequestSchema>;
export type ReplyVariant = z.infer<typeof replyVariantSchema>;
export type GenerateReplyVariantsResponse = z.infer<typeof generateReplyVariantsResponseSchema>;
export type RecordGeneratedReplyRequest = z.infer<typeof recordGeneratedReplyRequestSchema>;
export type GeneratedReplyRecord = z.infer<typeof generatedReplyRecordSchema>;
export type RecordGeneratedReplyResponse = z.infer<typeof recordGeneratedReplyResponseSchema>;
