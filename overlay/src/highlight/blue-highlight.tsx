// @x-builder/overlay — BlueHighlight (one underlay span per quote rect)
//
// A single `<span role="mark">` positioned absolutely over one `getClientRects()`
// rect of a located annotation quote. It is the only pointer-interactive element
// in the highlight layer (`pointer-events:auto`) so a future hover tooltip
// (XOB-027) can attach; the layer around it stays `pointer-events:none` and the
// span NEVER mutates X's composer DOM. The `recommendation` rides as `aria-label`
// until that tooltip lands.
//
// Positioning is layer-origin-relative: the caller passes `top/left/width/height`
// already offset against the shadow host's origin (`rect.top - origin.top`, …),
// so these are plain computed layout numbers — the only literals here. Colour is
// strictly token-driven: warning vs suggestion selects a background token and a
// shared 1px bottom border references `var(--xb-highlight-blue)`.

import { useState, type CSSProperties, type ReactElement } from "react";
import type { JudgeAnnotation } from "@x-builder/shared";

export interface BlueHighlightProps {
  /** Layer-origin-relative box of this rect (px numbers). */
  top: number;
  left: number;
  width: number;
  height: number;
  /** Drives the background token (warning vs suggestion). */
  severity: JudgeAnnotation["severity"];
  /** Shown on hover (future) and exposed now as the span's `aria-label`. */
  recommendation: string;
}

/** Resolve the severity-specific background token. */
function backgroundToken(severity: JudgeAnnotation["severity"]): string {
  return severity === "warning"
    ? "var(--xb-highlight-blue-warn)"
    : "var(--xb-highlight-blue-suggest)";
}

/** One blue underlay rect. */
export function BlueHighlight({
  top,
  left,
  width,
  height,
  severity,
  recommendation,
}: BlueHighlightProps): ReactElement {
  const [show, setShow] = useState(false);

  const style: CSSProperties = {
    position: "absolute",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    background: backgroundToken(severity),
    borderBottom: "1px solid var(--xb-highlight-blue)",
    // The one interactive element in an otherwise pass-through layer.
    pointerEvents: "auto",
    cursor: "pointer",
  };

  // Instant hover hint showing WHY it was flagged (severity + the judge's
  // one-line fix). Rendered as an absolute child of the highlight span (the
  // highlight layer is not clipped), so it appears the moment the pointer enters
  // — unlike the native `title`, which the same string keeps for accessibility.
  const tip = `${severity === "warning" ? "Warning" : "Suggestion"}: ${recommendation}`;

  const tipStyle: CSSProperties = {
    position: "absolute",
    bottom: "calc(100% + 4px)",
    left: 0,
    zIndex: "var(--xb-z-popover)",
    width: "max-content",
    maxWidth: "280px",
    padding: "var(--space-2)",
    background: "var(--xb-surface-overlay)",
    border: "var(--border-width-thin) solid var(--xb-border-edge)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--xb-glow-sm)",
    color: "var(--xb-text)",
    font: "var(--type-body-small)",
    whiteSpace: "normal",
    pointerEvents: "none",
  };

  return (
    <span
      role="mark"
      aria-label={recommendation}
      style={style}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {show ? (
        <span role="tooltip" style={tipStyle}>
          {tip}
        </span>
      ) : null}
    </span>
  );
}
