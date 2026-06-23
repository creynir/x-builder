import { z } from "zod";
import { detectedPostFormatSchema } from "./post-formats.js";
import { cooldownStatusSchema } from "./cooldown.js";

export const generateCategorySchema = z.object({
  id: z.string().max(120),
  label: z.string().max(40),
  format: detectedPostFormatSchema,
  basis: z.enum(["top_performer", "frequent", "default"]),
  cooldownStatus: cooldownStatusSchema,
  sampleCount: z.number().int().min(0),
});

export type GenerateCategory = z.infer<typeof generateCategorySchema>;
