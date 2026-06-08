import {
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

import { RouteErrorBanner } from "../../shell/route-error-banner";
import { Badge, Button, Skeleton } from "../../ui/foundation";
import {
  CandidateDeterministicSummary,
  ManualScoringContextPanel,
} from "./deterministic/components";

export type WriterApiClient = {
  analyzePosts: (input: AnalyzePostsRequest) => Promise<AnalyzePostsResponse>;
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
};

type CandidateAnalysisState =
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

export type WriterPageProps = {
  apiClient: WriterApiClient;
  onOpenSettings: () => void;
};

type WriterPageModel = {
  analysisByCandidateId: Record<string, CandidateAnalysisState>;
  appliedFollowers: number | undefined;
  candidates: GeneratedIdeaCandidate[];
  fieldError: string | null;
  followerDraft: string;
  followerError: string | null;
  idea: string;
  isGenerating: boolean;
  lastPayload: GenerateIdeaRequest | null;
  routeError: ApiError | null;
};

export type WriterPagePublicDriverOptions = WriterPageProps & {
  renderPage?: (props: WriterPageProps) => ReactElement;
};

export type WriterPagePublicDriver = {
  applyFollowers: () => Promise<string>;
  generate: () => Promise<string>;
  openSettings: () => void;
  render: () => string;
  retry: () => Promise<string>;
  retryScore: (itemId: string) => Promise<string>;
  updateFollowers: (followers: string) => string;
  updateIdea: (idea: string) => string;
};

const emptyIdeaError = "Enter an idea before generating.";
const invalidFollowersError = "Enter your current follower count to estimate impressions.";

function createInitialModel(): WriterPageModel {
  return {
    analysisByCandidateId: {},
    appliedFollowers: undefined,
    candidates: [],
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
  if (
    typeof error === "object" &&
    error !== null &&
    "apiError" in error
  ) {
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

function candidateLabel(format: GeneratedIdeaCandidate["format"]): string {
  return format;
}

function candidateAnalysisRequest(
  candidates: GeneratedIdeaCandidate[],
  followers: number | undefined,
): AnalyzePostsRequest {
  return {
    items: candidates.map((candidate) => ({
      id: candidate.id,
      text: candidate.text,
      sourceFormat: candidate.format,
    })),
    presentation: {
      postCoachMode: "preview",
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
): AnalyzedPostItem {
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

function analysisStateFromItem(item: AnalyzedPostItem): CandidateAnalysisState {
  if (item.status === "score_failed") {
    return {
      item,
      status: "failed",
    };
  }

  return {
    item,
    status: "ready",
  };
}

function candidatesStillPresent(
  currentCandidates: GeneratedIdeaCandidate[],
  requestedCandidates: GeneratedIdeaCandidate[],
): boolean {
  return requestedCandidates.every(
    (candidate) =>
      currentCandidates.some(
        (currentCandidate) =>
          currentCandidate.id === candidate.id &&
          currentCandidate.text === candidate.text,
      ),
  );
}

type WriterPageViewProps = WriterPageModel & {
  onApplyFollowers: () => void;
  onFollowersChange: (followers: string) => void;
  onGenerate: () => void;
  onIdeaChange: (idea: string) => void;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
  onRetryScore: (itemId: string) => Promise<void>;
};

function CandidateAnalysis({
  candidate,
  onApplyFollowers,
  onRetryScore,
  state,
}: {
  candidate: GeneratedIdeaCandidate;
  onApplyFollowers: () => void;
  onRetryScore: (itemId: string) => void;
  state: CandidateAnalysisState;
}): ReactElement {
  if (state.status === "ready" || state.status === "failed") {
    return (
      <CandidateDeterministicSummary
        item={state.item}
        onRetryScore={onRetryScore}
      />
    );
  }

  if (state.status === "stale") {
    return (
      <div className="xb-writer-candidate__analysis">
        <p>{candidate.text}</p>
        <CandidateDeterministicSummary
          item={state.item}
          onRetryScore={onRetryScore}
        />
        <p>Prediction needs refresh.</p>
        <Button onClick={onApplyFollowers} type="button" variant="secondary">
          Recompute prediction
        </Button>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        aria-busy="true"
        className="xb-writer-candidate__analysis"
        role="status"
      >
        <p>{candidate.text}</p>
        <p>Scoring candidate</p>
        <Skeleton height={72} label="Scoring candidate" width={480} />
      </div>
    );
  }

  return <p>{candidate.text}</p>;
}

function WriterPageView({
  analysisByCandidateId,
  appliedFollowers,
  candidates,
  fieldError,
  followerDraft,
  followerError,
  idea,
  isGenerating,
  onApplyFollowers,
  onFollowersChange,
  onGenerate,
  onIdeaChange,
  onOpenSettings,
  onRetry,
  onRetryScore,
  routeError,
}: WriterPageViewProps): ReactElement {
  const ideaErrorId = fieldError === null ? undefined : "writer-idea-error";
  const helperId = "writer-idea-helper";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onGenerate();
  };

  return (
    <section className="xb-writer-page" aria-label="Writer workspace">
      <RouteErrorBanner
        error={routeError}
        isRetrying={isGenerating}
        onOpenSettings={onOpenSettings}
        onRetry={onRetry}
      />
      <form
        aria-label="Idea input"
        aria-busy={isGenerating}
        className="xb-writer-form"
        onSubmit={handleSubmit}
      >
        <label className="xb-writer-form__label" htmlFor="writer-idea">
          Idea
        </label>
        <textarea
          aria-describedby={fieldError === null ? helperId : `${helperId} ${ideaErrorId}`}
          aria-invalid={fieldError === null ? undefined : true}
          id="writer-idea"
          onChange={(event) => onIdeaChange(event.target.value)}
          placeholder="Paste a raw idea or rough angle..."
          value={idea}
        />
        <p className="xb-writer-form__helper" id={helperId}>
          Start with the messy version. The engine will shape three first-pass directions.
        </p>
        {fieldError === null ? null : (
          <p className="xb-writer-form__error" id={ideaErrorId}>
            {fieldError}
          </p>
        )}
        <Button loading={isGenerating} type="submit" variant="primary">
          Generate
        </Button>
      </form>
      <ManualScoringContextPanel
        applyLabel="Recompute prediction"
        context={{
          followers: appliedFollowers,
          source: appliedFollowers === undefined ? "missing" : "manual",
          skipped: appliedFollowers === undefined,
        }}
        disabled={isGenerating}
        error={followerError}
        isStale={Object.values(analysisByCandidateId).some(
          (state) => state.status === "stale",
        )}
        onApplyFollowers={onApplyFollowers}
        onFollowersDraftChange={onFollowersChange}
        value={followerDraft}
      />
      <section
        aria-label="Generated candidates"
        aria-live="polite"
        className="xb-writer-results"
      >
        {isGenerating ? (
          <div className="xb-writer-results__skeletons">
            <Skeleton height={92} label="Generating candidate one" width={540} />
            <Skeleton height={92} label="Generating candidate two" width={540} />
            <Skeleton height={92} label="Generating candidate three" width={540} />
          </div>
        ) : null}
        {!isGenerating && candidates.length > 0 ? (
          <div className="xb-writer-candidates">
            {candidates.map((candidate) => (
              <article className="xb-writer-candidate" key={candidate.id}>
                <Badge variant="info">{candidateLabel(candidate.format)}</Badge>
                <CandidateAnalysis
                  candidate={candidate}
                  onApplyFollowers={onApplyFollowers}
                  onRetryScore={onRetryScore}
                  state={analysisByCandidateId[candidate.id] ?? { status: "idle" }}
                />
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}

type GenerationResult =
  | {
      candidates: GeneratedIdeaCandidate[];
      type: "success";
    }
  | {
      error: ApiError;
      type: "error";
    };

type AnalysisResult =
  | {
      items: AnalyzedPostItem[];
      type: "success";
    }
  | {
      error: ApiError;
      type: "error";
    };

async function requestGeneration(
  apiClient: WriterApiClient,
  payload: GenerateIdeaRequest,
): Promise<GenerationResult> {
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
): Promise<AnalysisResult> {
  try {
    const response = await apiClient.analyzePosts(
      candidateAnalysisRequest(candidates, followers),
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
  result: GenerationResult,
): WriterPageModel {
  if (result.type === "success") {
    return {
      ...model,
      analysisByCandidateId: createLoadingAnalysis(result.candidates),
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
  result: AnalysisResult,
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
            : [[candidate.id, analysisStateFromItem(item)]];
        }),
      ),
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

function applyFollowerDraftChange(
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

function applyFollowerValidation(
  model: WriterPageModel,
  followerDraft: string,
): WriterPageModel | { followers: number | undefined; model: WriterPageModel } {
  const parsedFollowers = parseFollowerDraft(followerDraft);

  if (parsedFollowers.type === "error") {
    return {
      ...model,
      followerError: parsedFollowers.error,
    };
  }

  return {
    followers: parsedFollowers.followers,
    model: {
      ...model,
      appliedFollowers: parsedFollowers.followers,
      followerError: null,
    },
  };
}

export function WriterPage({
  apiClient,
  onOpenSettings,
}: WriterPageProps): ReactElement {
  const [model, setModel] = useState(createInitialModel);

  const applyFollowers = () => {
    void (async () => {
      const validation = applyFollowerValidation(model, model.followerDraft);

      if (!("model" in validation)) {
        setModel(validation);
        return;
      }

      const nextModel = validation.model;

      if (nextModel.candidates.length === 0) {
        setModel(nextModel);
        return;
      }

      const { candidates } = nextModel;

      setModel(applyAnalysisLoading(nextModel, candidates));
      const result = await requestAnalysis(apiClient, candidates, validation.followers);
      setModel((current) => applyAnalysisResult(current, candidates, result));
    })();
  };

  const updateFollowers = (followers: string) => {
    setModel((current) => applyFollowerDraftChange(current, followers));
  };

  const updateIdea = (idea: string) => {
    setModel((current) => ({
      ...current,
      analysisByCandidateId: markAnalysisStale(current.analysisByCandidateId),
      fieldError: null,
      idea,
    }));
  };

  const generate = () => {
    void (async () => {
      const payloadResult = payloadFromIdea(model.idea);
      const followerValidation = applyFollowerValidation(model, model.followerDraft);

      if (payloadResult.type === "field-error") {
        setModel((current) => ({
          ...current,
          fieldError: payloadResult.fieldError,
          routeError: null,
        }));
        return;
      }

      if (!("model" in followerValidation)) {
        setModel(followerValidation);
        return;
      }

      const { payload } = payloadResult;
      const nextModel = followerValidation.model;

      setModel({
        ...nextModel,
        fieldError: null,
        isGenerating: true,
        lastPayload: payload,
      });
      const result = await requestGeneration(apiClient, payload);
      setModel((current) => applyGenerationResult(current, payload, result));

      if (result.type === "success") {
        const analysisResult = await requestAnalysis(
          apiClient,
          result.candidates,
          followerValidation.followers,
        );
        setModel((current) =>
          applyAnalysisResult(current, result.candidates, analysisResult),
        );
      }
    })();
  };

  const retry = async () => {
    const payload = model.lastPayload;

    if (payload === null) {
      return;
    }

    const followerValidation = applyFollowerValidation(model, model.followerDraft);

    if (!("model" in followerValidation)) {
      setModel(followerValidation);
      return;
    }

    setModel((current) => ({
      ...current,
      appliedFollowers: followerValidation.followers,
      followerError: null,
      isGenerating: true,
    }));
    const result = await requestGeneration(apiClient, payload);
    setModel((current) => applyGenerationResult(current, payload, result));

    if (result.type === "success") {
      const analysisResult = await requestAnalysis(
        apiClient,
        result.candidates,
        followerValidation.followers,
      );
      setModel((current) =>
        applyAnalysisResult(current, result.candidates, analysisResult),
      );
    }
  };

  const retryScore = async (itemId: string) => {
    const candidate = model.candidates.find((item) => item.id === itemId);

    if (candidate === undefined) {
      return;
    }

    setModel((current) => applyAnalysisLoading(current, [candidate]));
    const result = await requestAnalysis(apiClient, [candidate], model.appliedFollowers);
    setModel((current) => applyAnalysisResult(current, [candidate], result));
  };

  return (
    <WriterPageView
      {...model}
      onApplyFollowers={applyFollowers}
      onFollowersChange={updateFollowers}
      onGenerate={generate}
      onIdeaChange={updateIdea}
      onOpenSettings={onOpenSettings}
      onRetry={retry}
      onRetryScore={retryScore}
    />
  );
}

function renderDriverPage(
  onOpenSettings: () => void,
  model: WriterPageModel,
) {
  return renderToStaticMarkup(
    <WriterPageView
      {...model}
      onApplyFollowers={() => undefined}
      onFollowersChange={() => undefined}
      onGenerate={() => undefined}
      onIdeaChange={() => undefined}
      onOpenSettings={onOpenSettings}
      onRetry={async () => undefined}
      onRetryScore={async () => undefined}
    />,
  );
}

export function createWriterPagePublicDriver(
  options: WriterPagePublicDriverOptions,
): WriterPagePublicDriver {
  let model = createInitialModel();

  const render = () => renderDriverPage(options.onOpenSettings, model);

  const applyFollowers = async () => {
    const validation = applyFollowerValidation(model, model.followerDraft);

    if (!("model" in validation)) {
      model = validation;
      return render();
    }

    model = validation.model;

    if (model.candidates.length === 0) {
      return render();
    }

    const { candidates } = model;

    model = applyAnalysisLoading(model, candidates);
    model = applyAnalysisResult(
      model,
      candidates,
      await requestAnalysis(options.apiClient, candidates, validation.followers),
    );

    return render();
  };

  const generate = async () => {
    const payloadResult = payloadFromIdea(model.idea);
    const followerValidation = applyFollowerValidation(model, model.followerDraft);

    if (payloadResult.type === "field-error") {
      model = {
        ...model,
        fieldError: payloadResult.fieldError,
        routeError: null,
      };
      return render();
    }

    if (!("model" in followerValidation)) {
      model = followerValidation;
      return render();
    }

    const { payload } = payloadResult;

    model = {
      ...followerValidation.model,
      fieldError: null,
      isGenerating: true,
      lastPayload: payload,
    };
    const result = await requestGeneration(options.apiClient, payload);
    model = applyGenerationResult(model, payload, result);

    if (result.type === "success") {
      const { candidates } = result;
      model = applyAnalysisResult(
        model,
        candidates,
        await requestAnalysis(options.apiClient, candidates, followerValidation.followers),
      );
    }

    return render();
  };

  return {
    applyFollowers,
    generate,
    openSettings: () => {
      options.onOpenSettings();
    },
    render,
    retry: async () => {
      const payload = model.lastPayload;

      if (payload === null) {
        return render();
      }

      const followerValidation = applyFollowerValidation(model, model.followerDraft);

      if (!("model" in followerValidation)) {
        model = followerValidation;
        return render();
      }

      model = {
        ...followerValidation.model,
        isGenerating: true,
      };
      const result = await requestGeneration(options.apiClient, payload);
      model = applyGenerationResult(model, payload, result);

      if (result.type === "success") {
        const { candidates } = result;
        model = applyAnalysisResult(
          model,
          candidates,
          await requestAnalysis(options.apiClient, candidates, followerValidation.followers),
        );
      }

      return render();
    },
    retryScore: async (itemId: string) => {
      const candidate = model.candidates.find((item) => item.id === itemId);

      if (candidate === undefined) {
        return render();
      }

      model = applyAnalysisLoading(model, [candidate]);
      model = applyAnalysisResult(
        model,
        [candidate],
        await requestAnalysis(options.apiClient, [candidate], model.appliedFollowers),
      );

      return render();
    },
    updateFollowers: (followers: string) => {
      model = applyFollowerDraftChange(model, followers);
      return render();
    },
    updateIdea: (idea: string) => {
      model = {
        ...model,
        analysisByCandidateId: markAnalysisStale(model.analysisByCandidateId),
        fieldError: null,
        idea,
      };
      return render();
    },
  };
}
