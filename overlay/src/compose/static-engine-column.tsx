// @x-builder/overlay — StaticEngineColumn (RIGHT cockpit zone)
//
// The purely presentational RIGHT-zone container of the compose cockpit. It
// receives an `AnalyzeState` (idle | scoring | ready | failed), an optional
// auto-supplied `followers` count, an `onRetryStatic` callback, and a
// MetricExplainer copy `source`, and renders the static (deterministic) metrics:
// a headline ScoreBar driven by `result.score.value`, the Post Coach
// failed/warned/passed check strip, the reach prediction block (or its disabled
// "no follower data" state), the per-item cooldown signal, and the deterministic
// recommendations. Compose detection / transport / debounce / the `analyzePosts`
// trigger are OUT OF SCOPE here — owned by XOB-029, which mounts this column and
// drives `analyzeState`.
//
// The static side of the cockpit is deliberately quiet: neutral score-band hues
// only, NO judge (`--xb-judge`) token and NO primary-CTA button. All visual
// values come from `--xb-*` / `--space-*` / `--score-*` tokens resolved on the
// overlay shadow `:host`; the v2 primitives are consumed cross-package the same
// way `settings/*` and `compose-generate-rail.tsx` do.

import type { AnalyzedPostItem } from "@x-builder/shared";
import type { ReactElement } from "react";

import { Alert } from "../ui/v2/alert";
import { Badge } from "../ui/v2/badge";
import { Button } from "../ui/v2/button";
import { ScoreBar } from "../ui/v2/score-bar";
import { Skeleton } from "../ui/v2/skeleton";

import { MetricExplainer } from "../explainer/metric-explainer";
import type { ExplainerSource, MetricKey } from "../explainer/types";

/** The `status: "scored"` variant of the real analyzed-post-item union. */
type ScoredPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;

/** Overlay-local analyze UI state (owned by ComposeCockpit, consumed here). */
export type AnalyzeState =
  | { status: "idle" }
  | { status: "scoring" }
  | { status: "ready"; result: ScoredPostItem }
  | { status: "failed"; error: string };

export interface StaticEngineColumnProps {
  analyzeState: AnalyzeState;
  followers?: number;
  onRetryStatic: () => void;
  explainer: ExplainerSource;
}

/** The verbatim channel caption identifying this side of the cockpit. */
const CHANNEL_CAPTION = "◆ Static engine";

/** How many ScoreBar slots stand in for the not-yet-scored metrics. */
const SLOT_COUNT = 3;

const CONTAINER_STYLE = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-3)",
  overflowY: "auto" as const,
  padding: "var(--space-3)",
  background: "var(--xb-surface-panel)",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--xb-glow-sm)",
};

const CAPTION_STYLE = {
  font: "var(--type-caption)",
  color: "var(--xb-text-muted)",
  letterSpacing: "0.1em",
};

const SECTION_TITLE_STYLE = {
  font: "var(--type-label)",
  color: "var(--xb-text-muted)",
  margin: 0,
};

const LABEL_ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
};

const LIST_STYLE = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--space-1)",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const PASSING_SUMMARY_STYLE = {
  cursor: "pointer" as const,
  font: "var(--type-label)",
  color: "var(--xb-text-muted)",
  userSelect: "none" as const,
};

/** A metric label followed by its inline MetricExplainer ⓘ trigger. */
function MetricLabel({
  text,
  metricKey,
  source,
  value,
}: {
  text: string;
  metricKey: MetricKey;
  source: ExplainerSource;
  value?: number | null;
}): ReactElement {
  return (
    <span style={LABEL_ROW_STYLE}>
      <span style={{ font: "var(--type-label)", color: "var(--xb-text)" }}>{text}</span>
      <MetricExplainer metricKey={metricKey} source={source} value={value ?? null} />
    </span>
  );
}

/** N ScoreBar slots in their loading state, standing in for pending metrics. */
function MetricSlotGroup({ busy }: { busy: boolean }): ReactElement {
  return (
    <div aria-busy={busy ? "true" : undefined} style={{ display: "grid", gap: "var(--space-2)" }}>
      {Array.from({ length: SLOT_COUNT }, (_, index) => (
        <ScoreBar key={index} label="Scoring" value={0} loading />
      ))}
    </div>
  );
}

/** A single Post Coach check rendered as its label plus a status badge. */
function CoachItem({
  label,
  variant,
  badgeText,
}: {
  label: string;
  variant: "success" | "warning" | "danger";
  badgeText: string;
}): ReactElement {
  return (
    <li style={LABEL_ROW_STYLE}>
      <Badge variant={variant}>{badgeText}</Badge>
      <span style={{ font: "var(--type-body-small)", color: "var(--xb-text)" }}>{label}</span>
    </li>
  );
}

/** Post Coach failed / warned / passed check labels (deterministic, not judge). */
function PostCoachStrip({
  result,
  source,
}: {
  result: ScoredPostItem;
  source: ExplainerSource;
}): ReactElement | null {
  const { postCoach } = result;
  if (postCoach.state !== "ready") return null;

  // Only the actionable checks (red Fix / yellow Nudge) show by default; the
  // passing (green) checks collapse behind a count so the column stays scannable
  // (XOB #6). An all-passing draft shows just the "N passing" disclosure.
  return (
    <section style={{ display: "grid", gap: "var(--space-2)" }}>
      <MetricLabel text="Post Coach" metricKey="postCoach" source={source} value={postCoach.value} />
      {postCoach.failed.length > 0 || postCoach.warned.length > 0 ? (
        <ul style={LIST_STYLE}>
          {postCoach.failed.map((check) => (
            <CoachItem key={check.id} label={check.label} variant="danger" badgeText="Fix" />
          ))}
          {postCoach.warned.map((check) => (
            <CoachItem key={check.id} label={check.label} variant="warning" badgeText="Nudge" />
          ))}
        </ul>
      ) : null}
      {postCoach.passed.length > 0 ? (
        <details>
          <summary style={PASSING_SUMMARY_STYLE}>{postCoach.passed.length} passing</summary>
          <ul style={{ ...LIST_STYLE, marginTop: "var(--space-1)" }}>
            {postCoach.passed.map((check) => (
              <CoachItem key={check.id} label={check.label} variant="success" badgeText="On point" />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** Reach range + escape probability, or the disabled "no follower data" state. */
function ReachPredictionBlock({
  result,
}: {
  result: ScoredPostItem;
}): ReactElement {
  const { prediction } = result;

  if (prediction.status === "disabled") {
    return (
      <section style={{ display: "grid", gap: "var(--space-1)" }}>
        <p style={SECTION_TITLE_STYLE}>Reach prediction</p>
        <p style={{ font: "var(--type-body-small)", color: "var(--xb-text-muted)", margin: 0 }}>
          {prediction.message}
        </p>
      </section>
    );
  }

  const escapePercent = Math.round(prediction.escapeProbability * 100);
  const predictionSummary = `${prediction.stallRange.low}–${prediction.stallRange.high} typical · ${escapePercent}% escape`;

  return (
    <section style={{ display: "grid", gap: "var(--space-1)" }}>
      <p style={SECTION_TITLE_STYLE}>Reach prediction</p>
      <div style={LABEL_ROW_STYLE}>
        <Badge variant="neutral">{predictionSummary}</Badge>
      </div>
    </section>
  );
}

/** Deterministic Post Coach recommendations (NOT judge suggestions). */
function RecommendationsList({ result }: { result: ScoredPostItem }): ReactElement | null {
  const { postCoach } = result;
  if (postCoach.state !== "ready") return null;
  const items = [...postCoach.failed, ...postCoach.warned];
  if (items.length === 0) return null;

  return (
    <section style={{ display: "grid", gap: "var(--space-1)" }}>
      <p style={SECTION_TITLE_STYLE}>{postCoach.helperText}</p>
      <ul style={LIST_STYLE}>
        {items.map((check) => (
          <li
            key={check.id}
            style={{ font: "var(--type-body-small)", color: "var(--xb-text)" }}
          >
            {check.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReplyThreadDiagnostics({ result }: { result: ScoredPostItem }): ReactElement | null {
  const diagnostics = result.replyThreadContextDiagnostics;
  if (diagnostics === undefined || diagnostics.status === "thread_ready") {
    return null;
  }

  const messages =
    diagnostics.uiMessages.length > 0
      ? diagnostics.uiMessages
      : diagnostics.missing.map((entry) => {
          const target = entry.statusId === undefined ? "" : ` (${entry.statusId})`;
          return `Missing ${entry.field.replaceAll("_", " ")}${target}.`;
        });

  if (messages.length === 0) return null;

  return (
    <Alert variant={diagnostics.status === "blocked_missing_required_parent" ? "danger" : "warning"}>
      <span>Reply context incomplete</span>
      <ul style={{ ...LIST_STYLE, marginTop: "var(--space-1)" }}>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </Alert>
  );
}

/** The ready-state body: headline ScoreBar, cooldown, Post Coach, reach, recs. */
function ReadyBody({
  result,
  source,
}: {
  result: ScoredPostItem;
  source: ExplainerSource;
}): ReactElement {
  const { cooldown } = result;
  const showCooldown = cooldown !== undefined && cooldown.status !== "clear";

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <ScoreBar label="Static score" value={result.score.value} />
      {showCooldown ? (
        <div style={LABEL_ROW_STYLE}>
          <Badge variant="warning">{cooldown.message}</Badge>
        </div>
      ) : null}
      <ReplyThreadDiagnostics result={result} />
      <ReachPredictionBlock result={result} />
      <PostCoachStrip result={result} source={source} />
      <RecommendationsList result={result} />
    </div>
  );
}

/** The RIGHT-zone static-engine column. Purely presentational over its props. */
export function StaticEngineColumn({
  analyzeState,
  onRetryStatic,
  explainer,
}: StaticEngineColumnProps): ReactElement {
  return (
    <div style={CONTAINER_STYLE}>
      <span style={CAPTION_STYLE}>{CHANNEL_CAPTION}</span>

      {analyzeState.status === "idle" ? <MetricSlotGroup busy={false} /> : null}
      {analyzeState.status === "scoring" ? <MetricSlotGroup busy /> : null}
      {analyzeState.status === "ready" ? (
        <ReadyBody result={analyzeState.result} source={explainer} />
      ) : null}
      {analyzeState.status === "failed" ? (
        <Alert variant="danger">
          <span>Static scoring failed. {analyzeState.error}</span>
          <div style={{ marginTop: "var(--space-2)" }}>
            <Button variant="secondary" onClick={onRetryStatic}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}
    </div>
  );
}
