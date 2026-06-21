import type {
  ActiveArchiveContext,
  ArchiveContextActivationResponse,
  ArchiveTweetsImportRequest,
  ArchiveTweetsImportResponse,
  ArchiveTweetsValidateRequest,
  ArchiveTweetsValidateResponse,
} from "./archive-import.js";
import type { ApplyJudgeSuggestionsRequest, ApplyJudgeSuggestionsResponse } from "./apply-judge-suggestions.js";
import type { CaptureSummary } from "./x-live-capture.js";
import type { CooldownReport } from "./cooldown.js";
import type { GenerateCategory } from "./generate-category.js";
import type { JudgeDraftRequest, JudgeDraftResponse } from "./judge.js";
import type { OverlayReadiness } from "./overlay-readiness.js";
import type {
  AnalyzePostsRequest,
  AnalyzePostsResponse,
} from "./deterministic-analysis.js";
import type {
  AppSettings,
  AppSettingsResponse,
  AppStatus,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
} from "./shell.js";
import type { SuggestPostRequest, SuggestPostResponse } from "./suggest-post.js";

// ---------------------------------------------------------------------------
// Binding-name constants — one per method, frozen registry
// ---------------------------------------------------------------------------

export const __xbuilder_getOverlayReadiness = "__xbuilder_getOverlayReadiness" as const;
export const __xbuilder_getStatus = "__xbuilder_getStatus" as const;
export const __xbuilder_getSettings = "__xbuilder_getSettings" as const;
export const __xbuilder_updateSettings = "__xbuilder_updateSettings" as const;
export const __xbuilder_validateArchive = "__xbuilder_validateArchive" as const;
export const __xbuilder_importArchive = "__xbuilder_importArchive" as const;
export const __xbuilder_getActiveContext = "__xbuilder_getActiveContext" as const;
export const __xbuilder_activateContext = "__xbuilder_activateContext" as const;
export const __xbuilder_deactivateContext = "__xbuilder_deactivateContext" as const;
export const __xbuilder_analyzePosts = "__xbuilder_analyzePosts" as const;
export const __xbuilder_judgeDraft = "__xbuilder_judgeDraft" as const;
export const __xbuilder_generateIdeas = "__xbuilder_generateIdeas" as const;
export const __xbuilder_suggestPost = "__xbuilder_suggestPost" as const;
export const __xbuilder_getCooldown = "__xbuilder_getCooldown" as const;
export const __xbuilder_getCaptureSummary = "__xbuilder_getCaptureSummary" as const;
export const __xbuilder_getGenerateCategories = "__xbuilder_getGenerateCategories" as const;
export const __xbuilder_applyJudgeSuggestions = "__xbuilder_applyJudgeSuggestions" as const;

export const ENGINE_TRANSPORT_BINDINGS: Readonly<Record<string, string>> = Object.freeze({
  getOverlayReadiness: __xbuilder_getOverlayReadiness,
  getStatus: __xbuilder_getStatus,
  getSettings: __xbuilder_getSettings,
  updateSettings: __xbuilder_updateSettings,
  validateArchive: __xbuilder_validateArchive,
  importArchive: __xbuilder_importArchive,
  getActiveContext: __xbuilder_getActiveContext,
  activateContext: __xbuilder_activateContext,
  deactivateContext: __xbuilder_deactivateContext,
  analyzePosts: __xbuilder_analyzePosts,
  judgeDraft: __xbuilder_judgeDraft,
  generateIdeas: __xbuilder_generateIdeas,
  suggestPost: __xbuilder_suggestPost,
  getCooldown: __xbuilder_getCooldown,
  getCaptureSummary: __xbuilder_getCaptureSummary,
  getGenerateCategories: __xbuilder_getGenerateCategories,
  applyJudgeSuggestions: __xbuilder_applyJudgeSuggestions,
});

// ---------------------------------------------------------------------------
// EngineTransport interface — 17 methods, structured-clone-safe JSON payloads
// ---------------------------------------------------------------------------

export interface EngineTransport {
  getOverlayReadiness(): Promise<OverlayReadiness>;
  getStatus(): Promise<AppStatus>;
  getSettings(): Promise<AppSettingsResponse>;
  updateSettings(settings: AppSettings): Promise<AppSettingsResponse>;
  validateArchive(request: ArchiveTweetsValidateRequest): Promise<ArchiveTweetsValidateResponse>;
  importArchive(request: ArchiveTweetsImportRequest): Promise<ArchiveTweetsImportResponse>;
  getActiveContext(): Promise<ActiveArchiveContext>;
  activateContext(): Promise<ArchiveContextActivationResponse>;
  deactivateContext(): Promise<ArchiveContextActivationResponse>;
  analyzePosts(request: AnalyzePostsRequest): Promise<AnalyzePostsResponse>;
  judgeDraft(request: JudgeDraftRequest): Promise<JudgeDraftResponse>;
  generateIdeas(request: GenerateIdeaRequest): Promise<GenerateIdeaResponse>;
  suggestPost(request: SuggestPostRequest): Promise<SuggestPostResponse>;
  getCooldown(windowDays?: number): Promise<CooldownReport>;
  getCaptureSummary(): Promise<CaptureSummary>;
  getGenerateCategories(): Promise<GenerateCategory[]>;
  applyJudgeSuggestions(request: ApplyJudgeSuggestionsRequest): Promise<ApplyJudgeSuggestionsResponse>;
}
