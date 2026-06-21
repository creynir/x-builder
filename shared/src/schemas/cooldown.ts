import { z } from "zod";
import { detectedPostFormatSchema } from "./post-formats.js";

export const cooldownStatusSchema = z.enum(["clear", "warming", "cooldown"]);

export const cooldownSignalSchema = z.object({
  format: detectedPostFormatSchema,
  countInWindow: z.number().int().min(0),
  windowDays: z.number().int().min(1).max(90),
  lastPostedAt: z.string().datetime().optional(),
  status: cooldownStatusSchema,
  message: z.string().max(240),
});

export const cooldownReportSchema = z.object({
  windowDays: z.number().int().min(1).max(90),
  generatedAt: z.string().datetime(),
  corpusSource: z.enum(["live", "archive", "merged", "empty"]),
  signals: z.array(cooldownSignalSchema).max(40),
});

export type CooldownStatus = z.infer<typeof cooldownStatusSchema>;
export type CooldownSignal = z.infer<typeof cooldownSignalSchema>;
export type CooldownReport = z.infer<typeof cooldownReportSchema>;
