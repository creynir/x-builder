import { z } from "zod";

export const deterministicSourceFormatSchema = z.enum([
  "one-liner",
  "mini-framework",
  "debate-question",
]);

export const detectedPostFormatSchema = z.enum([
  "genuine_question",
  "hot_take",
  "audience_question",
  "story",
  "founder_story",
  "insight_share",
  "ab_choice",
  "connect",
  "other",
  "fill_blank_tribal",
  "cta_farm",
  "fantasy_question",
  "binary_choice",
  "nuanced_question",
  "recognition_roast",
  "wisdom_one_liner",
  "milestone",
]);

export type DeterministicSourceFormat = z.infer<typeof deterministicSourceFormatSchema>;
export type DetectedPostFormat = z.infer<typeof detectedPostFormatSchema>;
