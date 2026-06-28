import type {
  ActiveArchiveContext,
  ArchiveContextActivationResponse,
  ArchiveTweetsImportRequest,
  ArchiveTweetsImportResponse,
  ArchiveTweetsValidateRequest,
  ArchiveTweetsValidateResponse,
} from "./archive-import.js";
import type { ApplyJudgeSuggestionsRequest, ApplyJudgeSuggestionsResponse } from "./apply-judge-suggestions.js";
import type {
  GetFeedbackLoopSummaryRequest,
  GetFeedbackLoopSummaryResponse,
  LinkFeedbackPredictionRequest,
  LinkFeedbackPredictionResponse,
  RecordFeedbackPredictionRequest,
  RecordFeedbackPredictionResponse,
} from "./feedback-loop.js";
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
export const __xbuilder_recordFeedbackPrediction = "__xbuilder_recordFeedbackPrediction" as const;
export const __xbuilder_linkFeedbackPrediction = "__xbuilder_linkFeedbackPrediction" as const;
export const __xbuilder_getFeedbackLoopSummary = "__xbuilder_getFeedbackLoopSummary" as const;

// Concrete per-method binding-name literals, one per EngineTransport method, so
// dotted access (`ENGINE_TRANSPORT_BINDINGS.getStatus`) is a known `string`.
type EngineTransportBindings = {
  readonly [K in keyof EngineTransport]: `__xbuilder_${K & string}`;
};

// Intersect the concrete record with a readonly string index signature. Dotted
// access resolves through the concrete property (a known `string`), while
// bracket access by a `string` variable and `Object.keys`/`Object.values` resolve
// through the index signature (`string | undefined`, guarded at call sites under
// noUncheckedIndexedAccess) — satisfying both the transport binder and its tests.
export const ENGINE_TRANSPORT_BINDINGS: EngineTransportBindings &
  Readonly<Record<string, string>> = Object.freeze({
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
  recordFeedbackPrediction: __xbuilder_recordFeedbackPrediction,
  linkFeedbackPrediction: __xbuilder_linkFeedbackPrediction,
  getFeedbackLoopSummary: __xbuilder_getFeedbackLoopSummary,
});

// ---------------------------------------------------------------------------
// EngineTransport interface — 20 methods, structured-clone-safe JSON payloads
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
  recordFeedbackPrediction(request: RecordFeedbackPredictionRequest): Promise<RecordFeedbackPredictionResponse>;
  linkFeedbackPrediction(request: LinkFeedbackPredictionRequest): Promise<LinkFeedbackPredictionResponse>;
  getFeedbackLoopSummary(request?: GetFeedbackLoopSummaryRequest): Promise<GetFeedbackLoopSummaryResponse>;
}
