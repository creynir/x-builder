import { z } from "zod";

/**
 * The calibration input contract: one row per original post. Mirrors the
 * columns the normalizer derives and the fit/validate functions consume.
 * Three columns are nullable because they are undefined before enough history
 * exists (`trailing_median_imps`, `escape_label`) or when X stripped the entity
 * metadata that would disambiguate a t.co link from media (`has_external_link`).
 */
export const CalibrationRowSchema = z.object({
  account: z.string(),
  postId: z.string(),
  time: z.string(),
  text: z.string(),
  impressions: z.number(),
  likes: z.number(),
  reposts: z.number(),
  replies: z.number(),
  bookmarks: z.number(),
  followers: z.number(),
  followers_at_post: z.number(),
  trailing_median_imps: z.number().nullable(),
  detected_format: z.string(),
  repeat_count: z.number(),
  days_since_same_format: z.number(),
  has_external_link: z.boolean().nullable(),
  hour_utc: z.number(),
  weekday: z.number(),
  escape_label: z.boolean().nullable(),
});

export type CalibrationRow = z.infer<typeof CalibrationRowSchema>;
