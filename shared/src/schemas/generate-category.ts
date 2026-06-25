import { z } from "zod";
import { detectedPostFormatSchema } from "./post-formats.js";
import { cooldownStatusSchema } from "./cooldown.js";

export const generateCategorySchema = z.object({
  id: z.string().max(120),
  label: z.string().max(40),
  format: detectedPostFormatSchema,
  basis: z.enum(["top_performer", "frequent", "default"]),
  cooldownStatus: cooldownStatusSchema,
  // All-time count of this format in the captured corpus (drives ranking).
  sampleCount: z.number().int().min(0),
  // Posts of this format within the cooldown window — the number that actually
  // drives clear/warming/cooldown. This (not sampleCount) is what "recent" means.
  recentCount: z.number().int().min(0).default(0),
  // The cooldown window length in days that `recentCount` is measured over.
  windowDays: z.number().int().positive().default(7),
});

export type GenerateCategory = z.infer<typeof generateCategorySchema>;
