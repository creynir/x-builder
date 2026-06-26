// @x-builder/client — v2 ScoreBar primitive (token-driven, shadow-DOM-portable)
//
// A fresh, self-contained score bar built for XOB-025 (its first consumer). It
// mirrors the legacy `ScoreBarProps` ({ label, value, max?, bandLabel?,
// helpText?, loading?, disabled? }) but, unlike the legacy `foundation.tsx`
// ScoreBar (which renders via global CSS classnames), it carries every style
// inline as a `var(--…)` reference into the seeded token closure so it travels
// into the overlay shadow `:host` with zero global CSS.
//
// The fill is a neutral score-band swatch: `value` maps to one of
// `strong/good/usable/needs-rewrite` (descending) and `unknown` while loading or
// without a real value. The fill paints the matching `--score-…` token and NEVER
// the judge (`--xb-judge`) or accent CTA (`--xb-accent`) hue — the score side
// stays visually quiet. The single fill element carries `data-score-fill` (with
// an inline percentage `width`) and `data-score-band` so its band is legible
// without reading colour.

import type { CSSProperties, ReactElement } from "react";

export interface ScoreBarProps {
  label: string;
  value: number;
  max?: number;
  bandLabel?: string;
  helpText?: string;
  loading?: boolean;
  disabled?: boolean;
}

/** The neutral score-band vocabulary, each mapped to its design-system token. */
export type ScoreBand = "strong" | "good" | "usable" | "needs-rewrite" | "unknown";

const BAND_TOKEN: Record<ScoreBand, string> = {
  strong: "var(--score-strong)",
  good: "var(--score-good)",
  usable: "var(--score-usable)",
  "needs-rewrite": "var(--score-needs-rewrite)",
  unknown: "var(--score-unknown)",
};

/**
 * Descending band thresholds over a 0–100 score. Mirrors the design-system
 * score-band swatches (≈88 strong, ≈82 good, ≈74 usable, lower → needs-rewrite);
 * `unknown` covers the no-value (loading) case so a bar never paints a band it
 * has not earned.
 */
function bandFor(percent: number): ScoreBand {
  if (percent >= 80) return "strong";
  if (percent >= 70) return "good";
  if (percent >= 50) return "usable";
  return "needs-rewrite";
}

/** Clamp `value / max` into 0…1 then express it as a percentage string. */
function fillWidth(value: number, max: number): { ratio: number; width: string } {
  const ratio = Math.min(Math.max(value / max, 0), 1);
  return { ratio, width: `${ratio * 100}%` };
}

const CONTAINER_STYLE: CSSProperties = {
  display: "grid",
  gap: "var(--space-1)",
  minWidth: 0,
};

const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  minWidth: 0,
};

const LABEL_STYLE: CSSProperties = {
  font: "var(--type-label)",
  color: "var(--xb-text)",
  minWidth: 0,
};

const VALUE_STYLE: CSSProperties = {
  font: "var(--type-panel-title)",
  color: "var(--xb-text)",
};

const TRACK_STYLE: CSSProperties = {
  position: "relative",
  height: "var(--space-2)",
  overflow: "hidden",
  borderRadius: "var(--radius-full)",
  background: "var(--surface-sunken)",
};

const META_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  font: "var(--type-caption)",
  color: "var(--xb-text-muted)",
};

/** A token-driven, shadow-portable score bar with a neutral band fill. */
export function ScoreBar({
  label,
  value,
  max = 100,
  bandLabel,
  helpText,
  loading = false,
  disabled = false,
}: ScoreBarProps): ReactElement {
  const boundedMax = max > 0 ? max : 100;
  const { ratio, width } = fillWidth(value, boundedMax);
  // While loading there is no earned score, so the band reads `unknown` and the
  // numeric value is suppressed.
  const band: ScoreBand = loading ? "unknown" : bandFor(ratio * 100);

  return (
    <div style={{ ...CONTAINER_STYLE, opacity: disabled ? 0.72 : 1 }}>
      <div style={HEADER_STYLE}>
        <span style={LABEL_STYLE}>{label}</span>
        {loading ? null : <span style={VALUE_STYLE}>{value}</span>}
      </div>
      {loading ? (
        <div
          aria-busy="true"
          data-skeleton=""
          role="status"
          aria-label={`${label} loading`}
          style={{
            height: "var(--space-2)",
            borderRadius: "var(--radius-full)",
            background: "var(--neutral-4)",
            opacity: 0.6,
          }}
        />
      ) : (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={boundedMax}
          aria-disabled={disabled ? "true" : undefined}
          style={TRACK_STYLE}
        >
          <span
            data-score-fill=""
            data-score-band={band}
            style={{
              position: "absolute",
              insetBlock: 0,
              insetInlineStart: 0,
              width,
              borderRadius: "inherit",
              background: BAND_TOKEN[band],
            }}
          />
        </div>
      )}
      {bandLabel || helpText ? (
        <div style={META_STYLE}>
          {bandLabel ? <span>{bandLabel}</span> : null}
          {helpText ? <span>{helpText}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
