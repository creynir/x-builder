import { z } from "zod";
import { subsystemStatusSchema } from "./shell.js";

export const captureReadinessStateSchema = z.enum(["ok", "paused", "layout_changed"]);

export const overlayReadinessSchema = z.object({
  staticEngine: subsystemStatusSchema,
  llm: subsystemStatusSchema,
  capture: z.object({
    state: captureReadinessStateSchema,
    label: z.string().max(80),
    message: z.string().max(240).optional(),
    lastCaptureAt: z.string().datetime().optional(),
    checkedAt: z.string().datetime(),
  }),
});

export type CaptureReadinessState = z.infer<typeof captureReadinessStateSchema>;
export type OverlayReadiness = z.infer<typeof overlayReadinessSchema>;
