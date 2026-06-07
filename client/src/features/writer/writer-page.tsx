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
import { CandidateDeterministicSummary } from "./deterministic/components";

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
  candidates: GeneratedIdeaCandidate[];
  fieldError: string | null;
  idea: string;
  isGenerating: boolean;
  lastPayload: GenerateIdeaRequest | null;
  routeError: ApiError | null;
};

export type WriterPagePublicDriverOptions = WriterPageProps & {
  renderPage?: (props: WriterPageProps) => ReactElement;
};

export type WriterPagePublicDriver = {
  generate: () => Promise<string>;
  openSettings: () => void;
  render: () => string;
  retry: () => Promise<string>;
  retryScore: (itemId: string) => Promise<string>;
  updateIdea: (idea: string) => string;
};

const emptyIdeaError = "Enter an idea before generating.";

function createInitialModel(): WriterPageModel {
  return {
    analysisByCandidateId: {},
    candidates: [],
    fieldError: null,
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
    scoringContext: {},
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
  onGenerate: () => void;
  onIdeaChange: (idea: string) => void;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
  onRetryScore: (itemId: string) => Promise<void>;
};

function CandidateAnalysis({
  candidate,
  onRetryScore,
  state,
}: {
  candidate: GeneratedIdeaCandidate;
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
        <p>Score needs refresh.</p>
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
  candidates,
  fieldError,
  idea,
  isGenerating,
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
): Promise<AnalysisResult> {
  try {
    const response = await apiClient.analyzePosts(candidateAnalysisRequest(candidates));

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

export function WriterPage({
  apiClient,
  onOpenSettings,
}: WriterPageProps): ReactElement {
  const [model, setModel] = useState(createInitialModel);

  const scoreCandidates = async (candidates: GeneratedIdeaCandidate[]) => {
    if (candidates.length === 0) {
      return;
    }

    const result = await requestAnalysis(apiClient, candidates);

    setModel((current) => applyAnalysisResult(current, candidates, result));
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

      if (payloadResult.type === "field-error") {
        setModel((current) => ({
          ...current,
          fieldError: payloadResult.fieldError,
          routeError: null,
        }));
        return;
      }

      const { payload } = payloadResult;

      setModel((current) => ({
        ...current,
        fieldError: null,
        isGenerating: true,
        lastPayload: payload,
      }));
      const result = await requestGeneration(apiClient, payload);
      setModel((current) => applyGenerationResult(current, payload, result));

      if (result.type === "success") {
        await scoreCandidates(result.candidates);
      }
    })();
  };

  const retry = async () => {
    const payload = model.lastPayload;

    if (payload === null) {
      return;
    }

    setModel((current) => ({
      ...current,
      isGenerating: true,
    }));
    const result = await requestGeneration(apiClient, payload);
    setModel((current) => applyGenerationResult(current, payload, result));

    if (result.type === "success") {
      await scoreCandidates(result.candidates);
    }
  };

  const retryScore = async (itemId: string) => {
    const candidate = model.candidates.find((item) => item.id === itemId);

    if (candidate === undefined) {
      return;
    }

    setModel((current) => applyAnalysisLoading(current, [candidate]));
    const result = await requestAnalysis(apiClient, [candidate]);
    setModel((current) => applyAnalysisResult(current, [candidate], result));
  };

  return (
    <WriterPageView
      {...model}
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

  const generate = async () => {
    const payloadResult = payloadFromIdea(model.idea);

    if (payloadResult.type === "field-error") {
      model = {
        ...model,
        fieldError: payloadResult.fieldError,
        routeError: null,
      };
      return render();
    }

    const { payload } = payloadResult;

    model = {
      ...model,
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
        await requestAnalysis(options.apiClient, candidates),
      );
    }

    return render();
  };

  return {
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

      model = {
        ...model,
        isGenerating: true,
      };
      const result = await requestGeneration(options.apiClient, payload);
      model = applyGenerationResult(model, payload, result);

      if (result.type === "success") {
        const { candidates } = result;
        model = applyAnalysisResult(
          model,
          candidates,
          await requestAnalysis(options.apiClient, candidates),
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
        await requestAnalysis(options.apiClient, [candidate]),
      );

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
