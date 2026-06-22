// @x-builder/overlay — overlay React tree root (XOB-018)
//
// Empty tree root mounted into the shadow root's mount node. It renders no
// visible output and takes no props yet; XOB-019+ wire transport, selectors,
// and the visible affordance layers as children here.

import type { JSX } from "react";

export interface OverlayRuntimeProps {}

/**
 * The overlay's React root. At this ticket it is intentionally empty so the
 * shadow host produces zero paint output.
 */
export function OverlayRuntime(_props: OverlayRuntimeProps): JSX.Element | null {
  return null;
}
