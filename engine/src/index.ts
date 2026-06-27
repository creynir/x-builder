export * from "./server/server.js";
// Runner enablement (XOB-015): the runner constructs these in-process. The
// Fastify server is unchanged — these are barrel re-exports only.
export {
  JsonFileAppSettingsRepository,
  type AppSettingsRepository,
} from "./server/settings-repository.js";
export {
  PostLibraryStorageError,
  upgradePostLibraryStoreToV2,
  type PostLibraryRepository,
} from "./server/post-library-repository.js";
export { importPostLibraryJsonToSqlite } from "./server/import-post-library-json.js";
// SQLite-backed corpus store (LPF-002). Not wired into any host yet (LPF-003);
// re-exported so later features and tests can construct it through the barrel.
export {
  openEngineDatabase,
  migrations,
  type Migration,
} from "./server/open-engine-database.js";
export { SqlitePostLibraryRepository } from "./server/sqlite-post-library-repository.js";
export { makeTempEngineDb, seedPosts } from "./server/sqlite-test-helpers.js";
export * from "./capture/live-capture-service.js";
export * from "./capture/repetition-window-service.js";
export * from "./capture/live-context-resolver.js";
export * from "./suggest/generate-category-service.js";
export * from "./suggest/suggest-post-service.js";
// Transport-binding enablement (XOB-030): the runner constructs the LLM-backed
// and archive engine services in-process for the BoundEngineServices bundle.
// Named re-exports (not `export *`) keep the barrel collision-free.
export {
  JudgeDraftService,
  type JudgeDraft,
  type JudgeProviderResolver,
  type JudgeLlmGateway,
} from "./llm/judge-draft-service.js";
export { GenerateIdeasService } from "./llm/generate-ideas-service.js";
export {
  createGenerationGuidanceResolver,
  type CreateGenerationGuidanceResolverInput,
  type GenerationGuidanceResolver,
} from "./llm/generation-guidance.js";
export { ApplyJudgeSuggestionsService } from "./llm/apply-judge-suggestions-service.js";
export {
  ArchiveImportService,
  type ArchiveImportServiceOptions,
} from "./archive/archive-import-service.js";
export {
  ArchiveDerivedContextService,
  type ArchiveDerivedContextServiceOptions,
} from "./archive/archive-derived-context-service.js";
export { ArchiveStudioContextResolver } from "./archive/archive-studio-context-resolver.js";
// Provider wiring primitives the runner uses to construct one in-process
// StructuredLlmService for the generate / apply / suggest LLM services.
export { judgeProviderRegistry } from "./llm/judge-provider-registry.js";
export { createSettingsJudgeProviderResolver } from "./llm/judge-provider-resolver.js";
export { resolveWorkspaceRoot } from "./server/workspace-root.js";
export * from "./deterministic/deterministic-analysis-service.js";
export * from "./deterministic/analyzer.js";
export * from "./deterministic/format-classifier.js";
export * from "./deterministic/types.js";
export * from "./llm/structured-llm-service.js";
export * from "./llm/process-runner.js";
export * from "./llm/claude-cli-provider.js";
export * from "./llm/codex-cli-provider.js";
export * from "./llm/cursor-cli-provider.js";
export * from "./llm/structured-prompt-envelope.js";
export * from "./llm/cli-readiness-probe.js";
