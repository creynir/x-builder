import {
  apiErrorSchema,
  generateIdeaRequestSchema,
  scoringContextSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type ApiError,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
  type GeneratedIdeaCandidate,
  type JudgeDraftRequest,
  type JudgeDraftResponse,
  type JudgeSignals,
  type JudgeVerdict,
  type RepeatHistoryEntry,
  type ScoringContext,
} from "@x-builder/shared";

export type WriterApiClient = {
  analyzePosts: (input: AnalyzePostsRequest) => Promise<AnalyzePostsResponse>;
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
  judgeDraft: (input: JudgeDraftRequest) => Promise<JudgeDraftResponse>;
};

export type JudgeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; verdict: JudgeVerdict; model: string }
  | { status: "failed"; error: ApiError };

export type WriterCandidate = {
  format?: GeneratedIdeaCandidate["format"];
  id: string;
  source: "draft" | "generated";
  text: string;
};

export type AdvancedContext = {
  trailingMedianImpressions?: number;
  repeatHistory?: { similarInLast7Days: boolean; date?: string };
  plannedHourUtc?: number;
  willAttachMedia?: boolean;
  accountAgeYears?: number;
};

export type RefinementState =
  | { status: "idle" }
  | { status: "running"; requestId: number }
  | { status: "refined"; requestId: number }
  | { status: "skipped" };

type CandidateReadyAnalysisState = {
  item: AnalyzedPostItem;
  status: "ready";
};

type CandidateFailedAnalysisState = {
  item: AnalyzedPostItem;
  status: "failed";
};

type CandidateStaleAnalysisState = {
  item: AnalyzedPostItem;
  status: "stale";
};

type CandidateUnavailableAnalysisState = {
  candidate: WriterCandidate;
  error: ApiError;
  status: "unavailable";
};

type CandidateVisibleAnalysisState =
  | CandidateFailedAnalysisState
  | CandidateReadyAnalysisState
  | CandidateStaleAnalysisState;

export type CandidateAnalysisState =
  | {
      status: "idle";
    }
  | {
      previous?: CandidateVisibleAnalysisState;
      requestId: number;
      status: "loading";
    }
  | CandidateUnavailableAnalysisState
  | CandidateVisibleAnalysisState;

type ScoredAnalyzedPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;
type ScoreFailedAnalyzedPostItem = Extract<
  AnalyzedPostItem,
  { status: "score_failed" }
>;

export type CandidateDetailState =
  | {
      status: "closed";
    }
  | {
      candidate: WriterCandidate;
      requestId: number;
      status: "loading";
    }
  | {
      candidate: WriterCandidate;
      item: ScoredAnalyzedPostItem;
      requestId: number;
      status: "ready";
    }
  | {
      candidate: WriterCandidate;
      item: ScoreFailedAnalyzedPostItem;
      requestId: number;
      status: "failed";
    }
  | {
      candidate: WriterCandidate;
      error: ApiError;
      requestId: number;
      status: "error";
    };

export type WriterPageModel = {
  activeFocusRequest: number;
  activeFocusTarget: string | null;
  activeGenerationRequestId: number | null;
  advancedContext: AdvancedContext;
  analysisByCandidateId: Record<string, CandidateAnalysisState>;
  appliedFollowers: number | undefined;
  candidates: WriterCandidate[];
  detail: CandidateDetailState;
  fieldError: string | null;
  followerDraft: string;
  followerError: string | null;
  idea: string;
  isGenerating: boolean;
  isScoring: boolean;
  judge: JudgeState;
  lastPayload: GenerateIdeaRequest | null;
  refinement: RefinementState;
  routeError: ApiError | null;
  routeErrorOrigin: "analysis" | "generation" | null;
};

const emptyIdeaError = "Enter an idea before generating.";
const invalidFollowersError = "Enter your current follower count to estimate impressions.";
let nextAnalysisRequestId = 1;
let nextDetailRequestId = 1;
let nextGenerationRequestId = 1;
let nextRefineRequestId = 1;

export function createInitialModel(): WriterPageModel {
  return {
    activeFocusRequest: 0,
    activeFocusTarget: null,
    activeGenerationRequestId: null,
    advancedContext: {},
    analysisByCandidateId: {},
    appliedFollowers: undefined,
    candidates: [],
    detail: {
      status: "closed",
    },
    fieldError: null,
    followerDraft: "",
    followerError: null,
    idea: "",
    isGenerating: false,
    isScoring: false,
    judge: { status: "idle" },
    lastPayload: null,
    refinement: { status: "idle" },
    routeError: null,
    routeErrorOrigin: null,
  };
}

function normalizeWriterError(error: unknown): ApiError {
  if (typeof error === "object" && error !== null && "apiError" in error) {
    const parsed = apiErrorSchema.safeParse((error as { apiError: unknown }).apiError);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return {
    code: "generation_failed",
    message: "Generation failed. Your idea is still here.",
    retryable: true,
    scope: "writer",
    status: 500,
  };
}

function normalizeJudgeError(error: unknown): ApiError {
  if (typeof error === "object" && error !== null && "apiError" in error) {
    const parsed = apiErrorSchema.safeParse((error as { apiError: unknown }).apiError);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return {
    code: "judge_failed",
    message: "The judge could not score this draft. Try again.",
    retryable: true,
    scope: "judge",
    status: 503,
  };
}

function normalizeAnalysisError(error: unknown): ApiError {
  const normalizedError = normalizeWriterError(error);

  if (normalizedError.code !== "generation_failed") {
    return normalizedError;
  }

  return {
    ...normalizedError,
    code: "deterministic_analysis_failed",
    message: "Scoring failed for this candidate.",
  };
}

type PayloadResult =
  | {
      payload: GenerateIdeaRequest;
      type: "valid";
    }
  | {
      fieldError: string;
      type: "field-error";
    };

function payloadFromIdea(idea: string): PayloadResult {
  const trimmedIdea = idea.trim();

  if (trimmedIdea.length === 0) {
    return {
      fieldError: emptyIdeaError,
      type: "field-error",
    };
  }

  const parsed = generateIdeaRequestSchema.safeParse({
    idea: trimmedIdea,
  });

  if (!parsed.success) {
    return {
      fieldError: parsed.error.flatten().fieldErrors.idea?.[0] ?? "Idea is invalid.",
      type: "field-error",
    };
  }

  return {
    payload: parsed.data,
    type: "valid",
  };
}

// Maps the optional advanced-context inputs onto a scoring context, dropping any
// empty/undefined field so an all-empty advanced context contributes no keys. The
// follower count is layered in separately so advanced inputs never disturb it.
function scoringContextFromAdvanced(
  followers: number | undefined,
  advancedContext: AdvancedContext,
  judgeSignals?: JudgeSignals,
): ScoringContext {
  const context: ScoringContext = {};

  if (followers !== undefined) {
    context.followers = followers;
  }

  assignValidScoringField(
    context,
    "trailingMedianImpressions",
    advancedContext.trailingMedianImpressions,
  );
  assignValidScoringField(context, "plannedHourUtc", advancedContext.plannedHourUtc);
  assignValidScoringField(context, "willAttachMedia", advancedContext.willAttachMedia);
  assignValidScoringField(context, "accountAgeYears", advancedContext.accountAgeYears);

  const repeatHistoryEntry = repeatHistoryEntryFromAdvanced(advancedContext.repeatHistory);

  if (repeatHistoryEntry !== undefined) {
    context.repeatHistory = [repeatHistoryEntry];
  }

  if (judgeSignals !== undefined) {
    context.judgeSignals = judgeSignals;
  }

  return context;
}

// Includes an advanced field only when it both has a value and clears that
// field's own schema validation, so an out-of-range input (e.g. a planned hour
// past 23) is silently dropped from the request rather than sent or coerced.
function assignValidScoringField<Key extends keyof ScoringContext>(
  context: ScoringContext,
  key: Key,
  value: ScoringContext[Key] | undefined,
): void {
  if (value === undefined) {
    return;
  }

  if (scoringContextSchema.shape[key].safeParse(value).success) {
    context[key] = value;
  }
}

// One reported "similar post in the last 7 days" becomes a single repeat-history
// entry. A whitespace-only or absent date falls back to the current time so the
// entry always carries a schema-valid ISO `lastPostedAt`.
function repeatHistoryEntryFromAdvanced(
  repeatHistory: AdvancedContext["repeatHistory"],
): RepeatHistoryEntry | undefined {
  if (repeatHistory?.similarInLast7Days !== true) {
    return undefined;
  }

  const trimmedDate = repeatHistory.date?.trim() ?? "";
  const parsedDate = trimmedDate.length === 0 ? undefined : new Date(trimmedDate);
  const lastPostedAt =
    parsedDate !== undefined && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toISOString()
      : new Date().toISOString();

  return {
    format: "insight_share",
    countLast7d: 1,
    lastPostedAt,
  };
}

function candidateAnalysisRequest(
  candidates: WriterCandidate[],
  followers: number | undefined,
  advancedContext: AdvancedContext,
  postCoachMode: AnalyzePostsRequest["presentation"]["postCoachMode"] = "preview",
  judgeSignals?: JudgeSignals,
): AnalyzePostsRequest {
  return {
    items: candidates.map((candidate) => ({
      id: candidate.id,
      text: candidate.text,
      sourceFormat: candidate.source === "generated" ? candidate.format : undefined,
    })),
    presentation: {
      postCoachMode,
    },
    scoringContext: scoringContextFromAdvanced(followers, advancedContext, judgeSignals),
  };
}

type FollowersParseResult =
  | {
      followers: number | undefined;
      type: "valid";
    }
  | {
      error: string;
      type: "error";
    };

function parseFollowerDraft(followerDraft: string): FollowersParseResult {
  const trimmedFollowers = followerDraft.trim();

  if (trimmedFollowers.length === 0) {
    return {
      followers: undefined,
      type: "valid",
    };
  }

  const followers = Number(trimmedFollowers);

  if (!Number.isInteger(followers) || followers <= 0) {
    return {
      error: invalidFollowersError,
      type: "error",
    };
  }

  return {
    followers,
    type: "valid",
  };
}

function applyParsedFollowers(
  model: WriterPageModel,
  parsedFollowers: FollowersParseResult,
): WriterPageModel {
  if (parsedFollowers.type === "error") {
    return {
      ...model,
      appliedFollowers: undefined,
      followerError: parsedFollowers.error,
    };
  }

  return {
    ...model,
    appliedFollowers: parsedFollowers.followers,
    followerError: null,
  };
}

function createLoadingAnalysis(
  candidates: WriterCandidate[],
  requestId: number,
  analysisByCandidateId: Record<string, CandidateAnalysisState> = {},
): Record<string, CandidateAnalysisState> {
  return Object.fromEntries(
    candidates.map((candidate) => {
      const currentState = analysisByCandidateId[candidate.id];
      const previous =
        currentState?.status === "failed" ||
        currentState?.status === "ready" ||
        currentState?.status === "stale"
          ? currentState
          : currentState?.status === "loading"
            ? currentState.previous
            : undefined;

      return [
        candidate.id,
        previous === undefined
          ? {
              requestId,
              status: "loading" as const,
            }
          : {
              previous,
              requestId,
              status: "loading" as const,
            },
      ];
    }),
  );
}

function analysisStateFromItem(
  candidate: WriterCandidate,
  item: AnalyzedPostItem,
): CandidateAnalysisState {
  const candidateItem = {
    ...item,
    sourceFormat: candidate.source === "generated" ? candidate.format : undefined,
  };

  if (item.status === "score_failed") {
    return {
      item: candidateItem,
      status: "failed",
    };
  }

  return {
    item: candidateItem,
    status: "ready",
  };
}

function candidatesStillPresent(
  currentCandidates: WriterCandidate[],
  requestedCandidates: WriterCandidate[],
): boolean {
  return requestedCandidates.every((candidate) =>
    currentCandidates.some(
      (currentCandidate) =>
        currentCandidate.id === candidate.id && currentCandidate.text === candidate.text,
    ),
  );
}

async function requestGeneration(
  apiClient: WriterApiClient,
  payload: GenerateIdeaRequest,
): Promise<
  | {
      candidates: GeneratedIdeaCandidate[];
      type: "success";
    }
  | {
      error: ApiError;
      type: "error";
    }
> {
  try {
    const response = await apiClient.generateIdea(payload);

    return {
      candidates: response.candidates,
      type: "success",
    };
  } catch (error) {
    return {
      error: normalizeWriterError(error),
      type: "error",
    };
  }
}

function generatedCandidateFromApi(candidate: GeneratedIdeaCandidate): WriterCandidate {
  return {
    ...candidate,
    source: "generated",
  };
}

function draftCandidateFromIdea(idea: string): WriterCandidate | null {
  const trimmedIdea = idea.trim();

  if (trimmedIdea.length === 0) {
    return null;
  }

  return {
    id: "draft-post",
    source: "draft",
    text: trimmedIdea,
  };
}

async function requestAnalysis(
  apiClient: WriterApiClient,
  candidates: WriterCandidate[],
  followers: number | undefined,
  advancedContext: AdvancedContext,
  postCoachMode: AnalyzePostsRequest["presentation"]["postCoachMode"] = "preview",
  judgeSignals?: JudgeSignals,
): Promise<
  | {
      items: AnalyzedPostItem[];
      type: "success";
    }
  | {
      error: ApiError;
      type: "error";
    }
> {
  try {
    const response = await apiClient.analyzePosts(
      candidateAnalysisRequest(
        candidates,
        followers,
        advancedContext,
        postCoachMode,
        judgeSignals,
      ),
    );

    return {
      items: response.items,
      type: "success",
    };
  } catch (error) {
    return {
      error: normalizeAnalysisError(error),
      type: "error",
    };
  }
}

function applyGenerationResult(
  model: WriterPageModel,
  payload: GenerateIdeaRequest,
  requestId: number,
  result: Awaited<ReturnType<typeof requestGeneration>>,
  options: {
    analysisRequestId: number | null;
  },
): WriterPageModel {
  if (model.activeGenerationRequestId !== requestId) {
    return model;
  }

  if (result.type === "success") {
    const candidates = result.candidates.map(generatedCandidateFromApi);

    return {
      ...model,
      analysisByCandidateId:
        options.analysisRequestId === null
          ? {}
          : createLoadingAnalysis(candidates, options.analysisRequestId),
      activeGenerationRequestId: null,
      candidates,
      detail: {
        status: "closed",
      },
      fieldError: null,
      isGenerating: false,
      isScoring: options.analysisRequestId !== null,
      lastPayload: payload,
      routeError: null,
      routeErrorOrigin: null,
    };
  }

  const ideaFieldError = result.error.fieldErrors?.idea?.[0];

  if (result.error.scope === "field" && ideaFieldError !== undefined) {
    return {
      ...model,
      activeGenerationRequestId: null,
      fieldError: ideaFieldError,
      isGenerating: false,
      isScoring: false,
      lastPayload: payload,
      routeError: null,
      routeErrorOrigin: null,
    };
  }

  return {
    ...model,
    activeGenerationRequestId: null,
    fieldError: null,
    isGenerating: false,
    isScoring: false,
    lastPayload: payload,
    routeError: result.error,
    routeErrorOrigin: "generation",
  };
}

function applyAnalysisResult(
  model: WriterPageModel,
  requestedCandidates: WriterCandidate[],
  requestedFollowers: number | undefined,
  requestId: number,
  result: Awaited<ReturnType<typeof requestAnalysis>>,
): WriterPageModel {
  if (
    !candidatesStillPresent(model.candidates, requestedCandidates) ||
    !followerDraftStillMatches(model, requestedFollowers)
  ) {
    return model;
  }

  if (result.type === "error") {
    const nextAnalysisByCandidateId = {
      ...model.analysisByCandidateId,
    };
    let appliedToCurrentRequest = false;

    for (const candidate of requestedCandidates) {
      const currentState = nextAnalysisByCandidateId[candidate.id];

      if (currentState?.status !== "loading" || currentState.requestId !== requestId) {
        continue;
      }

      appliedToCurrentRequest = true;

      if (currentState.previous !== undefined) {
        nextAnalysisByCandidateId[candidate.id] = currentState.previous;
      } else {
        delete nextAnalysisByCandidateId[candidate.id];
      }
    }

    if (!appliedToCurrentRequest) {
      return model;
    }

    return {
      ...model,
      analysisByCandidateId: nextAnalysisByCandidateId,
      isScoring: false,
      routeError: result.error,
      routeErrorOrigin: "analysis",
    };
  }

  const itemsById = new Map(result.items.map((item) => [item.id, item]));

  const nextAnalysisByCandidateId = {
    ...model.analysisByCandidateId,
  };
  let appliedToCurrentRequest = false;

  for (const candidate of requestedCandidates) {
    const currentState = nextAnalysisByCandidateId[candidate.id];

    if (currentState?.status !== "loading" || currentState.requestId !== requestId) {
      continue;
    }

    appliedToCurrentRequest = true;

    const item = itemsById.get(candidate.id);

    nextAnalysisByCandidateId[candidate.id] =
      item === undefined
        ? {
            candidate,
            error: {
              code: "deterministic_analysis_failed",
              message: "Scoring did not return a result for this candidate.",
              retryable: true,
              scope: "writer",
              status: 500,
            },
            status: "unavailable",
          }
        : analysisStateFromItem(candidate, item);
  }

  if (!appliedToCurrentRequest) {
    return model;
  }

  return {
    ...model,
    analysisByCandidateId: nextAnalysisByCandidateId,
    isScoring: false,
    routeError: null,
    routeErrorOrigin: null,
  };
}

function applyDetailAnalysisResult(
  model: WriterPageModel,
  candidate: WriterCandidate,
  requestId: number,
  result: Awaited<ReturnType<typeof requestAnalysis>>,
): WriterPageModel {
  if (!candidatesStillPresent(model.candidates, [candidate])) {
    return model;
  }

  if (result.type === "error") {
    return {
      ...model,
      detail: {
        candidate,
        error: result.error,
        requestId,
        status: "error",
      },
    };
  }

  const item = result.items.find((analysisItem) => analysisItem.id === candidate.id);

  if (item === undefined) {
    const fallbackError: ApiError = {
      code: "deterministic_analysis_failed",
      message: "Could not load deterministic details.",
      retryable: true,
      scope: "writer",
      status: 500,
    };

    return {
      ...model,
      detail: {
        candidate,
        error: fallbackError,
        requestId,
        status: "error",
      },
    };
  }

  const candidateItem = {
    ...item,
    sourceFormat: candidate.source === "generated" ? candidate.format : undefined,
  };

  if (candidateItem.status === "score_failed") {
    return {
      ...model,
      detail: {
        candidate,
        item: candidateItem,
        requestId,
        status: "failed",
      },
    };
  }

  return {
    ...model,
    detail: {
      candidate,
      item: candidateItem,
      requestId,
      status: "ready",
    },
  };
}

function applyAnalysisLoading(
  model: WriterPageModel,
  candidates: WriterCandidate[],
  requestId: number,
): WriterPageModel {
  return {
    ...model,
    analysisByCandidateId: {
      ...model.analysisByCandidateId,
      ...createLoadingAnalysis(candidates, requestId, model.analysisByCandidateId),
    },
    isScoring: true,
    routeError: null,
    routeErrorOrigin: null,
  };
}

export function markAnalysisStale(
  analysisByCandidateId: Record<string, CandidateAnalysisState>,
): Record<string, CandidateAnalysisState> {
  return Object.fromEntries(
    Object.entries(analysisByCandidateId).map(([candidateId, state]) => {
      if (state.status === "ready" || state.status === "failed") {
        return [
          candidateId,
          {
            item: state.item,
            status: "stale" as const,
          },
        ];
      }

      if (state.status === "loading") {
        return state.previous === undefined
          ? [
              candidateId,
              {
                status: "idle" as const,
              },
            ]
          : [
              candidateId,
              {
                item: state.previous.item,
                status: "stale" as const,
              },
            ];
      }

      return [candidateId, state];
    }),
  );
}

function followerDraftStillMatches(
  model: WriterPageModel,
  requestedFollowers: number | undefined,
): boolean {
  const latestFollowers = parseFollowerDraft(model.followerDraft);

  if (latestFollowers.type === "error") {
    return requestedFollowers === undefined;
  }

  return latestFollowers.followers === requestedFollowers;
}

export function applyFollowerDraftChange(
  model: WriterPageModel,
  followerDraft: string,
): WriterPageModel {
  return {
    ...model,
    analysisByCandidateId: markAnalysisStale(model.analysisByCandidateId),
    detail: {
      status: "closed",
    },
    followerDraft,
    followerError: null,
    isScoring: false,
    refinement: { status: "skipped" },
  };
}

export function applyAdvancedContextChange(
  model: WriterPageModel,
  patch: AdvancedContext,
): WriterPageModel {
  return {
    ...model,
    advancedContext: {
      ...model.advancedContext,
      ...patch,
    },
    analysisByCandidateId: markAnalysisStale(model.analysisByCandidateId),
    refinement: { status: "idle" },
  };
}

export function applyIdeaChange(model: WriterPageModel, idea: string): WriterPageModel {
  return {
    ...model,
    analysisByCandidateId: markAnalysisStale(model.analysisByCandidateId),
    detail: {
      status: "closed",
    },
    fieldError: null,
    idea,
    isScoring: false,
    refinement: { status: "skipped" },
  };
}

type PublishModel = (
  update: WriterPageModel | ((current: WriterPageModel) => WriterPageModel),
) => void;

function publishLatest(
  publish: PublishModel,
  fallbackModel: WriterPageModel,
  update: (current: WriterPageModel) => WriterPageModel,
): WriterPageModel {
  let nextModel = fallbackModel;

  publish((currentModel) => {
    nextModel = update(currentModel);
    return nextModel;
  });

  return nextModel;
}

type GenerationStart =
  | {
      model: WriterPageModel;
      type: "blocked";
    }
  | {
      followerContext: FollowersParseResult;
      model: WriterPageModel;
      payload: GenerateIdeaRequest;
      requestId: number;
      type: "ready";
    };

function beginGeneration(model: WriterPageModel): GenerationStart {
  const payloadResult = payloadFromIdea(model.idea);

  if (payloadResult.type === "field-error") {
    return {
      model: {
        ...model,
        fieldError: payloadResult.fieldError,
        routeError: null,
      },
      type: "blocked",
    };
  }

  const followerContext = parseFollowerDraft(model.followerDraft);

  return {
    followerContext,
    model: applyParsedFollowers(
      {
        ...model,
        activeGenerationRequestId: nextGenerationRequestId,
        fieldError: null,
        isGenerating: true,
        isScoring: false,
        lastPayload: payloadResult.payload,
      },
      followerContext,
    ),
    payload: payloadResult.payload,
    requestId: nextGenerationRequestId++,
    type: "ready",
  };
}

function beginRetry(model: WriterPageModel): GenerationStart {
  if (model.lastPayload === null) {
    return {
      model,
      type: "blocked",
    };
  }

  const followerContext = parseFollowerDraft(model.followerDraft);

  return {
    followerContext,
    model: applyParsedFollowers(
      {
        ...model,
        activeGenerationRequestId: nextGenerationRequestId,
        isGenerating: true,
        isScoring: false,
      },
      followerContext,
    ),
    payload: model.lastPayload,
    requestId: nextGenerationRequestId++,
    type: "ready",
  };
}

async function runGenerationFromStart(
  apiClient: WriterApiClient,
  start: GenerationStart,
  publish: PublishModel,
): Promise<WriterPageModel> {
  if (start.type === "blocked") {
    publish(start.model);
    return start.model;
  }

  publish(start.model);

  const generationResult = await requestGeneration(apiClient, start.payload);
  const analysisRequestId =
    generationResult.type === "success" ? nextAnalysisRequestId++ : null;
  let generationApplied = false;
  let currentModel = publishLatest(publish, start.model, (latestModel) => {
    const nextModel = applyGenerationResult(
      latestModel,
      start.payload,
      start.requestId,
      generationResult,
      {
        analysisRequestId,
      },
    );
    generationApplied = nextModel !== latestModel;
    return nextModel;
  });

  if (
    generationResult.type === "success" &&
    analysisRequestId !== null &&
    generationApplied
  ) {
    const requestedCandidates = generationResult.candidates.map(generatedCandidateFromApi);
    const latestFollowerContext = parseFollowerDraft(currentModel.followerDraft);
    const requestedFollowers =
      latestFollowerContext.type === "valid" ? latestFollowerContext.followers : undefined;
    currentModel = publishLatest(publish, currentModel, (latestModel) =>
      applyParsedFollowers(latestModel, latestFollowerContext),
    );
    const analysisResult = await requestAnalysis(
      apiClient,
      requestedCandidates,
      requestedFollowers,
      currentModel.advancedContext,
    );
    currentModel = publishLatest(
      publish,
      currentModel,
      (latestModel) =>
        applyAnalysisResult(
          latestModel,
          requestedCandidates,
          requestedFollowers,
          analysisRequestId,
          analysisResult,
        ),
    );
  }

  return currentModel;
}

export async function runGenerate(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  return runGenerationFromStart(apiClient, beginGeneration(model), publish);
}

export async function runRetry(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  return runGenerationFromStart(apiClient, beginRetry(model), publish);
}

async function runAnalysisForCandidates(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  candidates: WriterCandidate[],
  publish: PublishModel,
): Promise<WriterPageModel> {
  if (model.isScoring) {
    return model;
  }

  const followerContext = parseFollowerDraft(model.followerDraft);
  let currentModel = applyParsedFollowers(model, followerContext);
  const requestedFollowers =
    followerContext.type === "valid" ? followerContext.followers : undefined;

  if (candidates.length === 0) {
    publish(currentModel);
    return currentModel;
  }

  const requestId = nextAnalysisRequestId++;
  currentModel = applyAnalysisLoading(currentModel, candidates, requestId);
  publish(currentModel);

  const analysisResult = await requestAnalysis(
    apiClient,
    candidates,
    requestedFollowers,
    currentModel.advancedContext,
  );
  currentModel = publishLatest(publish, currentModel, (latestModel) =>
    applyAnalysisResult(
      latestModel,
      candidates,
      requestedFollowers,
      requestId,
      analysisResult,
    ),
  );

  return currentModel;
}

export async function runRetryAnalysis(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  return runAnalysisForCandidates(apiClient, model, model.candidates, publish);
}

export async function runAdvancedContextChange(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  patch: AdvancedContext,
  publish: PublishModel,
): Promise<WriterPageModel> {
  const nextModel = applyAdvancedContextChange(model, patch);
  publish(nextModel);

  return runAnalysisForCandidates(apiClient, nextModel, nextModel.candidates, publish);
}

export async function runApplyFollowers(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  return runAnalysisForCandidates(apiClient, model, model.candidates, publish);
}

export async function runScoreDraft(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  if (model.isGenerating || model.isScoring) {
    return model;
  }

  if (model.candidates.some((candidate) => candidate.source === "generated")) {
    return model;
  }

  const candidate = draftCandidateFromIdea(model.idea);

  if (candidate === null) {
    return model;
  }

  const nextModel: WriterPageModel = {
    ...model,
    analysisByCandidateId: {},
    candidates: [candidate],
    detail: {
      status: "closed",
    },
    fieldError: null,
    routeError: null,
    routeErrorOrigin: null,
  };

  return runAnalysisForCandidates(apiClient, nextModel, [candidate], publish);
}

// Finds the scored draft candidate whose text matches the current idea and whose
// prediction is available — the exact precondition the judge→refine pass needs to
// replace a deterministic reach estimate with a judge-refined one.
function refineTargetFor(
  model: WriterPageModel,
): { candidate: WriterCandidate } | null {
  const text = model.idea.trim();

  if (text.length === 0) {
    return null;
  }

  for (const candidate of model.candidates) {
    if (candidate.text !== text) {
      continue;
    }

    const state = model.analysisByCandidateId[candidate.id];

    if (
      state?.status === "ready" &&
      state.item.status === "scored" &&
      state.item.prediction.status === "available"
    ) {
      return { candidate };
    }
  }

  return null;
}

// Client two-pass flow: re-issues analyze for the already-scored draft carrying
// the judge's two reach scalars, then REPLACES the deterministic prediction with
// the judge-refined one. Pre/post-judge reach are different scales, so exactly one
// prediction is held per draft version — no diff is ever rendered.
export async function runTwoPassRefine(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  if (model.judge.status !== "ready") {
    return model;
  }

  const target = refineTargetFor(model);

  if (target === null) {
    return model;
  }

  const judgeSignals: JudgeSignals = {
    impressions: model.judge.verdict.scores.impressions,
    replies: model.judge.verdict.scores.replies,
  };

  const refineRequestId = nextRefineRequestId++;
  let currentModel = publishLatest(publish, model, (latestModel) => ({
    ...latestModel,
    refinement: { status: "running", requestId: refineRequestId },
  }));

  const followerContext = parseFollowerDraft(currentModel.followerDraft);
  const requestedFollowers =
    followerContext.type === "valid" ? followerContext.followers : undefined;

  const analysisResult = await requestAnalysis(
    apiClient,
    [target.candidate],
    requestedFollowers,
    currentModel.advancedContext,
    "preview",
    judgeSignals,
  );

  currentModel = publishLatest(publish, currentModel, (latestModel) => {
    if (
      latestModel.refinement.status !== "running" ||
      latestModel.refinement.requestId !== refineRequestId
    ) {
      return latestModel;
    }

    if (analysisResult.type === "error") {
      return {
        ...latestModel,
        refinement: { status: "skipped" },
        routeError: analysisResult.error,
        routeErrorOrigin: "analysis",
      };
    }

    if (latestModel.idea.trim() !== target.candidate.text) {
      return latestModel;
    }

    const refinedItem = analysisResult.items.find(
      (item) => item.id === target.candidate.id,
    );

    if (refinedItem === undefined) {
      return latestModel;
    }

    return {
      ...latestModel,
      analysisByCandidateId: {
        ...latestModel.analysisByCandidateId,
        [target.candidate.id]: analysisStateFromItem(target.candidate, refinedItem),
      },
      refinement: { status: "refined", requestId: refineRequestId },
    };
  });

  return currentModel;
}

export async function runJudgeDraft(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  if (model.judge.status === "loading") {
    return model;
  }

  const text = model.idea.trim();

  if (text.length === 0) {
    return model;
  }

  let nextModel = publishLatest(publish, model, (current) => ({
    ...current,
    judge: { status: "loading" },
  }));

  try {
    const response = await apiClient.judgeDraft({ text });

    nextModel = publishLatest(publish, nextModel, (current) => ({
      ...current,
      judge: { status: "ready", verdict: response.verdict, model: response.model },
    }));

    // The verdict is published before the refine pass so the JudgePanel renders
    // ahead of the second analyze call upgrading the deterministic prediction.
    nextModel = await runTwoPassRefine(apiClient, nextModel, publish);
  } catch (error) {
    nextModel = publishLatest(publish, nextModel, (current) => ({
      ...current,
      judge: { status: "failed", error: normalizeJudgeError(error) },
    }));
  }

  return nextModel;
}

export async function runRetryScore(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  itemId: string,
  publish: PublishModel,
): Promise<WriterPageModel> {
  const candidate = model.candidates.find((item) => item.id === itemId);

  if (candidate === undefined) {
    return model;
  }

  return runAnalysisForCandidates(apiClient, model, [candidate], publish);
}

export async function runOpenDetails(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  itemId: string,
  publish: PublishModel,
): Promise<WriterPageModel> {
  if (model.isScoring || model.detail.status === "loading") {
    return model;
  }

  const candidate = model.candidates.find((item) => item.id === itemId);

  if (candidate === undefined) {
    return model;
  }

  const requestId = nextDetailRequestId;
  nextDetailRequestId += 1;
  const followerContext = parseFollowerDraft(model.followerDraft);
  let currentModel = applyParsedFollowers(
    {
      ...model,
      activeFocusTarget: null,
      detail: {
        candidate,
        requestId,
        status: "loading",
      },
    },
    followerContext,
  );

  publish(currentModel);

  const requestedFollowers =
    followerContext.type === "valid" ? followerContext.followers : undefined;

  const analysisResult = await requestAnalysis(
    apiClient,
    [candidate],
    requestedFollowers,
    currentModel.advancedContext,
    "expanded",
  );

  publish((latestModel) => {
    if (
      latestModel.detail.status === "closed" ||
      latestModel.detail.requestId !== requestId ||
      latestModel.detail.candidate.id !== candidate.id ||
      latestModel.detail.candidate.text !== candidate.text
    ) {
      return latestModel;
    }

    currentModel = applyDetailAnalysisResult(
      latestModel,
      candidate,
      requestId,
      analysisResult,
    );
    return currentModel;
  });

  return currentModel;
}

export async function runRetryDetails(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  if (model.detail.status === "closed") {
    return model;
  }

  return runOpenDetails(apiClient, model, model.detail.candidate.id, publish);
}

export function closeDetails(model: WriterPageModel): WriterPageModel {
  return {
    ...model,
    detail: {
      status: "closed",
    },
  };
}

export function closeDetailsWithEscape(model: WriterPageModel): WriterPageModel {
  if (model.detail.status === "closed") {
    return model;
  }

  return {
    ...closeDetails(model),
    activeFocusRequest: model.activeFocusRequest + 1,
    activeFocusTarget: `candidate-details:${model.detail.candidate.id}`,
  };
}

export function focusManualFollowers(model: WriterPageModel): WriterPageModel {
  return {
    ...model,
    activeFocusRequest: model.activeFocusRequest + 1,
    activeFocusTarget: "manual-followers",
  };
}

export function shouldRetryAnalysis(model: WriterPageModel): boolean {
  return model.routeErrorOrigin === "analysis" && model.candidates.length > 0;
}
