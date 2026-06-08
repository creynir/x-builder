import {
  apiErrorSchema,
  generateIdeaRequestSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
  type AnalyzePostsResponse,
  type ApiError,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
  type GeneratedIdeaCandidate,
} from "@x-builder/shared";

export type WriterApiClient = {
  analyzePosts: (input: AnalyzePostsRequest) => Promise<AnalyzePostsResponse>;
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
};

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
  candidate: GeneratedIdeaCandidate;
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
      candidate: GeneratedIdeaCandidate;
      requestId: number;
      status: "loading";
    }
  | {
      candidate: GeneratedIdeaCandidate;
      item: ScoredAnalyzedPostItem;
      requestId: number;
      status: "ready";
    }
  | {
      candidate: GeneratedIdeaCandidate;
      item: ScoreFailedAnalyzedPostItem;
      requestId: number;
      status: "failed";
    }
  | {
      candidate: GeneratedIdeaCandidate;
      error: ApiError;
      requestId: number;
      status: "error";
    };

export type WriterPageModel = {
  activeFocusRequest: number;
  activeFocusTarget: string | null;
  activeGenerationRequestId: number | null;
  analysisByCandidateId: Record<string, CandidateAnalysisState>;
  appliedFollowers: number | undefined;
  candidates: GeneratedIdeaCandidate[];
  detail: CandidateDetailState;
  fieldError: string | null;
  followerDraft: string;
  followerError: string | null;
  idea: string;
  isGenerating: boolean;
  isScoring: boolean;
  lastPayload: GenerateIdeaRequest | null;
  routeError: ApiError | null;
  routeErrorOrigin: "analysis" | "generation" | null;
};

const emptyIdeaError = "Enter an idea before generating.";
const invalidFollowersError = "Enter your current follower count to estimate impressions.";
let nextAnalysisRequestId = 1;
let nextDetailRequestId = 1;
let nextGenerationRequestId = 1;

export function createInitialModel(): WriterPageModel {
  return {
    activeFocusRequest: 0,
    activeFocusTarget: null,
    activeGenerationRequestId: null,
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
    lastPayload: null,
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

function candidateAnalysisRequest(
  candidates: GeneratedIdeaCandidate[],
  followers: number | undefined,
  postCoachMode: AnalyzePostsRequest["presentation"]["postCoachMode"] = "preview",
): AnalyzePostsRequest {
  return {
    items: candidates.map((candidate) => ({
      id: candidate.id,
      text: candidate.text,
      sourceFormat: candidate.format,
    })),
    presentation: {
      postCoachMode,
    },
    scoringContext: followers === undefined ? {} : { followers },
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
  candidates: GeneratedIdeaCandidate[],
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
  candidate: GeneratedIdeaCandidate,
  item: AnalyzedPostItem,
): CandidateAnalysisState {
  const candidateItem = {
    ...item,
    sourceFormat: candidate.format,
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
  currentCandidates: GeneratedIdeaCandidate[],
  requestedCandidates: GeneratedIdeaCandidate[],
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

async function requestAnalysis(
  apiClient: WriterApiClient,
  candidates: GeneratedIdeaCandidate[],
  followers: number | undefined,
  postCoachMode: AnalyzePostsRequest["presentation"]["postCoachMode"] = "preview",
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
      candidateAnalysisRequest(candidates, followers, postCoachMode),
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
    return {
      ...model,
      analysisByCandidateId:
        options.analysisRequestId === null
          ? {}
          : createLoadingAnalysis(result.candidates, options.analysisRequestId),
      activeGenerationRequestId: null,
      candidates: result.candidates,
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
  requestedCandidates: GeneratedIdeaCandidate[],
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
  candidate: GeneratedIdeaCandidate,
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
    sourceFormat: candidate.format,
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
  candidates: GeneratedIdeaCandidate[],
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

function markAnalysisStale(
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
    const latestFollowerContext = parseFollowerDraft(currentModel.followerDraft);
    const requestedFollowers =
      latestFollowerContext.type === "valid" ? latestFollowerContext.followers : undefined;
    currentModel = publishLatest(publish, currentModel, (latestModel) =>
      applyParsedFollowers(latestModel, latestFollowerContext),
    );
    const analysisResult = await requestAnalysis(
      apiClient,
      generationResult.candidates,
      requestedFollowers,
    );
    currentModel = publishLatest(
      publish,
      currentModel,
      (latestModel) =>
        applyAnalysisResult(
          latestModel,
          generationResult.candidates,
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
  candidates: GeneratedIdeaCandidate[],
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

export async function runApplyFollowers(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  return runAnalysisForCandidates(apiClient, model, model.candidates, publish);
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
