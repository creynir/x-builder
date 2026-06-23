// @x-builder/overlay — module-surface contract for the highlight layer (RED)
//
// Pins the exact module + export shape Green must build, so each not-yet-existing
// module drives a RED import failure independently of the behavioral suite. These
// are intentionally thin: they assert the named exports exist and have the right
// callable/component kind, not their runtime behavior (that lives in
// composition-highlight-layer.test.tsx, against REAL Chromium layout).

import { describe, expect, it } from "vitest";

// Each import targets one of the modules listed in the ticket's Scope Boundaries.
import { CompositionHighlightLayer, getLayerOrigin } from "../composition-highlight-layer";
import { GreenWash } from "../green-wash";
import { BlueHighlight } from "../blue-highlight";
import { useComposerRect } from "../use-composer-rect";
import { useHighlightRects } from "../use-highlight-rects";

describe("highlight module surface", () => {
  it("exports CompositionHighlightLayer as a component (function)", () => {
    expect(typeof CompositionHighlightLayer).toBe("function");
  });

  it("exports getLayerOrigin as a callable util", () => {
    expect(typeof getLayerOrigin).toBe("function");
  });

  it("exports GreenWash and BlueHighlight as components (functions)", () => {
    expect(typeof GreenWash).toBe("function");
    expect(typeof BlueHighlight).toBe("function");
  });

  it("exports useComposerRect and useHighlightRects as hooks (functions)", () => {
    expect(typeof useComposerRect).toBe("function");
    expect(typeof useHighlightRects).toBe("function");
  });
});
