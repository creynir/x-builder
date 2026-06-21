import { z } from "zod";
import { detectedPostFormatSchema } from "./post-formats.js";
import { cooldownStatusSchema, cooldownReportSchema } from "./cooldown.js";

export const suggestPostRequestSchema = z.object({
  windowDays: z.number().int().min(1).max(90).default(7),
  excludeFormats: z.array(detectedPostFormatSchema).default([]),
  count: z.number().int().min(1).max(4).default(3),
});

export const suggestedPostSchema = z.object({
  id: z.string(),
  format: detectedPostFormatSchema,
  angle: z.enum(["curious", "caution", "constructive", "observational"]),
  text: z.string().min(1).max(8_000),
  rationale: z.string().max(280),
  cooldownStatus: cooldownStatusSchema,
  sourceExamplePostIds: z.array(z.string()).max(5),
  generatedBy: z.enum(["llm", "deterministic_fallback"]),
});

export const suggestPostResponseSchema = z.object({
  status: z.enum(["ready", "insufficient_corpus"]),
  suggestions: z.array(suggestedPostSchema).max(4),
  cooldown: cooldownReportSchema,
  minimumCorpusSize: z.literal(10),
});

export type SuggestPostRequest = z.infer<typeof suggestPostRequestSchema>;
export type SuggestedPost = z.infer<typeof suggestedPostSchema>;
export type SuggestPostResponse = z.infer<typeof suggestPostResponseSchema>;
