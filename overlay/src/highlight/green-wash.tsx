// @x-builder/overlay — GreenWash (generated-state composer overlay)
//
// A single element covering the composer's text region. Rendered ONLY in the
// "generated" provenance state (parent passes `showGreen`); it carries no
// per-quote mapping — it is a flat translucent wash that signals "this text was
// machine-generated". Styling is token-only (`var(--xb-highlight-green-wash)`),
// so it resolves against the adopted neon sheet inside the shadow root and
// blends correctly on X's white and dim themes (the token is RGBA with alpha).

import type { CSSProperties, ReactElement } from "react";

export interface GreenWashProps {
  /** Layer-origin-relative box of the composer text region (px numbers). */
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The generated-state wash. One element, no border/glow, `pointer-events:none`
 * so it never intercepts typing — it lives inside the already-`none` layer but
 * is explicit here for defence in depth.
 */
export function GreenWash({ top, left, width, height }: GreenWashProps): ReactElement {
  const style: CSSProperties = {
    position: "absolute",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
    background: "var(--xb-highlight-green-wash)",
    pointerEvents: "none",
  };

  return <div data-xb-green-wash="" style={style} />;
}
