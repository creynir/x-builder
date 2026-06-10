import { z } from "zod";

const localEngineUrlMessage = "Engine base URL must use http(s) localhost or 127.0.0.1.";

const localEngineUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}, localEngineUrlMessage);

export const readinessStateSchema = z.enum([
  "checking",
  "ready",
  "partial",
  "unavailable",
  "failed",
  "stale",
  "disabled",
  "unconfigured",
]);

export const subsystemStatusSchema = z.object({
  state: readinessStateSchema,
  label: z.string().min(1).max(80),
  message: z.string().max(240).optional(),
  retryable: z.boolean().default(true),
  checkedAt: z.string().datetime(),
  details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const appStatusSchema = z.object({
  overall: z.enum(["ready", "partial", "unavailable"]),
  version: z.string().min(1),
  generatedAt: z.string().datetime(),
  engine: subsystemStatusSchema,
  deterministic: subsystemStatusSchema,
  codex: subsystemStatusSchema,
  storage: subsystemStatusSchema,
  lastRun: z.object({
    state: z.enum(["none", "completed", "failed", "unknown"]),
    completedAt: z.string().datetime().optional(),
    ideaId: z.string().optional(),
  }),
});

export const apiErrorSchema = z.object({
  code: z.enum([
    "validation_failed",
    "engine_unreachable",
    "request_timeout",
    "invalid_response",
    "status_unavailable",
    "settings_load_failed",
    "settings_persist_failed",
    "generation_failed",
    "deterministic_analysis_failed",
    "judge_failed",
    "not_found",
    "internal_error",
  ]),
  message: z.string().min(1).max(240),
  scope: z.enum(["app", "status", "settings", "writer", "deterministic", "judge", "route", "field"]),
  retryable: z.boolean(),
  status: z.number().int().min(100).max(599).optional(),
  fieldErrors: z.record(z.array(z.string())).optional(),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().optional(),
});

const storagePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) => !value.split(/[\\/]+/).includes(".."),
    "Storage path must not contain parent-directory (..) segments.",
  );

export const appSettingsSchema = z.object({
  engineBaseUrl: localEngineUrlSchema,
  storagePath: storagePathSchema,
  codexCommandLabel: z.string().min(1).max(80).default("Codex judge"),
  runCodexJudgeAfterGeneration: z.boolean().default(false),
  showDeterministicDetails: z.boolean().default(true),
});

export const appSettingsResponseSchema = z.object({
  settings: appSettingsSchema,
  source: z.enum(["persisted", "defaults"]),
  updatedAt: z.string().datetime().optional(),
});

export const generateIdeaRequestSchema = z.object({
  idea: z
    .string()
    .trim()
    .min(1, "Idea is required.")
    .max(4_000, "Idea must be 4,000 characters or fewer."),
  voiceProfileId: z.string().min(1).max(120).optional(),
  useKnownPostIds: z.array(z.string().min(1).max(240)).default([]).optional(),
});

export const generatedIdeaCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  format: z.enum(["one-liner", "mini-framework", "debate-question"]),
  text: z.string().min(1).max(8_000),
});

export const generateIdeaResponseSchema = z.object({
  candidates: z.array(generatedIdeaCandidateSchema).length(3),
});

export const routeConfigSchema = z.object({
  id: z.enum(["writer", "voice", "library", "settings"]),
  label: z.string().min(1).max(40),
  path: z.enum(["/writer", "/voice", "/library", "/settings"]),
  title: z.string().min(1).max(60),
  enabled: z.boolean(),
  placeholder: z.boolean(),
  navOrder: z.number().int().min(0),
  requiresBackend: z.boolean().default(false),
});

export type ReadinessState = z.infer<typeof readinessStateSchema>;
export type SubsystemStatus = z.infer<typeof subsystemStatusSchema>;
export type AppStatus = z.infer<typeof appStatusSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsResponse = z.infer<typeof appSettingsResponseSchema>;
export type GenerateIdeaRequest = z.infer<typeof generateIdeaRequestSchema>;
export type GeneratedIdeaCandidate = z.infer<typeof generatedIdeaCandidateSchema>;
export type GenerateIdeaResponse = z.infer<typeof generateIdeaResponseSchema>;
export type RouteConfig = z.infer<typeof routeConfigSchema>;
