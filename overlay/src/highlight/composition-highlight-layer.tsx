// @x-builder/overlay — CompositionHighlightLayer (XOB-022)
//
// An absolutely-positioned, `pointer-events:none` layer rendered OVER X's
// contenteditable composer. It owns the §16.4 quote→Range→`getClientRects()`
// pipeline (in `useHighlightRects`) and paints, mutually exclusively:
//   • showGreen === true            → a single GreenWash (generated state); the
//                                      annotations are ignored, zero blue spans.
//   • showGreen === false && N > 0  → one BlueHighlight per located quote rect.
//   • otherwise / composerEl null   → nothing visible.
//
// ZERO-TRACE: the layer never mutates X's composer DOM — no content insertion,
// no contenteditable writes — and it is `pointer-events:none` except on the
// individual BlueHighlight hover targets. It carries no provenance/transport/
// judge logic; `showGreen` and `annotations` arrive as props from a future
// parent (XOB-023+), here from test fixtures.
//
// Positioning origin: `getLayerOrigin()` returns the shadow host element's
// viewport rect. The layer is anchored so that:
//   • vertically   — the layer top sits at the host origin, and each painted box
//                     uses `rect.top - origin.top`, the host-relative viewport
//                     position of the (line-snapped) quote rect. This keeps
//                     multi-line highlights aligned to their real line boxes.
//   • horizontally — the layer's LEFT edge is anchored to the composer's left
//                     (`composerRect.left - origin.left`), and each box uses
//                     `rect.left - composerRect.left`, its offset WITHIN the
//                     composer. Anchoring horizontally to the composer (rather
//                     than re-deriving every left from the host on each tick)
//                     keeps the painted left independent of host sub-pixel drift.
// In both axes the rendered (viewport) box lands exactly on the quote, since the
// layer's compensating offset cancels the origin: composerEl sits inside the
// host, so `host.left + (composerRect.left - origin.left) + (rect.left -
// composerRect.left) === rect.left`.

import { useRef, type CSSProperties, type ReactElement } from "react";
import type { JudgeAnnotation } from "@x-builder/shared";

import { BlueHighlight } from "./blue-highlight";
import { GreenWash } from "./green-wash";
import { useComposerRect } from "./use-composer-rect";
import { useHighlightRects } from "./use-highlight-rects";

export interface CompositionHighlightLayerProps {
  /** The contenteditable composer element; `null` ⇒ the layer renders nothing. */
  composerEl: HTMLElement | null;
  /** Judge annotations to locate and underline (ignored when `showGreen`). */
  annotations: JudgeAnnotation[];
  /** `true` ⇒ generated state: GreenWash only, no blue highlights. */
  showGreen: boolean;
}

/** A stable empty-annotations singleton — passed in the green state so the
 *  locate effect's dependency is reference-stable across re-renders. */
const EMPTY_ANNOTATIONS: JudgeAnnotation[] = [];

/** Origin offset (viewport coords) the layer's children position against. */
export interface LayerOrigin {
  top: number;
  left: number;
}

/**
 * Resolve the layer origin: the shadow host element's viewport rect. The layer
 * is rendered inside an open shadow root, so a node within it resolves its root
 * to that `ShadowRoot`, whose `.host` is the on-page element the absolute
 * children are positioned against. Outside a shadow tree (or before mount) the
 * origin is the viewport corner `{0,0}`, i.e. no host offset.
 */
export function getLayerOrigin(node: Node | null): LayerOrigin {
  if (node === null) {
    return { top: 0, left: 0 };
  }
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) {
    const rect = root.host.getBoundingClientRect();
    return { top: rect.top, left: rect.left };
  }
  return { top: 0, left: 0 };
}

/**
 * Base layer style. The layer is absolutely positioned and never intercepts
 * pointer events (only the BlueHighlight hover targets opt back in), so typing is
 * never blocked. `top`/`left` are filled in per-render: the layer is anchored to
 * the composer's left edge (host-relative) so each highlight's `left` is its
 * offset WITHIN the composer, while its vertical origin stays the host so each
 * highlight's `top` is the host-relative line position. See `CompositionHighlightLayer`.
 */
const LAYER_BASE_STYLE: CSSProperties = {
  position: "absolute",
  // The layer itself never intercepts pointer events; only the BlueHighlight
  // hover targets opt back in. This guarantees typing is never blocked.
  pointerEvents: "none",
  zIndex: "var(--xb-z-pin)",
};

/** The composition highlight overlay. */
export function CompositionHighlightLayer({
  composerEl,
  annotations,
  showGreen,
}: CompositionHighlightLayerProps): ReactElement | null {
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Track the composer's box (debounced; all-zero ⇒ null) and the located rects.
  // In the green state the annotations are ignored entirely — pass the STABLE
  // empty array (a frozen singleton, never a fresh `[]`) so the §16.4 pipeline
  // does no work, emits zero blue spans, AND the `useHighlightRects` locate
  // effect does not re-arm on every re-render (a fresh `[]` each render would
  // re-schedule its debounce → flushSync setRects → re-render → re-arm, an
  // infinite loop under a `runAllTimers`-style drain).
  const composerRect = useComposerRect(composerEl);
  const highlightRects = useHighlightRects(composerEl, showGreen ? EMPTY_ANNOTATIONS : annotations);

  // composerEl === null ⇒ render nothing (no layer, no error).
  if (composerEl === null) {
    return null;
  }

  // Shadow-host-relative origin; read live off the layer node (set after first
  // commit, before any rects/wash exist to paint).
  const origin = getLayerOrigin(layerRef.current);

  // Horizontal anchor: the composer's left edge, host-relative. `null` until the
  // composer is laid out (all-zero ⇒ treated as null upstream) — paint nothing.
  const composerLeft = composerRect?.left ?? null;

  let content: ReactElement | null = null;

  if (showGreen) {
    // Generated state: a single wash over the composer's text region. An all-zero
    // / unlaid-out composer (composerRect === null) paints nothing and retries.
    if (composerRect !== null && composerLeft !== null) {
      content = (
        <GreenWash
          top={composerRect.top - origin.top}
          left={composerRect.left - composerLeft}
          width={composerRect.width}
          height={composerRect.height}
        />
      );
    }
  } else if (annotations.length > 0 && composerLeft !== null) {
    // User-written with annotations: one blue underlay per located rect.
    content = (
      <>
        {highlightRects.map((hr, i) => (
          <BlueHighlight
            // Index-keyed: rects are positional and fully re-derived each tick.
            key={`${hr.annotationIndex}-${i}`}
            top={hr.rect.top - origin.top}
            left={hr.rect.left - composerLeft}
            width={hr.rect.width}
            height={hr.rect.height}
            severity={hr.severity}
            recommendation={hr.recommendation}
          />
        ))}
      </>
    );
  }

  // The layer's left edge is anchored to the composer's left (host-relative); its
  // top stays at the host origin. Children carry the within-composer left and the
  // host-relative top accordingly (see the module header).
  const layerStyle: CSSProperties = {
    ...LAYER_BASE_STYLE,
    top: 0,
    left: composerLeft !== null ? `${composerLeft - origin.left}px` : 0,
  };

  return (
    <div ref={layerRef} data-xb-highlight-layer="" style={layerStyle}>
      {content}
    </div>
  );
}
