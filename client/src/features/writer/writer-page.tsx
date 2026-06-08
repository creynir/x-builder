import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GeneratedIdeaCandidate } from "@x-builder/shared";

import { RouteErrorBanner } from "../../shell/route-error-banner";
import { Alert, Badge, Button, Drawer, Skeleton } from "../../ui/foundation";
import {
  CandidateDeterministicSummary,
  DeterministicDetailInspector,
  ManualScoringContextPanel,
} from "./deterministic/components";
import {
  applyFollowerDraftChange,
  applyIdeaChange,
  closeDetails,
  closeDetailsWithEscape,
  createInitialModel,
  focusManualFollowers,
  runApplyFollowers,
  runGenerate,
  runOpenDetails,
  runRetry,
  runRetryAnalysis,
  runRetryDetails,
  runRetryScore,
  shouldRetryAnalysis,
  type CandidateAnalysisState,
  type WriterApiClient,
  type WriterPageModel,
} from "./writer-workflow";

export type { WriterApiClient } from "./writer-workflow";

export type WriterPageProps = {
  apiClient: WriterApiClient;
  onOpenSettings: () => void;
};

export type WriterPagePublicDriverOptions = WriterPageProps & {
  renderPage?: (props: WriterPageProps) => ReactElement;
};

export type WriterPagePublicDriver = {
  applyFollowers: () => Promise<string>;
  closeDetails: () => string;
  closeDetailsWithEscape: () => {
    activeTarget: string;
    focusRequest: number;
    html: string;
  };
  generate: () => Promise<string>;
  focusFollowers: () => {
    activeTarget: string;
    focusRequest: number;
    html: string;
  };
  openDetails: (itemId: string) => Promise<string>;
  openSettings: () => void;
  render: () => string;
  retry: () => Promise<string>;
  retryDetails: () => Promise<string>;
  retryScore: (itemId: string) => Promise<string>;
  updateFollowers: (followers: string) => string;
  updateIdea: (idea: string) => string;
};

function candidateLabel(format: GeneratedIdeaCandidate["format"]): string {
  return format;
}

type WriterPageViewProps = WriterPageModel & {
  onApplyFollowers: () => void;
  onCloseDetails: () => void;
  onFocusFollowers: () => void;
  onFollowersChange: (followers: string) => void;
  onGenerate: () => void;
  onIdeaChange: (idea: string) => void;
  onOpenDetails: (itemId: string) => void;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
  onRetryDetails: () => void;
  onRetryScore: (itemId: string) => Promise<void>;
};

function CandidateAnalysis({
  candidate,
  onApplyFollowers,
  onFocusFollowers,
  onRetryScore,
  state,
}: {
  candidate: GeneratedIdeaCandidate;
  onApplyFollowers: () => void;
  onFocusFollowers: () => void;
  onRetryScore: (itemId: string) => void;
  state: CandidateAnalysisState;
}): ReactElement {
  if (state.status === "ready" || state.status === "failed") {
    return (
      <CandidateDeterministicSummary
        item={state.item}
        onAddFollowers={onFocusFollowers}
        onRetryScore={onRetryScore}
      />
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="xb-writer-candidate__analysis">
        <p>{state.candidate.text}</p>
        <Alert
          variant="danger"
          title="Could not score candidate"
          recovery={
            <Button
              disabled={!state.error.retryable}
              onClick={() => onRetryScore(state.candidate.id)}
              type="button"
              variant="secondary"
            >
              Retry score
            </Button>
          }
        >
          {state.error.message}
        </Alert>
      </div>
    );
  }

  if (state.status === "stale") {
    return (
      <div className="xb-writer-candidate__analysis">
        <p>{candidate.text}</p>
        <CandidateDeterministicSummary
          item={state.item}
          onAddFollowers={onFocusFollowers}
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
  detail,
  fieldError,
  followerDraft,
  followerError,
  idea,
  isGenerating,
  isScoring,
  onApplyFollowers,
  onCloseDetails,
  onFocusFollowers,
  onFollowersChange,
  onGenerate,
  onIdeaChange,
  onOpenDetails,
  onOpenSettings,
  onRetry,
  onRetryDetails,
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
        disabled={isGenerating || isScoring}
        error={followerError}
        isStale={Object.values(analysisByCandidateId).some(
          (state) => state.status === "stale",
        )}
        focusTarget="manual-followers"
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
                <Button
                  data-focus-target={`candidate-details:${candidate.id}`}
                  disabled={isGenerating || isScoring}
                  onClick={() => onOpenDetails(candidate.id)}
                  type="button"
                  variant="secondary"
                >
                  Details
                </Button>
                <CandidateAnalysis
                  candidate={candidate}
                  onApplyFollowers={onApplyFollowers}
                  onFocusFollowers={onFocusFollowers}
                  onRetryScore={onRetryScore}
                  state={analysisByCandidateId[candidate.id] ?? { status: "idle" }}
                />
              </article>
            ))}
          </div>
        ) : null}
      </section>
      <Drawer
        closeLabel="Close deterministic details"
        onClose={onCloseDetails}
        open={detail.status !== "closed"}
        title="Deterministic details"
      >
        {detail.status === "closed" ? (
          <DeterministicDetailInspector
            message="Select a candidate to inspect deterministic scoring."
            state="empty"
          />
        ) : detail.status === "loading" ? (
          <DeterministicDetailInspector
            label="Loading deterministic details"
            state="loading"
          />
        ) : detail.status === "error" ? (
          <DeterministicDetailInspector
            message={detail.error.message}
            onRetryExpandedPostCoach={onRetryDetails}
            state="error"
          />
        ) : detail.status === "failed" ? (
          <DeterministicDetailInspector
            item={detail.item}
            onRetryExpandedPostCoach={onRetryDetails}
            state="failed"
          />
        ) : (
          <DeterministicDetailInspector
            item={detail.item}
            onAddFollowers={onFocusFollowers}
            onRetryExpandedPostCoach={onRetryDetails}
            state="ready"
          />
        )}
      </Drawer>
    </section>
  );
}

export function WriterPage({
  apiClient,
  onOpenSettings,
}: WriterPageProps): ReactElement {
  const [model, setModel] = useState(createInitialModel);
  const modelRef = useRef(model);
  const publishModel = (
    update: WriterPageModel | ((current: WriterPageModel) => WriterPageModel),
  ) => {
    const nextModel =
      typeof update === "function" ? update(modelRef.current) : update;

    modelRef.current = nextModel;
    setModel(nextModel);
  };

  const applyFollowers = () => {
    void runApplyFollowers(apiClient, modelRef.current, publishModel);
  };

  const focusFollowers = () => {
    publishModel((current) => focusManualFollowers(current));
  };

  const closeDetailInspector = () => {
    publishModel((current) => closeDetailsWithEscape(current));
  };

  const updateFollowers = (followers: string) => {
    publishModel((current) => applyFollowerDraftChange(current, followers));
  };

  const updateIdea = (idea: string) => {
    publishModel((current) => applyIdeaChange(current, idea));
  };

  const generate = () => {
    void runGenerate(apiClient, modelRef.current, publishModel);
  };

  const retry = async () => {
    if (shouldRetryAnalysis(modelRef.current)) {
      await runRetryAnalysis(apiClient, modelRef.current, publishModel);
      return;
    }

    await runRetry(apiClient, modelRef.current, publishModel);
  };

  const openDetails = (itemId: string) => {
    void runOpenDetails(apiClient, modelRef.current, itemId, publishModel);
  };

  const retryDetails = () => {
    void runRetryDetails(apiClient, modelRef.current, publishModel);
  };

  const retryScore = async (itemId: string) => {
    await runRetryScore(apiClient, modelRef.current, itemId, publishModel);
  };

  useEffect(() => {
    if (model.detail.status === "closed") {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        publishModel((current) => closeDetailsWithEscape(current));
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [model.detail.status]);

  useEffect(() => {
    if (model.activeFocusTarget === null) {
      return;
    }

    const target = document.querySelector<HTMLElement>(
      `[data-focus-target="${CSS.escape(model.activeFocusTarget)}"]`,
    );
    target?.focus();
  }, [model.activeFocusRequest, model.activeFocusTarget]);

  return (
    <WriterPageView
      {...model}
      onApplyFollowers={applyFollowers}
      onCloseDetails={closeDetailInspector}
      onFocusFollowers={focusFollowers}
      onFollowersChange={updateFollowers}
      onGenerate={generate}
      onIdeaChange={updateIdea}
      onOpenDetails={openDetails}
      onOpenSettings={onOpenSettings}
      onRetry={retry}
      onRetryDetails={retryDetails}
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
      onCloseDetails={() => undefined}
      onFocusFollowers={() => undefined}
      onFollowersChange={() => undefined}
      onGenerate={() => undefined}
      onIdeaChange={() => undefined}
      onOpenDetails={() => undefined}
      onOpenSettings={onOpenSettings}
      onRetry={async () => undefined}
      onRetryDetails={() => undefined}
      onRetryScore={async () => undefined}
    />,
  );
}

export function createWriterPagePublicDriver(
  options: WriterPagePublicDriverOptions,
): WriterPagePublicDriver {
  let model = createInitialModel();
  const publishModel = (
    update: WriterPageModel | ((current: WriterPageModel) => WriterPageModel),
  ) => {
    model = typeof update === "function" ? update(model) : update;
  };

  const render = () => renderDriverPage(options.onOpenSettings, model);

  return {
    applyFollowers: async () => {
      await runApplyFollowers(options.apiClient, model, publishModel);
      return render();
    },
    closeDetails: () => {
      model = closeDetails(model);
      return render();
    },
    closeDetailsWithEscape: () => {
      model = closeDetailsWithEscape(model);

      return {
        activeTarget: model.activeFocusTarget ?? "",
        focusRequest: model.activeFocusRequest,
        html: render(),
      };
    },
    generate: async () => {
      await runGenerate(options.apiClient, model, publishModel);
      return render();
    },
    focusFollowers: () => {
      model = focusManualFollowers(model);

      return {
        activeTarget: model.activeFocusTarget ?? "",
        focusRequest: model.activeFocusRequest,
        html: render(),
      };
    },
    openDetails: async (itemId: string) => {
      await runOpenDetails(options.apiClient, model, itemId, publishModel);
      return render();
    },
    openSettings: () => {
      options.onOpenSettings();
    },
    render,
    retry: async () => {
      if (shouldRetryAnalysis(model)) {
        await runRetryAnalysis(options.apiClient, model, publishModel);
      } else {
        await runRetry(options.apiClient, model, publishModel);
      }
      return render();
    },
    retryDetails: async () => {
      await runRetryDetails(options.apiClient, model, publishModel);
      return render();
    },
    retryScore: async (itemId: string) => {
      await runRetryScore(options.apiClient, model, itemId, publishModel);
      return render();
    },
    updateFollowers: (followers: string) => {
      model = applyFollowerDraftChange(model, followers);
      return render();
    },
    updateIdea: (idea: string) => {
      model = applyIdeaChange(model, idea);
      return render();
    },
  };
}
