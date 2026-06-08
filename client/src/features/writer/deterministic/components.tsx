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

export type CandidateDeterministicSummaryProps = {
  item: AnalyzedPostItem;
  onRetryScore: (itemId: string) => void;
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
    }
  | {
      state: "ready";
      item: ScoredAnalyzedPostItem;
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

export function EngagementPredictionCard({
  prediction,
}: {
  prediction: EngagementPrediction;
}): ReactElement {
  if (prediction.status === "disabled") {
    return (
      <Card title="Engagement Prediction">
        <Alert variant="warning" title="Prediction unavailable">
          {prediction.message}
        </Alert>
        <KeyValueList
          items={[
            {
              label: "Reason",
              value: prediction.reason,
            },
          ]}
        />
      </Card>
    );
  }

  return (
    <Card title="Engagement Prediction">
      <KeyValueList
        items={[
          {
            label: "Range",
            value: `${prediction.rangeLow} - ${prediction.rangeHigh}`,
          },
          {
            label: "Midpoint",
            value: prediction.midpoint,
          },
          {
            label: "Confidence",
            value: prediction.confidence,
          },
        ]}
      />
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

export function PostCoachCard({
  postCoach,
}: {
  postCoach: PostCoachViewModel;
}): ReactElement {
  if (postCoach.state === "empty") {
    return (
      <EmptyState title={postCoach.title}>
        <p>{postCoach.message}</p>
      </EmptyState>
    );
  }

  return (
    <Card title={postCoach.title}>
      <div className="xb-post-coach-card__summary">
        <ScoreBar
          label={postCoach.title}
          value={postCoach.value}
          bandLabel={postCoach.badge.label}
          helpText={postCoach.helperText}
        />
        <Tooltip label={postCoach.badge.tooltip}>
          <Badge variant={coachBadgeVariant(postCoach.badge.tone)}>
            {postCoach.badge.label}
          </Badge>
        </Tooltip>
      </div>
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
      <div className="xb-post-coach-card__engageability">
        <Badge variant={postCoach.engageability.engageable ? "success" : "warning"}>
          {postCoach.engageability.engageable ? "Engageable" : "Needs review"}
        </Badge>
        <span>{postCoach.engageability.reason}</span>
      </div>
      <div className="xb-post-coach-card__sections">
        {postCoach.sections.map((section) => (
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
      {postCoach.learnings.length > 0 ? (
        <div className="xb-post-coach-card__learnings">
          {postCoach.learnings.map((learning) => (
            <p key={learning.text}>{learning.text}</p>
          ))}
        </div>
      ) : null}
      <p className="xb-post-coach-card__caveat">{postCoach.learningCaveat}</p>
      <p className="xb-post-coach-card__footer">{postCoach.footerText}</p>
    </Card>
  );
}

export function CandidateDeterministicSummary({
  item,
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
      <KeyValueList
        items={[
          {
            label: "Source format",
            value: item.sourceFormat ?? "Unknown",
          },
          {
            label: "Detected format",
            value: item.detectedFormat,
          },
          {
            label: "Analyzer",
            value: item.analyzerVersion,
          },
        ]}
      />
      <ScoreBar
        label="Deterministic score"
        value={item.score.value}
        bandLabel={item.postCoach.state === "ready" ? item.postCoach.badge.label : undefined}
        helpText={item.heuristicLabel}
      />
      <PostCoachCard postCoach={item.postCoach} />
      <EngagementPredictionCard prediction={item.prediction} />
    </article>
  );
}

export function ManualScoringContextPanel({
  applyLabel = "Apply followers",
  context,
  disabled = false,
  error,
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
        value={value ?? context.followers ?? ""}
      />
      {isStale ? (
        <p className="xb-manual-scoring-context__stale">Prediction needs refresh.</p>
      ) : null}
      {onApplyFollowers === undefined ? null : (
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
        <Alert variant="danger" title="Could not load details">
          {props.message}
        </Alert>
      </aside>
    );
  }

  return (
    <aside className="xb-deterministic-detail-inspector" aria-label="Deterministic details">
      <h2>Deterministic details</h2>
      <CandidateDeterministicSummary
        item={props.item}
        onRetryScore={() => undefined}
      />
    </aside>
  );
}
