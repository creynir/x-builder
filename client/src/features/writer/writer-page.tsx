import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { JudgeScores, JudgeVerdictLabel } from "@x-builder/shared";

import { RouteErrorBanner } from "../../shell/route-error-banner";
import { Alert, Badge, Button, Drawer, Skeleton } from "../../ui/foundation";
import {
  CandidateDeterministicSummary,
  DeterministicDetailInspector,
  DraftEvaluationEmptyState,
  DraftDeterministicEvaluation,
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
  runJudgeDraft,
  runRetryScore,
  runScoreDraft,
  shouldRetryAnalysis,
  type CandidateAnalysisState,
  type JudgeState,
  type WriterApiClient,
  type WriterCandidate,
  type WriterPageModel,
} from "./writer-workflow";

export type { WriterApiClient } from "./writer-workflow";

export type WriterPageProps = {
  apiClient: WriterApiClient;
  judgeReady?: boolean;
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
  scoreDraft: () => Promise<string>;
  updateFollowers: (followers: string) => string;
  updateIdea: (idea: string) => string;
};

function candidateLabel(candidate: WriterCandidate): string {
  if (candidate.source === "draft") {
    return "Current draft";
  }

  if (candidate.format === "one-liner") {
    return "One-liner";
  }

  if (candidate.format === "mini-framework") {
    return "Mini framework";
  }

  if (candidate.format === "debate-question") {
    return "Debate question";
  }

  return "Generated variant";
}

type WriterPageViewProps = WriterPageModel & {
  judgeReady: boolean;
  onApplyFollowers: () => void;
  onCloseDetails: () => void;
  onFocusFollowers: () => void;
  onFollowersChange: (followers: string) => void;
  onGenerate: () => void;
  onIdeaChange: (idea: string) => void;
  onJudge: () => void;
  onOpenDetails: (itemId: string) => void;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
  onRetryDetails: () => void;
  onRetryScore: (itemId: string) => Promise<void>;
};

function CandidateAnalysis({
  candidate,
  onFocusFollowers,
  onRetryScore,
  state,
}: {
  candidate: WriterCandidate;
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
        <CandidateDeterministicSummary
          item={state.item}
          onAddFollowers={onFocusFollowers}
          onRetryScore={onRetryScore}
        />
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

function DraftAnalysis({
  candidate,
  onFocusFollowers,
  onRetryScore,
  state,
}: {
  candidate: WriterCandidate;
  onFocusFollowers: () => void;
  onRetryScore: (itemId: string) => void;
  state: CandidateAnalysisState;
}): ReactElement | null {
  if (state.status === "ready" || state.status === "failed" || state.status === "stale") {
    return (
      <DraftDeterministicEvaluation
        item={state.item}
        onAddFollowers={onFocusFollowers}
        onRetryScore={onRetryScore}
      />
    );
  }

  if (state.status === "unavailable") {
    return (
      <Alert
        variant="danger"
        title="Could not score draft"
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
    );
  }

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="xb-draft-evaluation" role="status">
        <p>Scoring draft</p>
        <Skeleton height={92} label="Scoring draft prediction" width={480} />
        <Skeleton height={160} label="Scoring draft coach" width={480} />
      </div>
    );
  }

  if (candidate.text.trim().length === 0) {
    return null;
  }

  return null;
}

const judgeVerdictLabels: Record<JudgeVerdictLabel, string> = {
  post_now: "Post now",
  slight_rework: "Slight rework",
  major_rework: "Major rework",
  do_not_post: "Do not post",
};

const judgeScoreRows: Array<{ key: keyof JudgeScores; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "replies", label: "Replies" },
  { key: "profileClicks", label: "Profile clicks" },
  { key: "impressions", label: "Impressions" },
  { key: "bookmarkValue", label: "Bookmark value" },
  { key: "dwellProxy", label: "Dwell" },
  { key: "voiceMatch", label: "Voice match" },
  { key: "negativeRisk", label: "Negative risk" },
];

export function JudgePanel({
  judgeReady,
  draftReady,
  judge,
  onJudge,
}: {
  judgeReady: boolean;
  draftReady: boolean;
  judge: JudgeState;
  onJudge: () => void;
}): ReactElement {
  const isLoading = judge.status === "loading";
  const disabled = !judgeReady || !draftReady || isLoading;

  return (
    <section aria-label="Codex judge" className="xb-judge-panel">
      <div className="xb-judge-panel__header">
        <h2>Codex Judge</h2>
        <Button disabled={disabled} onClick={onJudge} type="button" variant="secondary">
          {isLoading ? "Judging…" : judge.status === "failed" ? "Retry judge" : "Judge draft"}
        </Button>
      </div>
      {judgeReady ? null : (
        <p className="xb-judge-panel__hint">Codex judge is unavailable right now.</p>
      )}
      {judge.status === "loading" ? (
        <div aria-busy="true" role="status">
          <Skeleton height={96} label="Judging draft" width={480} />
        </div>
      ) : null}
      {judge.status === "failed" ? (
        <Alert title="Judge unavailable" variant="danger">
          {judge.error.message}
        </Alert>
      ) : null}
      {judge.status === "ready" ? (
        <div className="xb-judge-verdict">
          <div className="xb-judge-verdict__summary">
            <Badge>{judgeVerdictLabels[judge.verdict.verdict]}</Badge>
            <span className="xb-judge-verdict__confidence">
              Confidence: {judge.verdict.confidence}
            </span>
          </div>
          <p className="xb-judge-verdict__headline">{judge.verdict.headline}</p>
          <dl className="xb-judge-scores">
            {judgeScoreRows.map((row) => (
              <div className="xb-judge-scores__row" key={row.key}>
                <dt>{row.label}</dt>
                <dd>{judge.verdict.scores[row.key]}</dd>
              </div>
            ))}
          </dl>
          {judge.verdict.strengths.length > 0 ? (
            <div className="xb-judge-verdict__section">
              <h3>Strengths</h3>
              <ul>
                {judge.verdict.strengths.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {judge.verdict.improvements.length > 0 ? (
            <div className="xb-judge-verdict__section">
              <h3>Improvements</h3>
              <ul>
                {judge.verdict.improvements.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function WriterPageView({
  analysisByCandidateId,
  appliedFollowers,
  candidates,
  judgeReady,
  detail,
  fieldError,
  followerDraft,
  followerError,
  idea,
  isGenerating,
  isScoring,
  judge,
  onApplyFollowers,
  onCloseDetails,
  onFocusFollowers,
  onFollowersChange,
  onGenerate,
  onIdeaChange,
  onJudge,
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

  const hasStaleAnalysis = Object.values(analysisByCandidateId).some(
    (state) => state.status === "stale",
  );
  const hasDraftText = idea.trim().length > 0;
  const visibleCandidates = hasDraftText ? candidates : [];

  return (
    <section className="xb-writer-page" aria-label="Studio workspace">
      <RouteErrorBanner
        error={routeError}
        isRetrying={isGenerating}
        onOpenSettings={onOpenSettings}
        onRetry={onRetry}
      />
      <div className="xb-writer-workspace">
        <form
          aria-label="Idea input"
          aria-busy={isGenerating}
          className="xb-writer-form"
          onSubmit={handleSubmit}
        >
          <label className="xb-writer-form__label" htmlFor="writer-idea">
            Draft
          </label>
          <textarea
            aria-describedby={fieldError === null ? helperId : `${helperId} ${ideaErrorId}`}
            aria-invalid={fieldError === null ? undefined : true}
            id="writer-idea"
            onChange={(event) => onIdeaChange(event.target.value)}
            placeholder="Paste a draft post to evaluate..."
            value={idea}
          />
          <p className="xb-writer-form__helper" id={helperId}>
            Paste or edit a post. Studio scores it automatically.
          </p>
          {fieldError === null ? null : (
            <p className="xb-writer-form__error" id={ideaErrorId}>
              {fieldError}
            </p>
          )}
        </form>
        <div className="xb-writer-results-stack">
          <ManualScoringContextPanel
            applyLabel="Recompute prediction"
            context={{
              followers: appliedFollowers,
              source: appliedFollowers === undefined ? "missing" : "manual",
              skipped: appliedFollowers === undefined,
            }}
            disabled={isGenerating || isScoring}
            error={followerError}
            isStale={hasDraftText && hasStaleAnalysis}
            focusTarget="manual-followers"
            onApplyFollowers={onApplyFollowers}
            onFollowersDraftChange={onFollowersChange}
            value={followerDraft}
          />
          <section
            aria-label="Studio evaluation"
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
            {!isGenerating && visibleCandidates.length > 0 ? (
              <div className="xb-writer-candidates">
                {visibleCandidates.map((candidate) =>
                  candidate.source === "draft" ? (
                    <DraftAnalysis
                      candidate={candidate}
                      key={candidate.id}
                      onFocusFollowers={onFocusFollowers}
                      onRetryScore={onRetryScore}
                      state={analysisByCandidateId[candidate.id] ?? { status: "idle" }}
                    />
                  ) : (
                    <article className="xb-writer-candidate" key={candidate.id}>
                      <div className="xb-writer-candidate__header">
                        <Badge variant="info">{candidateLabel(candidate)}</Badge>
                        <Button
                          data-focus-target={`candidate-details:${candidate.id}`}
                          disabled={isGenerating || isScoring}
                          onClick={() => onOpenDetails(candidate.id)}
                          type="button"
                          variant="secondary"
                        >
                          Details
                        </Button>
                      </div>
                      <CandidateAnalysis
                        candidate={candidate}
                        onFocusFollowers={onFocusFollowers}
                        onRetryScore={onRetryScore}
                        state={analysisByCandidateId[candidate.id] ?? { status: "idle" }}
                      />
                    </article>
                  ),
                )}
              </div>
            ) : null}
            {!isGenerating && visibleCandidates.length === 0 ? (
              <DraftEvaluationEmptyState
                hasDraft={hasDraftText}
                hasFollowers={appliedFollowers !== undefined}
                onAddFollowers={onFocusFollowers}
              />
            ) : null}
          </section>
        </div>
        <JudgePanel
          judgeReady={judgeReady}
          draftReady={idea.trim().length > 0}
          judge={judge}
          onJudge={onJudge}
        />
      </div>
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
  judgeReady = true,
  onOpenSettings,
}: WriterPageProps): ReactElement {
  const [model, setModel] = useState(createInitialModel);
  const modelRef = useRef(model);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
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

  const scoreDraft = async () => {
    await runScoreDraft(apiClient, modelRef.current, publishModel);
  };

  const judgeDraft = () => {
    // The judge call can run up to ~65s; drop any state updates that resolve
    // after the page unmounts (same discipline as the status/settings effects).
    void runJudgeDraft(apiClient, modelRef.current, (update) => {
      if (mountedRef.current) {
        publishModel(update);
      }
    });
  };

  useEffect(() => {
    const trimmedIdea = model.idea.trim();
    const hasStaleCandidateAnalysis = Object.values(model.analysisByCandidateId).some(
      (state) => state.status === "stale",
    );
    const showingGeneratedCandidates = model.candidates.some(
      (candidate) => candidate.source === "generated",
    );

    if (
      trimmedIdea.length === 0 ||
      model.isGenerating ||
      model.activeGenerationRequestId !== null ||
      showingGeneratedCandidates
    ) {
      return undefined;
    }

    const currentDraft = model.candidates[0];

    if (
      model.candidates.length === 1 &&
      currentDraft?.source === "draft" &&
      currentDraft.text === trimmedIdea &&
      model.analysisByCandidateId[currentDraft.id]?.status !== "stale"
    ) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void runScoreDraft(apiClient, modelRef.current, publishModel);
    }, 500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    apiClient,
    model.activeGenerationRequestId,
    model.candidates,
    model.idea,
    model.isGenerating,
    model.analysisByCandidateId,
  ]);

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
      judgeReady={judgeReady}
      onApplyFollowers={applyFollowers}
      onCloseDetails={closeDetailInspector}
      onFocusFollowers={focusFollowers}
      onFollowersChange={updateFollowers}
      onGenerate={generate}
      onIdeaChange={updateIdea}
      onJudge={judgeDraft}
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
      judgeReady
      onApplyFollowers={() => undefined}
      onCloseDetails={() => undefined}
      onFocusFollowers={() => undefined}
      onFollowersChange={() => undefined}
      onGenerate={() => undefined}
      onIdeaChange={() => undefined}
      onJudge={() => undefined}
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
    scoreDraft: async () => {
      await runScoreDraft(options.apiClient, model, publishModel);
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
