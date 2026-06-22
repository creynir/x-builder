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

import type { CSSProperties, ReactElement } from "react";
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
  };

  return <span role="mark" aria-label={recommendation} style={style} />;
}
