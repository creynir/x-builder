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

export type CandidateAnalysisState =
  | {
      status: "idle";
    }
  | {
      status: "loading";
    }
  | {
      item: AnalyzedPostItem;
      status: "ready";
    }
  | {
      item: AnalyzedPostItem;
      status: "failed";
    }
  | {
      item: AnalyzedPostItem;
      status: "stale";
    };

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
      status: "loading";
    }
  | {
      candidate: GeneratedIdeaCandidate;
      item: ScoredAnalyzedPostItem;
      status: "ready";
    }
  | {
      candidate: GeneratedIdeaCandidate;
      item: ScoreFailedAnalyzedPostItem;
      status: "failed";
    };

export type WriterPageModel = {
  activeFocusTarget: string | null;
  analysisByCandidateId: Record<string, CandidateAnalysisState>;
  appliedFollowers: number | undefined;
  candidates: GeneratedIdeaCandidate[];
  detail: CandidateDetailState;
  fieldError: string | null;
  followerDraft: string;
  followerError: string | null;
  idea: string;
  isGenerating: boolean;
  lastPayload: GenerateIdeaRequest | null;
  routeError: ApiError | null;
};

const emptyIdeaError = "Enter an idea before generating.";
const invalidFollowersError = "Enter your current follower count to estimate impressions.";

export function createInitialModel(): WriterPageModel {
  return {
    activeFocusTarget: null,
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
    lastPayload: null,
    routeError: null,
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
): Record<string, CandidateAnalysisState> {
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.id,
      {
        status: "loading" as const,
      },
    ]),
  );
}

function createScoreFailedItem(
  candidate: GeneratedIdeaCandidate,
  error: ApiError,
): ScoreFailedAnalyzedPostItem {
  return {
    status: "score_failed",
    id: candidate.id,
    text: candidate.text,
    sourceFormat: candidate.format,
    reason: error.code,
    message: error.message,
    retryable: error.retryable,
  };
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
  result: Awaited<ReturnType<typeof requestGeneration>>,
  options: {
    analysisPending: boolean;
  },
): WriterPageModel {
  if (result.type === "success") {
    return {
      ...model,
      analysisByCandidateId: options.analysisPending
        ? createLoadingAnalysis(result.candidates)
        : {},
      candidates: result.candidates,
      fieldError: null,
      isGenerating: false,
      lastPayload: payload,
      routeError: null,
    };
  }

  const ideaFieldError = result.error.fieldErrors?.idea?.[0];

  if (result.error.scope === "field" && ideaFieldError !== undefined) {
    return {
      ...model,
      fieldError: ideaFieldError,
      isGenerating: false,
      lastPayload: payload,
      routeError: null,
    };
  }

  return {
    ...model,
    fieldError: null,
    isGenerating: false,
    lastPayload: payload,
    routeError: result.error,
  };
}

function applyAnalysisResult(
  model: WriterPageModel,
  requestedCandidates: GeneratedIdeaCandidate[],
  result: Awaited<ReturnType<typeof requestAnalysis>>,
): WriterPageModel {
  if (!candidatesStillPresent(model.candidates, requestedCandidates)) {
    return model;
  }

  if (result.type === "error") {
    return {
      ...model,
      analysisByCandidateId: {
        ...model.analysisByCandidateId,
        ...Object.fromEntries(
          requestedCandidates.map((candidate) => [
            candidate.id,
            {
              item: createScoreFailedItem(candidate, result.error),
              status: "failed" as const,
            },
          ]),
        ),
      },
    };
  }

  const itemsById = new Map(result.items.map((item) => [item.id, item]));

  return {
    ...model,
    analysisByCandidateId: {
      ...model.analysisByCandidateId,
      ...Object.fromEntries(
        requestedCandidates.flatMap((candidate) => {
          const item = itemsById.get(candidate.id);

          return item === undefined
            ? []
            : [[candidate.id, analysisStateFromItem(candidate, item)]];
        }),
      ),
    },
  };
}

function applyDetailAnalysisResult(
  model: WriterPageModel,
  candidate: GeneratedIdeaCandidate,
  result: Awaited<ReturnType<typeof requestAnalysis>>,
): WriterPageModel {
  if (!candidatesStillPresent(model.candidates, [candidate])) {
    return model;
  }

  if (result.type === "error") {
    const item = createScoreFailedItem(candidate, result.error);

    return {
      ...model,
      detail: {
        candidate,
        item,
        status: "failed",
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
        item: createScoreFailedItem(candidate, fallbackError),
        status: "failed",
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
      analysisByCandidateId: {
        ...model.analysisByCandidateId,
        [candidate.id]: analysisStateFromItem(candidate, candidateItem),
      },
      detail: {
        candidate,
        item: candidateItem,
        status: "failed",
      },
    };
  }

  return {
    ...model,
    analysisByCandidateId: {
      ...model.analysisByCandidateId,
      [candidate.id]: analysisStateFromItem(candidate, candidateItem),
    },
    detail: {
      candidate,
      item: candidateItem,
      status: "ready",
    },
  };
}

function applyAnalysisLoading(
  model: WriterPageModel,
  candidates: GeneratedIdeaCandidate[],
): WriterPageModel {
  return {
    ...model,
    analysisByCandidateId: {
      ...model.analysisByCandidateId,
      ...createLoadingAnalysis(candidates),
    },
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

      return [candidateId, state];
    }),
  );
}

export function applyFollowerDraftChange(
  model: WriterPageModel,
  followerDraft: string,
): WriterPageModel {
  return {
    ...model,
    analysisByCandidateId: markAnalysisStale(model.analysisByCandidateId),
    followerDraft,
    followerError: null,
  };
}

export function applyIdeaChange(model: WriterPageModel, idea: string): WriterPageModel {
  return {
    ...model,
    analysisByCandidateId: markAnalysisStale(model.analysisByCandidateId),
    fieldError: null,
    idea,
  };
}

type PublishModel = (model: WriterPageModel) => void;

type GenerationStart =
  | {
      model: WriterPageModel;
      type: "blocked";
    }
  | {
      followerContext: FollowersParseResult;
      model: WriterPageModel;
      payload: GenerateIdeaRequest;
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
        fieldError: null,
        isGenerating: true,
        lastPayload: payloadResult.payload,
      },
      followerContext,
    ),
    payload: payloadResult.payload,
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
        isGenerating: true,
      },
      followerContext,
    ),
    payload: model.lastPayload,
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
  let currentModel = applyGenerationResult(start.model, start.payload, generationResult, {
    analysisPending: start.followerContext.type === "valid",
  });
  publish(currentModel);

  if (generationResult.type === "success" && start.followerContext.type === "valid") {
    const analysisResult = await requestAnalysis(
      apiClient,
      generationResult.candidates,
      start.followerContext.followers,
    );
    currentModel = applyAnalysisResult(
      currentModel,
      generationResult.candidates,
      analysisResult,
    );
    publish(currentModel);
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

export async function runApplyFollowers(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  publish: PublishModel,
): Promise<WriterPageModel> {
  const followerContext = parseFollowerDraft(model.followerDraft);
  let currentModel = applyParsedFollowers(model, followerContext);

  if (followerContext.type === "error" || currentModel.candidates.length === 0) {
    publish(currentModel);
    return currentModel;
  }

  const { candidates } = currentModel;

  currentModel = applyAnalysisLoading(currentModel, candidates);
  publish(currentModel);

  const analysisResult = await requestAnalysis(
    apiClient,
    candidates,
    followerContext.followers,
  );
  currentModel = applyAnalysisResult(currentModel, candidates, analysisResult);
  publish(currentModel);

  return currentModel;
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

  const followerContext = parseFollowerDraft(model.followerDraft);
  let currentModel = applyParsedFollowers(model, followerContext);

  if (followerContext.type === "error") {
    publish(currentModel);
    return currentModel;
  }

  currentModel = applyAnalysisLoading(currentModel, [candidate]);
  publish(currentModel);

  const analysisResult = await requestAnalysis(
    apiClient,
    [candidate],
    followerContext.followers,
  );
  currentModel = applyAnalysisResult(currentModel, [candidate], analysisResult);
  publish(currentModel);

  return currentModel;
}

export async function runOpenDetails(
  apiClient: WriterApiClient,
  model: WriterPageModel,
  itemId: string,
  publish: PublishModel,
): Promise<WriterPageModel> {
  const candidate = model.candidates.find((item) => item.id === itemId);

  if (candidate === undefined) {
    return model;
  }

  const followerContext = parseFollowerDraft(model.followerDraft);
  let currentModel = applyParsedFollowers(
    {
      ...model,
      activeFocusTarget: null,
      detail: {
        candidate,
        status: "loading",
      },
    },
    followerContext,
  );

  publish(currentModel);

  if (followerContext.type === "error") {
    const item = createScoreFailedItem(candidate, {
      code: "validation_failed",
      message: followerContext.error,
      retryable: true,
      scope: "field",
      status: 400,
    });

    currentModel = {
      ...currentModel,
      detail: {
        candidate,
        item,
        status: "failed",
      },
    };
    publish(currentModel);
    return currentModel;
  }

  const analysisResult = await requestAnalysis(
    apiClient,
    [candidate],
    followerContext.followers,
    "expanded",
  );
  currentModel = applyDetailAnalysisResult(currentModel, candidate, analysisResult);
  publish(currentModel);

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
    activeFocusTarget: `candidate-details:${model.detail.candidate.id}`,
  };
}
