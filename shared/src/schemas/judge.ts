import { z } from "zod";

export const judgeDraftRequestSchema = z.object({
  // Trim like generateIdeaRequestSchema: a whitespace-only draft must not reach
  // the (slow, paid) judge.
  text: z.string().trim().min(1).max(8_000),
});

export const judgeVerdictSchema = z.object({
  // Intentional 0-10 integer scale, distinct from the deterministic 0-100 score.
  rating: z.number().int().min(0).max(10),
  headline: z.string().min(1).max(160),
  // Empty arrays are valid: a flawless draft may have no improvements, and a weak
  // one may have no strengths. Capped at 5 to keep the panel scannable.
  strengths: z.array(z.string().min(1).max(240)).max(5),
  improvements: z.array(z.string().min(1).max(240)).max(5),
});

export const judgeDraftResponseSchema = z.object({
  status: z.literal("judged"),
  verdict: judgeVerdictSchema,
  model: z.string().min(1).max(120),
  judgedAt: z.string().datetime(),
});

export type JudgeDraftRequest = z.infer<typeof judgeDraftRequestSchema>;
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;
export type JudgeDraftResponse = z.infer<typeof judgeDraftResponseSchema>;
