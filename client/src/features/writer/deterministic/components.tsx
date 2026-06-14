import type { ChangeEvent, ReactElement, ReactNode } from "react";
import type {
  AnalyzedPostItem,
  EngagementPrediction,
  PostCoachViewModel,
} from "@x-builder/shared";

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  KeyValueList,
  ScoreBar,
  Skeleton,
  Tooltip,
} from "../../../ui/foundation";

import "./components.css";

type ScoredAnalyzedPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;
type ScoreFailedAnalyzedPostItem = Extract<
  AnalyzedPostItem,
  { status: "score_failed" }
>;
type ReadyPostCoachViewModel = Extract<PostCoachViewModel, { state: "ready" }>;
type AvailableEngagementPrediction = Extract<
  EngagementPrediction,
  { status: "available" }
>;
const postCoachDisplayTitle = "Draft Review";

const groupedNumber = (value: number): string =>
  new Intl.NumberFormat("en-US").format(value);

const reachRangeLabel = (range: { low: number; high: number }): string =>
  `${groupedNumber(range.low)} – ${groupedNumber(range.high)}`;

const escapeLikelihoodLabel = (escapeProbability: number): string =>
  `${Math.round(escapeProbability * 100)}% escape`;

export type CandidateDeterministicSummaryProps = {
  item: AnalyzedPostItem;
  onAddFollowers?: () => void;
  onRetryScore: (itemId: string) => void;
};

export type DraftDeterministicEvaluationProps = {
  item: AnalyzedPostItem;
  onAddFollowers?: () => void;
  onRetryScore: (itemId: string) => void;
};

export type DraftEvaluationEmptyStateProps = {
  hasDraft: boolean;
  hasFollowers: boolean;
  onAddFollowers?: () => void;
};

export type ManualScoringContextPanelProps = {
  context: {
    followers?: number;
    source: "manual" | "missing";
    skipped: boolean;
  };
  applyLabel?: string;
  disabled?: boolean;
  error?: string | null;
  focusTarget?: string;
  isStale?: boolean;
  onApplyFollowers?: () => void;
  onFollowersDraftChange?: (followers: string) => void;
  onFollowersChange?: (followers: number | undefined) => void;
  value?: string;
};

export type DeterministicDetailInspectorProps =
  | {
      state: "empty";
      message: string;
    }
  | {
      state: "loading";
      label: string;
    }
  | {
      state: "error";
      message: string;
      onRetryExpandedPostCoach?: () => void;
    }
  | {
      state: "ready";
      item: ScoredAnalyzedPostItem;
      onAddFollowers?: () => void;
      onRetryExpandedPostCoach?: () => void;
    }
  | {
      state: "failed";
      item: ScoreFailedAnalyzedPostItem;
      onRetryExpandedPostCoach?: () => void;
    };

function scoreBadgeVariant(
  status: "pass" | "warn" | "fail",
): "success" | "warning" | "danger" {
  if (status === "pass") {
    return "success";
  }

  if (status === "warn") {
    return "warning";
  }

  return "danger";
}

function coachBadgeVariant(
  tone: Extract<PostCoachViewModel, { state: "ready" }>["badge"]["tone"],
): "success" | "info" | "warning" | "danger" {
  if (tone === "top") {
    return "success";
  }

  if (tone === "ship") {
    return "info";
  }

  if (tone === "almost") {
    return "warning";
  }

  return "danger";
}

function Card({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}): ReactElement {
  return (
    <section className="xb-deterministic-card" aria-label={title}>
      <h3 className="xb-deterministic-card__title">{title}</h3>
      {children}
    </section>
  );
}

function predictionSummary(prediction: EngagementPrediction): {
  label: string;
  tone: "info" | "warning";
} {
  if (prediction.status === "available") {
    const typical = `${groupedNumber(prediction.stallRange.low)}–${groupedNumber(prediction.stallRange.high)} typical`;
    return {
      label: `${typical} · ${escapeLikelihoodLabel(prediction.escapeProbability)}`,
      tone: "info",
    };
  }

  if (prediction.reason === "missing_followers") {
    return {
      label: "Prediction needs follower count.",
      tone: "warning",
    };
  }

  return {
    label: prediction.message,
    tone: "warning",
  };
}

function summaryChecks(postCoach: PostCoachViewModel) {
  if (postCoach.state !== "ready") {
    return [];
  }

  return [...postCoach.failed, ...postCoach.warned].slice(0, 2);
}

function compactCheckGroups(postCoach: ReadyPostCoachViewModel) {
  return [
    {
      defaultOpen: true,
      title: "Flagged",
      items: postCoach.failed,
    },
    {
      defaultOpen: true,
      title: "Nudges",
      items: postCoach.warned,
    },
    {
      defaultOpen: false,
      title: "On point",
      items: postCoach.passed,
    },
  ].filter((group) => group.items.length > 0);
}

export function EngagementPredictionCard({
  onAddFollowers,
  prediction,
}: {
  onAddFollowers?: () => void;
  prediction: EngagementPrediction;
}): ReactElement {
  const showFollowersRecovery =
    prediction.status === "disabled" &&
    prediction.reason === "missing_followers" &&
    onAddFollowers !== undefined;

  if (prediction.status === "disabled") {
    return (
      <Card title="Engagement Prediction">
        <Alert
          recovery={
            showFollowersRecovery ? (
              <Button onClick={onAddFollowers} type="button" variant="secondary">
                Add followers
              </Button>
            ) : null
          }
          variant="warning"
          title="Prediction unavailable"
        >
          {prediction.message}
        </Alert>
      </Card>
    );
  }

  return (
    <Card title="Engagement Prediction">
      <ReachRegimeBlock prediction={prediction} />
      <div className="xb-deterministic-signals" aria-label="Prediction signals">
        {prediction.signals.map((signal) => (
          <div className="xb-deterministic-signals__row" key={signal.signal_key}>
            <span>{signal.label}</span>
            <span>{signal.multiplier}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ReachRegimeBlock({
  prediction,
}: {
  prediction: AvailableEngagementPrediction;
}): ReactElement {
  return (
    <div className="xb-reach-regime">
      <dl className="xb-deterministic-signals xb-reach-regime__regimes">
        <div className="xb-deterministic-signals__row">
          <dt>Expected reach</dt>
          <p>{prediction.predictedMidImpressions}</p>
        </div>
        <div className="xb-deterministic-signals__row">
          <dt>Escape likelihood</dt>
          <p>
            <Badge variant="info">
              {escapeLikelihoodLabel(prediction.escapeProbability)}
            </Badge>
          </p>
        </div>
        <div className="xb-deterministic-signals__row">
          <dt>Typical reach</dt>
          <p>{reachRangeLabel(prediction.stallRange)}</p>
        </div>
        <div className="xb-deterministic-signals__row">
          <dt>If it breaks out</dt>
          <p>{reachRangeLabel(prediction.escapeRange)}</p>
        </div>
        <div className="xb-deterministic-signals__row">
          <dt>Expected replies</dt>
          <p>{prediction.expectedReplies}</p>
        </div>
      </dl>
      {prediction.qualityBasis === "judge" ? (
        <p className="xb-reach-regime__basis">
          <Badge variant="accent">Refined with judge signal</Badge>
        </p>
      ) : null}
    </div>
  );
}

export function PostCoachCard({
  density = "full",
  postCoach,
}: {
  density?: "compact" | "full";
  postCoach: PostCoachViewModel;
}): ReactElement {
  if (postCoach.state === "empty") {
    return (
      <EmptyState title={postCoachDisplayTitle}>
        <p>{postCoach.message}</p>
      </EmptyState>
    );
  }

  const isCompact = density === "compact";
  const sections = postCoach.sections;
  const checkGroups = compactCheckGroups(postCoach);

  return (
    <section
      aria-label={postCoachDisplayTitle}
      className={`xb-deterministic-card xb-post-coach-card xb-post-coach-card--${density}`}
    >
      <h3 className="xb-deterministic-card__title">{postCoachDisplayTitle}</h3>
      <div className="xb-post-coach-card__summary">
        <ScoreBar
          label={postCoachDisplayTitle}
          value={postCoach.value}
          bandLabel={postCoach.badge.label}
          helpText={isCompact ? undefined : postCoach.helperText}
        />
        <Tooltip label={postCoach.badge.tooltip}>
          <Badge variant={coachBadgeVariant(postCoach.badge.tone)}>
            {postCoach.badge.label}
          </Badge>
        </Tooltip>
      </div>
      {isCompact ? null : (
        <KeyValueList
          items={[
            {
              label: "Flagged",
              value: postCoach.counts.flagged,
            },
            {
              label: "Nudges",
              value: postCoach.counts.nudges,
            },
            {
              label: "On point",
              value: postCoach.counts.onPoint,
            },
          ]}
        />
      )}
      <div className="xb-post-coach-card__engageability">
        <Badge variant={postCoach.engageability.engageable ? "success" : "warning"}>
          {postCoach.engageability.engageable ? "Engageable" : "Needs review"}
        </Badge>
        <span>{postCoach.engageability.reason}</span>
      </div>
      {isCompact && checkGroups.length > 0 ? (
        <div className="xb-post-coach-card__check-groups" aria-label="Draft Review checks">
          {checkGroups.map((group) => (
            <details
              className="xb-post-coach-card__check-group"
              key={group.title}
              open={group.defaultOpen}
            >
              <summary>
                <span>{group.title}</span>
                <span>{group.items.length}</span>
              </summary>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Badge variant={scoreBadgeVariant(item.status)}>{item.status}</Badge>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : null}
      {!isCompact && sections.length > 0 ? (
        <div className="xb-post-coach-card__sections">
          {sections.map((section) => (
          <section className="xb-post-coach-card__section" key={section.title}>
            <h4>{section.title}</h4>
            <ul>
              {section.items.map((item) => (
                <li key={item.id}>
                  <Badge variant={scoreBadgeVariant(item.status)}>{item.status}</Badge>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </section>
          ))}
        </div>
      ) : null}
      {!isCompact && postCoach.learnings.length > 0 ? (
        <div className="xb-post-coach-card__learnings">
          {postCoach.learnings.map((learning) => (
            <p key={learning.text}>{learning.text}</p>
          ))}
        </div>
      ) : null}
      <p className="xb-post-coach-card__caveat">{postCoach.learningCaveat}</p>
      {isCompact ? null : (
        <p className="xb-post-coach-card__footer">{postCoach.footerText}</p>
      )}
    </section>
  );
}

export function CandidateDeterministicSummary({
  item,
  onAddFollowers,
  onRetryScore,
}: CandidateDeterministicSummaryProps): ReactElement {
  if (item.status === "score_failed") {
    return (
      <article className="xb-candidate-deterministic-summary">
        <p className="xb-candidate-deterministic-summary__text">{item.text}</p>
        <KeyValueList
          items={[
            {
              label: "Source format",
              value: item.sourceFormat ?? "Unknown",
            },
            {
              label: "Reason",
              value: item.reason,
            },
          ]}
        />
        <Alert
          variant="warning"
          title="Score failed"
          recovery={
            <Button
              disabled={!item.retryable}
              onClick={() => onRetryScore(item.id)}
              variant="secondary"
            >
              Retry score
            </Button>
          }
        >
          {item.message}
        </Alert>
      </article>
    );
  }

  return (
    <article className="xb-candidate-deterministic-summary">
      <p className="xb-candidate-deterministic-summary__text">{item.text}</p>
      <ScoreBar
        label="Static score"
        value={item.score.value}
        bandLabel={item.postCoach.state === "ready" ? item.postCoach.badge.label : undefined}
        helpText={item.heuristicLabel}
      />
      {item.postCoach.state === "ready" ? (
        <div className="xb-candidate-deterministic-summary__counts">
          <span>
            <b>{item.postCoach.counts.flagged}</b> flagged
          </span>
          <span>
            <b>{item.postCoach.counts.nudges}</b> nudges
          </span>
          <span>
            <b>{item.postCoach.counts.onPoint}</b> on point
          </span>
        </div>
      ) : null}
      {summaryChecks(item.postCoach).length > 0 ? (
        <ul className="xb-candidate-deterministic-summary__checks">
          {summaryChecks(item.postCoach).map((check) => (
            <li key={check.id}>
              <Badge variant={scoreBadgeVariant(check.status)}>{check.status}</Badge>
              <span>{check.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="xb-candidate-deterministic-summary__prediction">
        <Badge variant={predictionSummary(item.prediction).tone}>
          {predictionSummary(item.prediction).label}
        </Badge>
        {item.prediction.status === "disabled" &&
        item.prediction.reason === "missing_followers" &&
        onAddFollowers !== undefined ? (
          <Button onClick={onAddFollowers} type="button" variant="secondary">
            Add followers
          </Button>
        ) : null}
      </div>
      {item.prediction.status === "available" ? (
        <ReachRegimeBlock prediction={item.prediction} />
      ) : null}
    </article>
  );
}

export function DraftDeterministicEvaluation({
  item,
  onAddFollowers,
  onRetryScore,
}: DraftDeterministicEvaluationProps): ReactElement {
  if (item.status === "score_failed") {
    return (
      <div className="xb-draft-evaluation">
        <Alert
          variant="warning"
          title="Score failed"
          recovery={
            <Button
              disabled={!item.retryable}
              onClick={() => onRetryScore(item.id)}
              variant="secondary"
            >
              Retry score
            </Button>
          }
        >
          {item.message}
        </Alert>
      </div>
    );
  }

  return (
    <div className="xb-draft-evaluation">
      <EngagementPredictionCard
        onAddFollowers={onAddFollowers}
        prediction={item.prediction}
      />
      <PostCoachCard density="compact" postCoach={item.postCoach} />
    </div>
  );
}

export function DraftEvaluationEmptyState({
  hasDraft,
  hasFollowers,
  onAddFollowers,
}: DraftEvaluationEmptyStateProps): ReactElement {
  const missingItems = [
    ...(hasDraft ? [] : ["Draft text"]),
    ...(hasFollowers ? [] : ["Followers"]),
  ];
  const message =
    !hasDraft && !hasFollowers
      ? "Paste a draft and add followers to estimate impressions."
      : !hasDraft
        ? "Paste a draft to estimate impressions."
        : !hasFollowers
          ? "Add followers to estimate impressions."
          : "Scoring starts after you pause typing.";

  return (
    <div className="xb-draft-evaluation">
      <Card title="Engagement Prediction">
        <Alert
          recovery={
            !hasFollowers && onAddFollowers !== undefined ? (
              <Button onClick={onAddFollowers} type="button" variant="secondary">
                Add followers
              </Button>
            ) : null
          }
          title="Prediction unavailable"
          variant="warning"
        >
          {message}
        </Alert>
        {missingItems.length > 0 ? (
          <KeyValueList
            items={[
              {
                label: "Missing",
                value: missingItems.join(", "),
              },
            ]}
          />
        ) : null}
      </Card>
      <Card title={postCoachDisplayTitle}>
        <p className="xb-draft-evaluation__empty-copy">
          Paste a draft to see static review checks.
        </p>
      </Card>
    </div>
  );
}

export function ManualScoringContextPanel({
  applyLabel = "Apply followers",
  context,
  disabled = false,
  error,
  focusTarget,
  isStale = false,
  onApplyFollowers,
  onFollowersDraftChange,
  onFollowersChange,
  value,
}: ManualScoringContextPanelProps): ReactElement {
  const handleFollowersChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;

    onFollowersDraftChange?.(value);
    onFollowersChange?.(value === "" ? undefined : Number(value));
  };

  return (
    <section className="xb-manual-scoring-context" aria-label="Manual account context">
      <h2>Manual account context</h2>
      <Input
        disabled={disabled}
        error={error ?? undefined}
        helperText="Used for this route prediction context."
        id="deterministic-followers"
        label="Followers"
        onChange={handleFollowersChange}
        readOnly={onFollowersChange === undefined && onFollowersDraftChange === undefined}
        type="number"
        data-focus-target={focusTarget}
        value={String(value ?? context.followers ?? "")}
      />
      {isStale ? (
        <p className="xb-manual-scoring-context__stale">Prediction needs refresh.</p>
      ) : null}
      {onApplyFollowers === undefined || !isStale ? null : (
        <Button disabled={disabled} onClick={onApplyFollowers} type="button" variant="secondary">
          {applyLabel}
        </Button>
      )}
      <KeyValueList
        disabled={disabled}
        items={[
          {
            label: "Context source",
            value: context.source,
          },
          {
            label: "Prediction context",
            value: context.skipped ? "skipped" : "included",
          },
        ]}
      />
    </section>
  );
}

export function DeterministicDetailInspector(
  props: DeterministicDetailInspectorProps,
): ReactElement {
  if (props.state === "empty") {
    return (
      <aside className="xb-deterministic-detail-inspector" aria-label="Deterministic details">
        <EmptyState title="Deterministic details">
          <p>{props.message}</p>
        </EmptyState>
      </aside>
    );
  }

  if (props.state === "loading") {
    return (
      <aside
        aria-label="Deterministic details"
        aria-busy="true"
        className="xb-deterministic-detail-inspector"
        role="status"
      >
        <h2>Deterministic details</h2>
        <p>{props.label}</p>
        <Skeleton height={120} label={props.label} width={420} />
      </aside>
    );
  }

  if (props.state === "error") {
    return (
      <aside className="xb-deterministic-detail-inspector" aria-label="Deterministic details">
        <Alert
          variant="danger"
          title="Could not load details"
          recovery={
            props.onRetryExpandedPostCoach === undefined ? undefined : (
              <Button
                onClick={props.onRetryExpandedPostCoach}
                type="button"
                variant="secondary"
              >
                Retry expanded review
              </Button>
            )
          }
        >
          {props.message}
        </Alert>
      </aside>
    );
  }

  if (props.state === "failed") {
    return (
      <aside className="xb-deterministic-detail-inspector" aria-label="Deterministic details">
        <h2>Deterministic details</h2>
        <p className="xb-deterministic-detail-inspector__text">{props.item.text}</p>
        <KeyValueList
          items={[
            {
              label: "Source format",
              value: props.item.sourceFormat ?? "Unknown",
            },
            {
              label: "Reason",
              value: props.item.reason,
            },
          ]}
        />
        <Alert
          variant="danger"
          title="Could not load details"
          recovery={
            props.onRetryExpandedPostCoach === undefined ? undefined : (
              <Button
                disabled={!props.item.retryable}
                onClick={props.onRetryExpandedPostCoach}
                type="button"
                variant="secondary"
              >
                Retry expanded review
              </Button>
            )
          }
        >
          {props.item.message}
        </Alert>
      </aside>
    );
  }

  const showFollowersRecovery =
    props.item.prediction.status === "disabled" &&
    props.item.prediction.reason === "missing_followers" &&
    props.onAddFollowers !== undefined;

  return (
    <aside className="xb-deterministic-detail-inspector" aria-label="Deterministic details">
      <h2>Deterministic details</h2>
      <p className="xb-deterministic-detail-inspector__text">{props.item.text}</p>
      <ScoreBar
        label="Deterministic score"
        value={props.item.score.value}
        bandLabel={
          props.item.postCoach.state === "ready"
            ? props.item.postCoach.badge.label
            : undefined
        }
        helpText={props.item.heuristicLabel}
      />
      <KeyValueList
        items={[
          {
            label: "Source format",
            value: props.item.sourceFormat ?? "Unknown",
          },
          {
            label: "Detected format",
            value: props.item.detectedFormat,
          },
          {
            label: "Analyzed at",
            value: props.item.analyzedAt,
          },
          {
            label: "Analyzer",
            value: props.item.analyzerVersion,
          },
        ]}
      />
      <PostCoachCard postCoach={props.item.postCoach} />
      <EngagementPredictionCard prediction={props.item.prediction} />
      {props.item.prediction.status === "disabled" ? (
        <KeyValueList
          items={[
            {
              label: "Prediction reason",
              value: props.item.prediction.reason,
            },
          ]}
        />
      ) : null}
      <div className="xb-deterministic-detail-inspector__actions">
        {showFollowersRecovery ? (
          <Button onClick={props.onAddFollowers} type="button" variant="secondary">
            Add followers
          </Button>
        ) : null}
        {props.onRetryExpandedPostCoach === undefined ? null : (
          <Button
            onClick={props.onRetryExpandedPostCoach}
            type="button"
            variant="secondary"
          >
            Retry expanded review
          </Button>
        )}
      </div>
    </aside>
  );
}
