import { z } from "zod";

export const judgeAnnotationSchema = z.object({
  quote: z.string().min(1).max(280),
  severity: z.enum(["suggestion", "warning"]),
  recommendation: z.string().min(1).max(240),
});

export const judgeDraftRequestSchema = z.object({
  // Trim like generateIdeaRequestSchema: a whitespace-only draft must not reach
  // the (slow, paid) judge.
  text: z.string().trim().min(1).max(8_000),
  accountProfile: z.string().trim().min(1).max(600).optional(),
});

const judgeScoreValue = z.number().int().min(0).max(100);

// Separate 0-100 dimensions instead of a single rating, so the verdict can show
// why a post scores the way it does. Modelled on the x-post-performance rubric.
// voiceMatch is generic ("authentic human voice, not AI-slop"), NOT tied to any
// individual's voice profile.
// The producer (RMU-008) always emits all thirteen dimensions: the four
// behavioral dimensions are required, and audienceMatch is required on the wire
// but nullable — an explicit null when no account profile anchors audience fit,
// a 0..100 score when one does.
export const judgeScoresSchema = z.object({
  overall: judgeScoreValue,
  replies: judgeScoreValue,
  profileClicks: judgeScoreValue,
  impressions: judgeScoreValue,
  bookmarkValue: judgeScoreValue,
  dwellProxy: judgeScoreValue,
  voiceMatch: judgeScoreValue,
  negativeRisk: judgeScoreValue,
  answerEffort: judgeScoreValue,
  strangerAnswerability: judgeScoreValue,
  statusDependency: judgeScoreValue,
  replyVsQuoteOrientation: judgeScoreValue,
  audienceMatch: judgeScoreValue.nullable(),
});

export const judgeVerdictLabelSchema = z.enum([
  "post_now",
  "slight_rework",
  "major_rework",
  "do_not_post",
]);

export const judgeConfidenceSchema = z.enum(["low", "medium", "high"]);

export const judgeVerdictSchema = z.object({
  verdict: judgeVerdictLabelSchema,
  confidence: judgeConfidenceSchema,
  scores: judgeScoresSchema,
  headline: z.string().min(1).max(160),
  strengths: z.array(z.string().min(1).max(240)).max(5),
  improvements: z.array(z.string().min(1).max(240)).max(5),
  annotations: z.array(judgeAnnotationSchema).max(12).default([]),
});

export const judgeDraftResponseSchema = z.object({
  status: z.literal("judged"),
  verdict: judgeVerdictSchema,
  model: z.string().min(1).max(120),
  judgedAt: z.string().datetime(),
});

export type JudgeAnnotation = z.infer<typeof judgeAnnotationSchema>;
export type JudgeDraftRequest = z.infer<typeof judgeDraftRequestSchema>;
export type JudgeScores = z.infer<typeof judgeScoresSchema>;
export type JudgeVerdictLabel = z.infer<typeof judgeVerdictLabelSchema>;
export type JudgeConfidence = z.infer<typeof judgeConfidenceSchema>;
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;
export type JudgeDraftResponse = z.infer<typeof judgeDraftResponseSchema>;

// Returns true when the verdict is approved for posting (post_now or slight_rework).
// Single source of "approved" — producers and overlay must derive identically.
export const deriveApproved = (verdict: JudgeVerdict): boolean =>
  verdict.verdict === "post_now" || verdict.verdict === "slight_rework";

// Derive the verdict band from the overall score so the verdict label and the
// score can never disagree. Bands follow the x-post-performance interpretation.
export const deriveJudgeVerdict = (overall: number): JudgeVerdictLabel => {
  if (overall >= 85) {
    return "post_now";
  }

  if (overall >= 70) {
    return "slight_rework";
  }

  if (overall >= 40) {
    return "major_rework";
  }

  return "do_not_post";
};
