import { z } from "zod";
import { judgeVerdictSchema } from "./judge.js";

export const applyJudgeSuggestionsRequestSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
});

export const applyJudgeSuggestionsResponseSchema = z.object({
  text: z.string().min(1).max(8_000),
  verdict: judgeVerdictSchema,
  approved: z.boolean(),
  improvedOverOriginal: z.boolean(),
});

export type ApplyJudgeSuggestionsRequest = z.infer<typeof applyJudgeSuggestionsRequestSchema>;
export type ApplyJudgeSuggestionsResponse = z.infer<typeof applyJudgeSuggestionsResponseSchema>;
