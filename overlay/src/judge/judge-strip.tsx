// @x-builder/overlay — JudgeStrip (UNDER cockpit zone)
//
// The purely presentational UNDER-zone container of the compose cockpit. It
// receives a `JudgeState` (waiting | unavailable | running | judged | failed),
// the derived `ProvenanceState` bare-string union, an opaque `ApplyState`
// (idle in this ticket — apply-affordance is XOB-027), an `onRetryJudge`
// callback, and a MetricExplainer copy `source`, and renders the judge channel:
// the waiting/running indicator (with a token-driven, reduced-motion-gated
// pulse), the verdict band Badge + confidence, the 13-dim ScoreBar grid wired to
// the inline MetricExplainer triggers, the strengths/improvements notes, the
// danger Alert + ghost retry Button on failure, and the quiet unavailable hint.
// A polite `aria-live` region carries the band + overall once the verdict lands.
//
// The judge channel's identity is carried at the CONTAINER level (the `--xb-judge`
// edge accent + `--xb-glow-judge` + "✦ AI judge" caption + the pulse) — never on
// the ScoreBar fills, which keep their neutral `--score-*` band hues (the v2
// ScoreBar exposes no tint prop). No primary CTA / `--xb-accent` button fill ever
// appears here; the retry Button is `ghost`. The judge transport, the `judgeDraft`
// kick, edit-while-judging abort, and the generate-refine BRANCHING are OUT OF
// SCOPE here (owned by ComposeCockpit, XOB-029); JudgeStrip only renders what
// `judge` + `provenance` tell it. All visual values come from `--xb-*` /
// `--space-*` / `--type-*` / `--score-*` tokens resolved on the overlay shadow
// `:host`; the v2 primitives are consumed cross-package the same way
// `static-engine-column.tsx` and `compose-generate-rail.tsx` do.

import { deriveApproved, type JudgeVerdict, type JudgeVerdictLabel } from "@x-builder/shared";
import type { CSSProperties, ReactElement } from "react";

import { Alert } from "../../../client/src/ui/v2/alert";
import { Badge } from "../../../client/src/ui/v2/badge";
import { Button } from "../../../client/src/ui/v2/button";
import { ScoreBar } from "../../../client/src/ui/v2/score-bar";

import { MetricExplainer } from "../explainer/metric-explainer";
import type { ExplainerSource, MetricKey } from "../explainer/types";
import type { ProvenanceState } from "../provenance/derive-provenance-state";

/** Overlay-local judge UI state (owned by ComposeCockpit, consumed here). */
export type JudgeState =
  | { status: "waiting" }
  | { status: "unavailable"; hint: string }
  | { status: "running" }
  | { status: "judged"; verdict: JudgeVerdict }
  | { status: "failed"; error: string };

/**
 * Opaque apply-affordance state (defined fully in XOB-027). `JudgeStrip` accepts
 * it and forwards it to its apply child there; in this ticket's scope it defaults
 * to `"idle"` and is not otherwise consumed.
 */
export type ApplyState =
  | "idle"
  | "applying"
  | { status: "applied"; improvedOverOriginal: boolean }
  | { status: "failed"; error: string };

export interface JudgeStripProps {
  judge: JudgeState;
  provenance: ProvenanceState;
  applyState: ApplyState;
  onRetryJudge: () => void;
  onApplyAll: () => void;
  explainer: ExplainerSource;
}

/** The verbatim channel caption identifying the judge side of the cockpit. */
const CHANNEL_CAPTION = "✦ AI judge";

/** Class name on the pulse dot; its keyframe + reduced-motion gate live inline. */
const PULSE_CLASS = "xb-judge-pulse-dot";

/**
 * The 13 judge score dimensions, in render order, each paired with its human
 * label and its MetricExplainer `MetricKey`. The keys are exactly the dims on
 * `JudgeVerdict["scores"]`, so the grid is always thirteen bars wide.
 */
const SCORE_DIMS: ReadonlyArray<{ key: MetricKey & keyof JudgeVerdict["scores"]; label: string }> = [
  { key: "overall", label: "Overall" },
  { key: "replies", label: "Replies" },
  { key: "profileClicks", label: "Profile clicks" },
  { key: "impressions", label: "Impressions" },
  { key: "bookmarkValue", label: "Bookmark value" },
  { key: "dwellProxy", label: "Dwell proxy" },
  { key: "voiceMatch", label: "Voice match" },
  { key: "negativeRisk", label: "Negative risk" },
  { key: "answerEffort", label: "Answer effort" },
  { key: "strangerAnswerability", label: "Stranger answerability" },
  { key: "statusDependency", label: "Status dependency" },
  { key: "replyVsQuoteOrientation", label: "Reply vs quote" },
  { key: "audienceMatch", label: "Audience match" },
];

/** Verdict band → human label + the Badge/band token that paints the channel. */
const BAND_LABEL: Record<JudgeVerdictLabel, string> = {
  post_now: "Post now",
  slight_rework: "Slight rework",
  major_rework: "Major rework",
  do_not_post: "Do not post",
};

const BAND_TOKEN: Record<JudgeVerdictLabel, string> = {
  post_now: "var(--xb-band-post-now)",
  slight_rework: "var(--xb-band-slight)",
  major_rework: "var(--xb-band-major)",
  do_not_post: "var(--xb-band-donot)",
};

const CONTAINER_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-3)",
  background: "var(--xb-surface-panel)",
  border: "var(--border-width-thin) solid var(--xb-judge)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--xb-glow-judge)",
};

const CAPTION_STYLE: CSSProperties = {
  font: "var(--type-caption)",
  color: "var(--xb-text-muted)",
  letterSpacing: "0.1em",
};

const SECTION_TITLE_STYLE: CSSProperties = {
  font: "var(--type-label)",
  color: "var(--xb-text-muted)",
  margin: 0,
};

const LABEL_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
};

const LIST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const QUIET_TEXT_STYLE: CSSProperties = {
  font: "var(--type-body-small)",
  color: "var(--xb-text-muted)",
  margin: 0,
};

/**
 * The component-local keyframe sheet. Rendered INTO the shadow subtree so the
 * `@keyframes xb-judge-pulse` ident is real and the computed `animation-name`
 * resolves to it (not `none`). The keyframe is gated SEPARATELY under
 * `prefers-reduced-motion: reduce` via `animation-name: none` — independent of
 * the `--xb-pulse-duration` token — so reduced-motion users get no pulse even if
 * the duration var is non-zero (DoD: "gated keyframe, not relying on the
 * duration var"). The dot still carries its static "Running…" affordance and
 * `aria-busy` regardless of whether the animation plays.
 */
const PULSE_STYLE_SHEET = `
.${PULSE_CLASS} {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--xb-judge);
  box-shadow: var(--xb-glow-judge);
  animation-name: xb-judge-pulse;
  animation-duration: var(--xb-pulse-duration, 1100ms);
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}

@keyframes xb-judge-pulse {
  0%, 100% { opacity: 0.45; box-shadow: 0 0 4px var(--xb-judge); }
  50% { opacity: 1; box-shadow: var(--xb-glow-judge); }
}

@media (prefers-reduced-motion: reduce) {
  .${PULSE_CLASS} {
    animation-name: none;
  }
}
`;

/** A metric label followed by its inline MetricExplainer ⓘ trigger. */
function DimLabel({
  text,
  metricKey,
  source,
  value,
}: {
  text: string;
  metricKey: MetricKey;
  source: ExplainerSource;
  value: number | null;
}): ReactElement {
  return (
    <span style={LABEL_ROW_STYLE}>
      <span style={{ font: "var(--type-label)", color: "var(--xb-text)" }}>{text}</span>
      <MetricExplainer metricKey={metricKey} source={source} value={value} />
    </span>
  );
}

/**
 * The running indicator: a token-driven pulse dot (`data-judge-pulse="animated"`)
 * plus a static "AI judge running" / "Running…" label. The region is
 * `aria-busy="true"` so a no-pulse (reduced-motion) environment still announces
 * work without depending on the animation playing.
 */
function JudgeWaitingIndicator(): ReactElement {
  return (
    <div aria-busy="true" style={LABEL_ROW_STYLE}>
      <style>{PULSE_STYLE_SHEET}</style>
      <span aria-hidden="true" className={PULSE_CLASS} data-judge-pulse="animated" />
      <span style={{ font: "var(--type-label)", color: "var(--xb-text)" }}>
        AI judge running · Running…
      </span>
    </div>
  );
}

/** The verdict band Badge + confidence + provenance-gated approval Badge. */
function JudgeVerdictHeader({
  verdict,
  provenance,
}: {
  verdict: JudgeVerdict;
  provenance: ProvenanceState;
}): ReactElement {
  // "✓ Judge approved" shows IFF the text came from the generator AND the verdict
  // is approved (post_now / slight_rework, via shared's single source of truth).
  const showApproved = provenance === "generated" && deriveApproved(verdict);

  return (
    <div style={LABEL_ROW_STYLE}>
      <Badge variant="neutral">{BAND_LABEL[verdict.verdict]}</Badge>
      <Badge variant="info">{verdict.confidence} confidence</Badge>
      {showApproved ? <Badge variant="success">✓ Judge approved</Badge> : null}
    </div>
  );
}

/** The 13-dim ScoreBar grid; identity stays neutral (no `--xb-judge` tint). */
function JudgeScoreGrid({
  verdict,
  source,
}: {
  verdict: JudgeVerdict;
  source: ExplainerSource;
}): ReactElement {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      {SCORE_DIMS.map((dim) => {
        const value = verdict.scores[dim.key];
        return (
          <div key={dim.key} style={{ display: "grid", gap: "var(--space-1)" }}>
            <DimLabel text={dim.label} metricKey={dim.key} source={source} value={value} />
            <ScoreBar label={dim.label} value={value ?? 0} />
          </div>
        );
      })}
    </div>
  );
}

/** Strengths + improvements notes. */
function JudgeNotesList({ verdict }: { verdict: JudgeVerdict }): ReactElement {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <section style={{ display: "grid", gap: "var(--space-1)" }}>
        <p style={SECTION_TITLE_STYLE}>Strengths</p>
        <ul style={LIST_STYLE}>
          {verdict.strengths.map((note) => (
            <li key={note} style={{ font: "var(--type-body-small)", color: "var(--xb-text)" }}>
              {note}
            </li>
          ))}
        </ul>
      </section>
      <section style={{ display: "grid", gap: "var(--space-1)" }}>
        <p style={SECTION_TITLE_STYLE}>Improvements</p>
        <ul style={LIST_STYLE}>
          {verdict.improvements.map((note) => (
            <li key={note} style={{ font: "var(--type-body-small)", color: "var(--xb-text)" }}>
              {note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The judged body: header + grid + notes + the polite verdict announcement. */
function JudgedBody({
  verdict,
  provenance,
  source,
}: {
  verdict: JudgeVerdict;
  provenance: ProvenanceState;
  source: ExplainerSource;
}): ReactElement {
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <JudgeVerdictHeader verdict={verdict} provenance={provenance} />
      <JudgeScoreGrid verdict={verdict} source={source} />
      <JudgeNotesList verdict={verdict} />
    </div>
  );
}

/**
 * The Apply-all affordance (XOB-027). The "✦ Apply all suggestions" Button is a
 * judge-cyan ghost (`--xb-judge` border, judge-cyan label) — NEVER a primary
 * `--xb-accent` fill — so it stays inside the judge channel and never reads as
 * the post CTA. Clicking it fires `onApplyAll`, which `ComposeCockpit` (XOB-029)
 * routes into `applyJudgeSuggestions({ text })`.
 */
function ApplyAllButton({ onApplyAll }: { onApplyAll: () => void }): ReactElement {
  // The ghost Button keeps a transparent fill (never the primary `--xb-accent`
  // CTA); the judge-cyan edge accent rides on a wrapping span so the affordance
  // stays inside the judge channel without touching the v2 Button surface.
  return (
    <span
      style={{
        display: "inline-flex",
        borderRadius: "var(--radius-md)",
        border: "var(--border-width-thin) solid var(--xb-judge)",
        color: "var(--xb-judge)",
        boxShadow: "var(--xb-glow-judge)",
      }}
    >
      <Button variant="ghost" onClick={onApplyAll}>
        ✦ Apply all suggestions
      </Button>
    </span>
  );
}

/**
 * The applying indicator (XOB-027). Reuses the running pulse dot
 * (`data-judge-pulse="animated"` + the gated `xb-judge-pulse` keyframe) for the
 * motion, but the load-bearing affordance is the STATIC "Improving…" label plus
 * the `aria-busy="true"` region — both independent of whether the animation
 * plays, so the reduced-motion environment still announces the in-flight apply.
 * No clickable Apply-all exists in this state (it is the loading replacement).
 */
function ApplyingIndicator(): ReactElement {
  return (
    <div aria-busy="true" style={LABEL_ROW_STYLE}>
      <style>{PULSE_STYLE_SHEET}</style>
      <span aria-hidden="true" className={PULSE_CLASS} data-judge-pulse="animated" />
      <span style={{ font: "var(--type-label)", color: "var(--xb-text)" }}>Improving…</span>
    </div>
  );
}

/**
 * The AlreadySolid banner (XOB-027): the guard kept the original because no safe
 * improvement was found. Informational `Alert variant="warning"` (amber) — NOT a
 * danger/error state. The text was still re-pinned green, so provenance is
 * `generated`; the "✓ Judge approved" badge is governed independently by
 * `deriveApproved` in `JudgeVerdictHeader` and is not forced here.
 */
function AlreadySolidBanner(): ReactElement {
  return (
    <Alert variant="warning">
      <span>Already solid — no safe improvement found</span>
    </Alert>
  );
}

/**
 * The apply-failure banner (XOB-027): a danger `Alert` showing the apply error
 * with a ghost retry Button that drives `onApplyAll` — the APPLY retry, distinct
 * from the judge-failure retry (`onRetryJudge`). The composer text is untouched
 * (owned by `ComposeCockpit`); state stays `user_written / judged`.
 */
function ApplyFailureBanner({
  error,
  onApplyAll,
}: {
  error: string;
  onApplyAll: () => void;
}): ReactElement {
  return (
    <Alert variant="danger">
      <span>Couldn’t apply suggestions. {error}</span>
      <div style={{ marginTop: "var(--space-2)" }}>
        <Button variant="ghost" onClick={onApplyAll}>
          Retry
        </Button>
      </div>
    </Alert>
  );
}

/**
 * The apply-affordance render for the current `applyState` + `provenance` +
 * `judge`. This is the loop-prevention guard: the Apply-all button is rendered
 * ONLY in `user_written` + judged + `idle`, so the system never re-improves its
 * own (`generated`) output — and no path here fires `onApplyAll` in `generated`.
 */
function ApplySection({
  judge,
  provenance,
  applyState,
  onApplyAll,
}: {
  judge: JudgeState;
  provenance: ProvenanceState;
  applyState: ApplyState;
  onApplyAll: () => void;
}): ReactElement | null {
  if (applyState === "idle") {
    // Apply-all is shown (not just enabled) only on a landed verdict in
    // user-written text; absent from the DOM otherwise (generated / not judged).
    if (provenance === "user_written" && judge.status === "judged") {
      return <ApplyAllButton onApplyAll={onApplyAll} />;
    }
    return null;
  }

  if (applyState === "applying") {
    return <ApplyingIndicator />;
  }

  if (applyState.status === "failed") {
    return <ApplyFailureBanner error={applyState.error} onApplyAll={onApplyAll} />;
  }

  // applied: improvedOverOriginal === false surfaces the AlreadySolid banner;
  // improvedOverOriginal === true relies on the XOB-026 "✓ Judge approved" badge
  // already rendered in JudgedBody (gated by provenance + deriveApproved) — no
  // duplicate banner here.
  if (!applyState.improvedOverOriginal) {
    return <AlreadySolidBanner />;
  }
  return null;
}

/**
 * Build the polite-region announcement text for the current judge state. While
 * not yet judged the region is empty (no verdict to announce); once judged it
 * carries the band identity + the overall score, which is what the live region
 * reads out on the `running → judged` transition. `unavailable` announces its
 * quiet status (no danger, no pulse).
 */
function announcement(judge: JudgeState): string {
  if (judge.status === "judged") {
    return `Judge verdict: ${BAND_LABEL[judge.verdict.verdict]} · overall ${judge.verdict.scores.overall}`;
  }
  if (judge.status === "unavailable") {
    return "Judge unavailable — configure in Settings.";
  }
  return "";
}

/** The UNDER-zone judge strip. Purely presentational over its props. */
export function JudgeStrip({
  judge,
  provenance,
  applyState,
  onRetryJudge,
  onApplyAll,
  explainer,
}: JudgeStripProps): ReactElement {
  return (
    <div style={CONTAINER_STYLE}>
      <span style={CAPTION_STYLE}>{CHANNEL_CAPTION}</span>

      {judge.status === "waiting" ? (
        <p style={QUIET_TEXT_STYLE}>Waiting for draft…</p>
      ) : null}

      {judge.status === "running" ? <JudgeWaitingIndicator /> : null}

      {judge.status === "judged" ? (
        <JudgedBody verdict={judge.verdict} provenance={provenance} source={explainer} />
      ) : null}

      {judge.status === "failed" ? (
        <Alert variant="danger">
          <span>AI judge failed. {judge.error}</span>
          <div style={{ marginTop: "var(--space-2)" }}>
            <Button variant="ghost" onClick={onRetryJudge}>
              Retry judge
            </Button>
          </div>
        </Alert>
      ) : null}

      {judge.status === "unavailable" ? (
        <p style={QUIET_TEXT_STYLE}>{judge.hint}</p>
      ) : null}

      <ApplySection
        judge={judge}
        provenance={provenance}
        applyState={applyState}
        onApplyAll={onApplyAll}
      />

      <div aria-live="polite" style={{ font: "var(--type-caption)", color: "var(--xb-text-muted)" }}>
        {announcement(judge)}
      </div>
    </div>
  );
}
