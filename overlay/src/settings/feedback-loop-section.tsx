// @x-builder/overlay - FeedbackLoopSettingsSection
//
// Dense settings-panel surface for server-derived My Feedback Loop summaries.
// It deliberately renders only getFeedbackLoopSummary data; all aggregation and
// matching decisions stay in the engine.

import type {
  FeedbackFormatLearning,
  FeedbackOutcome,
  GetFeedbackLoopSummaryResponse,
} from "@x-builder/shared";
import { useState, type CSSProperties, type ReactElement } from "react";

import { Alert } from "../ui/v2/alert";
import { Badge, type BadgeProps } from "../ui/v2/badge";
import { Button } from "../ui/v2/button";
import { EmptyState } from "../ui/v2/empty-state";
import { Input } from "../ui/v2/input";
import { KeyValueList, type KeyValueItem } from "../ui/v2/key-value-list";
import { Skeleton } from "../ui/v2/skeleton";

type Loadable<T> = T | "loading" | { error: unknown };

type FeedbackLinkFormState =
  | { status: "idle"; platformPostId: string }
  | { status: "linking"; platformPostId: string }
  | { status: "linked"; platformPostId: string }
  | { status: "failed"; platformPostId: string; message: string };

export interface FeedbackLoopSettingsSectionProps {
  summary: Loadable<GetFeedbackLoopSummaryResponse>;
  onRefresh(): void;
  onLink(predictionId: string, platformPostId: string): Promise<void>;
}

const STACK_STYLE: CSSProperties = {
  display: "grid",
  gap: "var(--space-2)",
};

const ROW_STYLE: CSSProperties = {
  display: "grid",
  gap: "var(--space-2)",
  paddingBlock: "var(--space-2)",
  borderTop: "var(--border-width-thin) solid var(--xb-border-edge)",
};

const ROW_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  flexWrap: "wrap",
};

const MUTED_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-body-small)",
  color: "var(--xb-text-muted)",
};

const TEXT_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-body-small)",
  color: "var(--xb-text)",
  overflowWrap: "anywhere",
};

const LINK_FORM_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "var(--space-2)",
  alignItems: "center",
};

const CANDIDATES_STYLE: CSSProperties = {
  display: "flex",
  gap: "var(--space-1)",
  flexWrap: "wrap",
};

function isError<T>(value: Loadable<T>): value is { error: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function totalsItems(summary: GetFeedbackLoopSummaryResponse): KeyValueItem[] {
  return [
    { key: "Predictions", value: String(summary.totals.predictions) },
    { key: "Linked", value: String(summary.totals.linked) },
    { key: "Actuals", value: String(summary.totals.actuals) },
    { key: "Pending", value: String(summary.totals.pendingUnlinked) },
    { key: "Ambiguous", value: String(summary.totals.ambiguous) },
    { key: "Partial actuals", value: String(summary.totals.partialActuals) },
  ];
}

function statusLabel(outcome: FeedbackOutcome): string {
  if (outcome.status === "linked") {
    switch (outcome.link?.method) {
      case "normalized_content_hash":
        return "Auto-linked";
      case "recorded_platform_post_id":
        return "Linked from captured post";
      case "manual_platform_post_id":
        return "Linked manually";
      default:
        return "Linked";
    }
  }
  if (outcome.status === "pending_unlinked") {
    return outcome.prediction.action === "manual_record_posted_draft"
      ? "Needs link"
      : "Waiting for captured post";
  }
  if (outcome.status === "ambiguous") return "Multiple possible posts found";
  return "Linked, waiting for impressions";
}

function statusVariant(status: FeedbackOutcome["status"]): BadgeProps["variant"] {
  return status === "linked" ? "success" : "warning";
}

function learningVariant(direction: FeedbackFormatLearning["direction"]): BadgeProps["variant"] {
  switch (direction) {
    case "up":
      return "success";
    case "down":
      return "warning";
    case "stable":
      return "info";
    case "insufficient_data":
      return "warning";
  }
}

function deltaCopy(outcome: FeedbackOutcome): string {
  const delta = outcome.delta;
  if (delta?.actualImpressions !== undefined) {
    const ratio = delta.ratio !== undefined ? `, ${delta.ratio.toFixed(2)}x` : "";
    return `Predicted ${delta.predictedMidImpressions}, actual ${delta.actualImpressions}${ratio}`;
  }
  return `Predicted ${outcome.prediction.prediction.predictedMidImpressions}, actual pending`;
}

function canLink(outcome: FeedbackOutcome): boolean {
  return outcome.status === "pending_unlinked" || outcome.status === "ambiguous";
}

export function parseFeedbackPlatformPostId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9]{5,40}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/\/status\/([0-9]{5,40})(?:[/?#]|$)/);
  return match?.[1] ?? null;
}

function FormFeedback({ state }: { state: FeedbackLinkFormState }): ReactElement | null {
  if (state.status === "linked") {
    return <Badge variant="success">Linked manually</Badge>;
  }
  if (state.status === "failed") {
    return <Alert variant="warning">{state.message}</Alert>;
  }
  return null;
}

function FormatLearningRow({ learning }: { learning: FeedbackFormatLearning }): ReactElement {
  return (
    <div style={ROW_STYLE}>
      <div style={ROW_HEADER_STYLE}>
        <strong style={{ font: "var(--type-body-small)", color: "var(--xb-text)" }}>
          {formatLabel(learning.format)}
        </strong>
        <Badge variant={learningVariant(learning.direction)}>
          {formatLabel(learning.direction)}
        </Badge>
      </div>
      <KeyValueList
        items={[
          { key: "Predictions", value: String(learning.predictionCount) },
          { key: "Linked", value: String(learning.linkedCount) },
          { key: "Actuals", value: String(learning.actualCount) },
          {
            key: "Median actual",
            value:
              learning.medianActualImpressions !== undefined
                ? String(learning.medianActualImpressions)
                : "Pending",
          },
        ]}
      />
      <p style={MUTED_STYLE}>{learning.adjustment}</p>
    </div>
  );
}

export function FeedbackLoopSettingsSection({
  summary,
  onRefresh,
  onLink,
}: FeedbackLoopSettingsSectionProps): ReactElement {
  const [forms, setForms] = useState<Record<string, FeedbackLinkFormState>>({});

  const setForm = (predictionId: string, state: FeedbackLinkFormState): void => {
    setForms((current) => ({ ...current, [predictionId]: state }));
  };

  const formFor = (predictionId: string): FeedbackLinkFormState =>
    forms[predictionId] ?? { status: "idle", platformPostId: "" };

  const submitLink = (outcome: FeedbackOutcome): void => {
    const current = formFor(outcome.prediction.id);
    const platformPostId = parseFeedbackPlatformPostId(current.platformPostId);
    if (platformPostId === null) {
      setForm(outcome.prediction.id, {
        status: "failed",
        platformPostId: current.platformPostId,
        message: "Enter a numeric X post id or status URL.",
      });
      return;
    }

    setForm(outcome.prediction.id, { status: "linking", platformPostId });
    void onLink(outcome.prediction.id, platformPostId)
      .then(() => setForm(outcome.prediction.id, { status: "linked", platformPostId }))
      .catch((error: unknown) =>
        setForm(outcome.prediction.id, {
          status: "failed",
          platformPostId,
          message: messageOf(error, "Could not link post."),
        }),
      );
  };

  if (summary === "loading") {
    return (
      <div style={STACK_STYLE}>
        <Skeleton />
        <Button variant="ghost" size="sm" flat onClick={onRefresh}>Refresh</Button>
      </div>
    );
  }

  if (isError(summary)) {
    return (
      <div style={STACK_STYLE}>
        <Alert variant="danger">Could not load feedback summary.</Alert>
        <Button variant="secondary" size="sm" flat onClick={onRefresh}>Refresh</Button>
      </div>
    );
  }

  if (summary.totals.predictions === 0) {
    return (
      <EmptyState
        title="No feedback yet"
        action={<Button variant="secondary" size="sm" flat onClick={onRefresh}>Refresh</Button>}
      >
        No recorded predictions yet.
      </EmptyState>
    );
  }

  return (
    <div style={STACK_STYLE}>
      <div style={ROW_HEADER_STYLE}>
        <KeyValueList items={totalsItems(summary)} />
        <Button variant="ghost" size="sm" flat onClick={onRefresh}>Refresh</Button>
      </div>

      {summary.totals.partialActuals > 0 ? (
        <Alert variant="warning">Some linked posts are waiting for impressions.</Alert>
      ) : null}

      <div style={STACK_STYLE}>
        <p style={MUTED_STYLE}>Format learnings</p>
        {summary.formatLearnings.length > 0 ? (
          summary.formatLearnings.map((learning) => (
            <FormatLearningRow key={learning.format} learning={learning} />
          ))
        ) : (
          <p style={MUTED_STYLE}>Insufficient data.</p>
        )}
      </div>

      <div style={STACK_STYLE}>
        <p style={MUTED_STYLE}>Recent outcomes</p>
        {summary.recent.map((outcome) => {
          const form = formFor(outcome.prediction.id);
          return (
            <div key={outcome.prediction.id} data-feedback-outcome style={ROW_STYLE}>
              <div style={ROW_HEADER_STYLE}>
                <Badge variant={statusVariant(outcome.status)}>{statusLabel(outcome)}</Badge>
                <span style={MUTED_STYLE}>{formatLabel(outcome.prediction.detectedFormat)}</span>
              </div>
              <p style={TEXT_STYLE}>{outcome.prediction.text}</p>
              <p style={MUTED_STYLE}>{deltaCopy(outcome)}</p>
              {outcome.link ? (
                <p style={MUTED_STYLE}>Post {outcome.link.platformPostId}</p>
              ) : null}

              {canLink(outcome) ? (
                <div style={STACK_STYLE} aria-live="polite">
                  {outcome.ambiguity?.candidatePlatformPostIds.length ? (
                    <div style={CANDIDATES_STYLE}>
                      {outcome.ambiguity.candidatePlatformPostIds.map((candidateId) => (
                        <Button
                          key={candidateId}
                          variant="ghost"
                          size="sm"
                          flat
                          onClick={() =>
                            setForm(outcome.prediction.id, {
                              status: "idle",
                              platformPostId: candidateId,
                            })
                          }
                        >
                          {candidateId}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <div style={LINK_FORM_STYLE}>
                    <Input
                      value={form.platformPostId}
                      onChange={(value) =>
                        setForm(outcome.prediction.id, { status: "idle", platformPostId: value })
                      }
                      aria-label={`Platform post id for ${outcome.prediction.id}`}
                      disabled={form.status === "linking"}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      flat
                      loading={form.status === "linking"}
                      disabled={form.status === "linking" || form.platformPostId.trim() === ""}
                      onClick={() => submitLink(outcome)}
                    >
                      Link
                    </Button>
                  </div>
                  <FormFeedback state={form} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
