import { z } from "zod";
import { detectedPostFormatSchema } from "./post-formats.js";
import { judgeVerdictSchema } from "./judge.js";

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
  llm: subsystemStatusSchema,
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
    "archive_validation_failed",
    "archive_import_failed",
    "archive_storage_failed",
    "archive_activation_failed",
    "archive_not_found",
    "library_storage_failed",
    "library_not_found",
    "feedback_record_failed",
    "feedback_link_failed",
    "feedback_summary_failed",
    "not_found",
    "internal_error",
  ]),
  message: z.string().min(1).max(240),
  scope: z.enum([
    "app",
    "status",
    "settings",
    "writer",
    "deterministic",
    "judge",
    "archive",
    "library",
    "feedback",
    "route",
    "field",
  ]),
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

export const judgeProviderIdSchema = z.enum(["codex-cli", "claude-cli", "cursor-cli"]);

export type JudgeProviderId = z.infer<typeof judgeProviderIdSchema>;

// Record over the closed enum so a future provider id omission is a compile error.
// Single source of truth for provider labels — the engine declares no label strings.
export const judgeProviderLabels: Record<JudgeProviderId, string> = {
  "codex-cli": "Codex judge",
  "claude-cli": "Claude judge",
  "cursor-cli": "Cursor judge",
};

export const appSettingsSchema = z.object({
  engineBaseUrl: localEngineUrlSchema,
  storagePath: storagePathSchema,
  judgeProvider: judgeProviderIdSchema.default("codex-cli"),
  codexModel: z.string().optional(),
  claudeModel: z.string().optional(),
  cursorModel: z.string().optional(),
  accountProfile: z.string().trim().max(600).optional(),
  // Absolute path to a markdown knowledge base (the reach/format playbook) the
  // idea generator grounds its drafts in. Unset → generation uses the base
  // template only.
  knowledgeBasePath: z.string().trim().max(4096).optional(),
  showDeterministicDetails: z.boolean().default(true),
});

export const appSettingsResponseSchema = z.object({
  settings: appSettingsSchema,
  source: z.enum(["persisted", "defaults"]),
  updatedAt: z.string().datetime().optional(),
});

export const generateIdeaRequestSchema = z
  .object({
    idea: z
      .string()
      .trim()
      .min(1, "Idea is required.")
      .max(4_000, "Idea must be 4,000 characters or fewer.")
      .optional(),
    format: detectedPostFormatSchema.optional(),
    voiceProfileId: z.string().min(1).max(120).optional(),
    useKnownPostIds: z.array(z.string().min(1).max(240)).max(25).default([]).optional(),
  })
  .refine((v) => v.idea !== undefined || v.format !== undefined, {
    message: "At least one of idea or format must be provided.",
  });

export const generatedIdeaCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  format: z.enum(["one-liner", "mini-framework", "debate-question"]),
  text: z.string().min(1).max(8_000),
  verdict: judgeVerdictSchema.optional(),
  approved: z.boolean().optional(),
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
