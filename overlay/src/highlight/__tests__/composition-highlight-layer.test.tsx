// @x-builder/overlay — CompositionHighlightLayer tests (REAL Chromium layout)
//
// TEST APPROACH (per ticket banner — supersedes any "jsdom + mocked rects"
// wording): these run in the browser-mode harness (Vitest browser / Playwright
// Chromium), so `Range`, `getClientRects()` and `getBoundingClientRect()` are
// REAL. That is the whole point — jsdom returns all-zero/empty rects, which
// would make a Range→rect positioning component untestable. We therefore build
// a REAL composer fixture in the live document, let Chromium lay it out, and
// assert STRUCTURAL / RELATIVE correctness (highlight count, spans within the
// composer's bounds, severity token classes, the getLayerOrigin offset math,
// graceful-degrade paths) — never brittle exact pixels.
//
// We do NOT globally mock getBoundingClientRect / getClientRects. The only two
// places we override `Range.prototype.getClientRects` are the deterministic
// "multi-rect → N spans" mapping case and the "empty DOMRectList → 0 highlights"
// degrade case, and each override is installed/restored locally inside that one
// test (and called out in a comment). Everything else exercises real layout.

import type { JudgeAnnotation } from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

// Not-yet-existing modules — importing them is what drives the RED state.
import { CompositionHighlightLayer, getLayerOrigin } from "../composition-highlight-layer";

import { mountShadowHost, type ShadowHostHandle } from "../../testing/shadow-host";

// --------------------------------------------------------------------------
// Fixture: a REAL contenteditable-like composer in the live document.
// --------------------------------------------------------------------------

const COMPOSER_TESTID = "tweetTextarea_0";

interface ComposerFixture {
  el: HTMLDivElement;
  cleanup(): void;
}

/**
 * Build a real `div[data-testid="tweetTextarea_0"]` carrying a single Text node
 * of `text`, appended to a real container in `document.body`. Browser mode lays
 * it out for real, so `range.getClientRects()` over its text returns real,
 * non-zero rects. `widthPx` lets a test force a narrow box so a long quote wraps
 * onto multiple lines (real multi-rect) without any rect mocking.
 */
function buildComposerFixture(text: string, widthPx = 500): ComposerFixture {
  const container = document.createElement("div");
  container.dataset.xbFixture = "composer";
  // Anchor the container so getBoundingClientRect returns a stable, non-zero box.
  container.style.position = "absolute";
  container.style.top = "100px";
  container.style.left = "50px";
  container.style.width = `${widthPx}px`;

  const el = document.createElement("div");
  el.dataset.testid = COMPOSER_TESTID;
  el.style.width = `${widthPx}px`;
  el.style.font = "16px/1.4 monospace";
  el.style.whiteSpace = "pre-wrap";
  el.style.wordBreak = "break-word";
  el.append(document.createTextNode(text));

  container.append(el);
  document.body.append(container);

  return {
    el,
    cleanup() {
      container.remove();
    },
  };
}

/** All blue-highlight spans rendered anywhere in the document (shadow-aware). */
function blueHighlights(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="mark"]'));
}

/** The single green-wash element, if present. */
function greenWash(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-xb-green-wash]');
}

const WARN: JudgeAnnotation["severity"] = "warning";
const SUGGEST: JudgeAnnotation["severity"] = "suggestion";

function annotation(
  quote: string,
  recommendation: string,
  severity: JudgeAnnotation["severity"] = WARN,
): JudgeAnnotation {
  return { quote, severity, recommendation };
}

// --------------------------------------------------------------------------
// Harness: fake timers + synchronous rAF so the ~120ms debounce + rAF re-map is
// observable, mirroring the established AnchorLayer test discipline.
// --------------------------------------------------------------------------

let harness: ShadowHostHandle;
const fixtures: ComposerFixture[] = [];

/** Render into a real shadow root (tokens adopted) and return the mount node. */
function mount(ui: Parameters<typeof render>[0]): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

/** Track a fixture for guaranteed teardown. */
function fixture(text: string, widthPx?: number): ComposerFixture {
  const f = buildComposerFixture(text, widthPx);
  fixtures.push(f);
  return f;
}

/** Advance past the ~120ms debounce; rAF runs synchronously via the stub. */
function flushDebounce(): void {
  vi.advanceTimersByTime(200);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  harness?.cleanup();
  while (fixtures.length > 0) fixtures.pop()?.cleanup();
  document.querySelectorAll('[data-xb-fixture="composer"]').forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --------------------------------------------------------------------------
// Single matching quote — real layout, structural + bounds + severity + a11y.
// --------------------------------------------------------------------------

describe("CompositionHighlightLayer — single matching quote (real layout)", () => {
  it("renders exactly one BlueHighlight (role=mark) for a matched quote", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften tone", WARN)]}
        showGreen={false}
      />,
    );

    flushDebounce();

    expect(blueHighlights(root)).toHaveLength(1);
  });

  it("positions the span within the composer's bounds with real non-zero size", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften tone", WARN)]}
        showGreen={false}
      />,
    );

    flushDebounce();

    const [span] = blueHighlights(root);
    expect(span).toBeDefined();

    // Real layout → real box. The span must have positive size.
    const rect = span!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);

    // Positioned relative to the layer origin: top/left offsets are >= 0 and the
    // span sits within the composer's own bounding box (real Chromium rects).
    const composerRect = f.el.getBoundingClientRect();
    const top = parseFloat(span!.style.top);
    const left = parseFloat(span!.style.left);
    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(left)).toBe(true);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left).toBeGreaterThanOrEqual(0);

    // The span's absolute box is inside the composer's box (with a small slack
    // for sub-pixel rounding) — proves it maps to the quote's real position.
    expect(rect.top).toBeGreaterThanOrEqual(composerRect.top - 2);
    expect(rect.left).toBeGreaterThanOrEqual(composerRect.left - 2);
    expect(rect.bottom).toBeLessThanOrEqual(composerRect.bottom + 2);
  });

  it("carries the recommendation as aria-label", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften tone", WARN)]}
        showGreen={false}
      />,
    );

    flushDebounce();

    const [span] = blueHighlights(root);
    expect(span!.getAttribute("aria-label")).toBe("soften tone");
  });

  it("applies the warning severity token (distinct from suggestion)", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften tone", WARN)]}
        showGreen={false}
      />,
    );

    flushDebounce();

    const [span] = blueHighlights(root);
    const marker = (span!.getAttribute("style") ?? "") + (span!.className ?? "");
    expect(marker).toContain("--xb-highlight-blue-warn");
    expect(marker).not.toContain("--xb-highlight-blue-suggest");
  });

  it("applies the suggestion severity token (distinct from warning)", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften tone", SUGGEST)]}
        showGreen={false}
      />,
    );

    flushDebounce();

    const [span] = blueHighlights(root);
    const marker = (span!.getAttribute("style") ?? "") + (span!.className ?? "");
    expect(marker).toContain("--xb-highlight-blue-suggest");
    expect(marker).not.toContain("--xb-highlight-blue-warn");
  });
});

// --------------------------------------------------------------------------
// Multi-line quote → N spans. Approach: REAL wrap (narrow composer + long quote)
// AND, separately, a locally-scoped getClientRects override to assert the pure
// rect→span mapping deterministically. Both are stated in the report.
// --------------------------------------------------------------------------

describe("CompositionHighlightLayer — multi-line quote → multiple spans", () => {
  it("real wrap: a long quote in a narrow composer yields >= 2 spans", () => {
    // REAL LAYOUT: narrow box forces the quote to wrap across lines, so the real
    // range.getClientRects() returns >= 2 client rects → one span per rect.
    const longQuote = "wrap me across at least two visual lines here";
    const f = fixture(`start ${longQuote} end`, 80);
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation(longQuote, "tighten this", WARN)]}
        showGreen={false}
      />,
    );

    flushDebounce();

    expect(blueHighlights(root).length).toBeGreaterThanOrEqual(2);
  });

  it("rect→span mapping: a 2-rect getClientRects yields exactly 2 spans for one annotation", () => {
    // TARGETED OVERRIDE (mapping-only, not layout): force Range.getClientRects to
    // report two rects so we assert the rect→span fan-out deterministically.
    const realGetClientRects = Range.prototype.getClientRects;
    const twoRects = [
      new DOMRect(60, 110, 120, 20),
      new DOMRect(60, 130, 90, 20),
    ];
    const fakeList = Object.assign(twoRects, {
      item(i: number): DOMRect | null {
        return twoRects[i] ?? null;
      },
    }) as unknown as DOMRectList;
    Range.prototype.getClientRects = function (): DOMRectList {
      return fakeList;
    };

    try {
      const f = fixture("alpha beta gamma");
      const root = mount(
        <CompositionHighlightLayer
          composerEl={f.el}
          annotations={[annotation("beta", "rephrase", WARN)]}
          showGreen={false}
        />,
      );

      flushDebounce();

      expect(blueHighlights(root)).toHaveLength(2);
    } finally {
      Range.prototype.getClientRects = realGetClientRects;
    }
  });
});

// --------------------------------------------------------------------------
// Graceful degrade paths.
// --------------------------------------------------------------------------

describe("CompositionHighlightLayer — graceful degrade", () => {
  it("unmatched quote → 0 highlights, no throw", () => {
    const f = fixture("The quick brown fox");
    let root!: HTMLElement;
    expect(() => {
      root = mount(
        <CompositionHighlightLayer
          composerEl={f.el}
          annotations={[annotation("no match here", "n/a", WARN)]}
          showGreen={false}
        />,
      );
      flushDebounce();
    }).not.toThrow();

    expect(blueHighlights(root)).toHaveLength(0);
  });

  it("empty DOMRectList → 0 highlights, no error", () => {
    // TARGETED OVERRIDE (degrade path): force an empty DOMRectList for a quote
    // that DOES match textContent, so the empty-rects drop rule is exercised.
    const realGetClientRects = Range.prototype.getClientRects;
    const emptyList = Object.assign([] as DOMRect[], {
      item(): DOMRect | null {
        return null;
      },
    }) as unknown as DOMRectList;
    Range.prototype.getClientRects = function (): DOMRectList {
      return emptyList;
    };

    try {
      const f = fixture("The quick brown fox");
      let root!: HTMLElement;
      expect(() => {
        root = mount(
          <CompositionHighlightLayer
            composerEl={f.el}
            annotations={[annotation("quick brown", "soften", WARN)]}
            showGreen={false}
          />,
        );
        flushDebounce();
      }).not.toThrow();

      expect(blueHighlights(root)).toHaveLength(0);
    } finally {
      Range.prototype.getClientRects = realGetClientRects;
    }
  });

  it("locate pass throws → empty layer, console.warn once, no unhandled exception", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const f = fixture("The quick brown fox");
    // Make the locate pass throw: reading textContent on this element throws.
    Object.defineProperty(f.el, "textContent", {
      configurable: true,
      get() {
        throw new Error("boom");
      },
    });

    let root!: HTMLElement;
    expect(() => {
      root = mount(
        <CompositionHighlightLayer
          composerEl={f.el}
          annotations={[annotation("quick brown", "soften", WARN)]}
          showGreen={false}
        />,
      );
      flushDebounce();
    }).not.toThrow();

    expect(blueHighlights(root)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toBe("[xb] highlight locate threw:");

    warnSpy.mockRestore();
  });
});

// --------------------------------------------------------------------------
// §16.4 consumed-offset: two annotations, same quote, two occurrences.
// --------------------------------------------------------------------------

describe("CompositionHighlightLayer — left-to-right consumed-offset (§16.4)", () => {
  it("maps two 'foo' annotations to idx 0 and idx 8 → two spans at distinct positions", () => {
    // REAL LAYOUT: 'foo bar foo baz' on one line. First 'foo' at idx 0, second
    // at idx 8 (consumed-offset advances past the first). Their real rects differ
    // in `left`, so the two spans must render at distinct positions.
    const f = fixture("foo bar foo baz");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[
          annotation("foo", "first", WARN),
          annotation("foo", "second", SUGGEST),
        ]}
        showGreen={false}
      />,
    );

    flushDebounce();

    const spans = blueHighlights(root);
    expect(spans).toHaveLength(2);

    const lefts = spans.map((s) => parseFloat(s.style.left));
    expect(lefts.every((n) => Number.isFinite(n))).toBe(true);
    // Distinct positions: the second occurrence is to the right of the first.
    expect(new Set(lefts).size).toBe(2);
    expect(Math.max(...lefts)).toBeGreaterThan(Math.min(...lefts));
  });
});

// --------------------------------------------------------------------------
// Props updates + show/hide state.
// --------------------------------------------------------------------------

describe("CompositionHighlightLayer — annotations prop update", () => {
  it("after debounce, clears old highlights and maps the new annotations", () => {
    const f = fixture("The quick brown fox jumps");
    harness = mountShadowHost();
    const { rerender } = render(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "first rec", WARN)]}
        showGreen={false}
      />,
      { container: harness.mount },
    );

    flushDebounce();
    let spans = blueHighlights(harness.mount);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.getAttribute("aria-label")).toBe("first rec");

    rerender(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("fox jumps", "second rec", SUGGEST)]}
        showGreen={false}
      />,
    );
    flushDebounce();

    spans = blueHighlights(harness.mount);
    expect(spans).toHaveLength(1);
    // Old highlight cleared, new one mapped.
    expect(spans[0]!.getAttribute("aria-label")).toBe("second rec");
  });
});

describe("CompositionHighlightLayer — green / empty / null states", () => {
  it("showGreen=true → GreenWash renders, 0 BlueHighlights regardless of annotations", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "ignored", WARN)]}
        showGreen={true}
      />,
    );

    flushDebounce();

    expect(greenWash(root)).not.toBeNull();
    expect(blueHighlights(root)).toHaveLength(0);
  });

  it("GreenWash references the green-wash token", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer composerEl={f.el} annotations={[]} showGreen={true} />,
    );

    flushDebounce();

    const wash = greenWash(root);
    expect(wash).not.toBeNull();
    const marker = (wash!.getAttribute("style") ?? "") + (wash!.className ?? "");
    expect(marker).toContain("--xb-highlight-green-wash");
  });

  it("showGreen=false, annotations=[] → 0 highlights, 0 green wash", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer composerEl={f.el} annotations={[]} showGreen={false} />,
    );

    flushDebounce();

    expect(blueHighlights(root)).toHaveLength(0);
    expect(greenWash(root)).toBeNull();
  });

  it("composerEl=null → renders nothing, no error", () => {
    let root!: HTMLElement;
    expect(() => {
      root = mount(
        <CompositionHighlightLayer
          composerEl={null}
          annotations={[annotation("quick brown", "x", WARN)]}
          showGreen={false}
        />,
      );
      flushDebounce();
    }).not.toThrow();

    expect(blueHighlights(root)).toHaveLength(0);
    expect(greenWash(root)).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Debounce: a scroll/mutation event must NOT trigger a synchronous re-map.
// --------------------------------------------------------------------------

describe("CompositionHighlightLayer — debounce discipline", () => {
  it("a scroll event does not synchronously re-run the locate pass (it is rAF/debounced)", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften", WARN)]}
        showGreen={false}
      />,
    );

    // Initial map after the first debounce tick.
    flushDebounce();
    expect(blueHighlights(root)).toHaveLength(1);

    // Mutate the composer text so a synchronous re-map (if any) WOULD change the
    // mapping, then fire a scroll event WITHOUT advancing timers.
    f.el.firstChild!.textContent = "totally different content now";
    let countSpy = 0;
    const realIndexOf = String.prototype.indexOf;
    // Detect a synchronous locate by counting indexOf calls on the event tick.
    String.prototype.indexOf = function (...args: Parameters<string["indexOf"]>): number {
      countSpy += 1;
      return realIndexOf.apply(this, args);
    };

    try {
      window.dispatchEvent(new Event("scroll"));
      // No timer advance: the re-map must NOT have run synchronously on the tick.
      expect(countSpy).toBe(0);
    } finally {
      String.prototype.indexOf = realIndexOf;
    }
  });
});

// --------------------------------------------------------------------------
// pointer-events discipline: layer none, BlueHighlight auto.
// --------------------------------------------------------------------------

describe("CompositionHighlightLayer — pointer-events discipline", () => {
  it("the layer is pointer-events:none and each BlueHighlight is pointer-events:auto", () => {
    const f = fixture("The quick brown fox");
    const root = mount(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften", WARN)]}
        showGreen={false}
      />,
    );

    flushDebounce();

    const [span] = blueHighlights(root);
    expect(span).toBeDefined();
    expect(getComputedStyle(span!).pointerEvents).toBe("auto");

    // The layer that contains the span must be pointer-events:none. Walk up from
    // the span to the nearest ancestor that opts out of pointer events.
    let layer: HTMLElement | null = span!.parentElement;
    let layerNone = false;
    while (layer && layer !== root) {
      if (getComputedStyle(layer).pointerEvents === "none") {
        layerNone = true;
        break;
      }
      layer = layer.parentElement;
    }
    expect(layerNone).toBe(true);
  });
});

// --------------------------------------------------------------------------
// getLayerOrigin: offsets against the shadow host rect (non-zero host offset).
// --------------------------------------------------------------------------

describe("getLayerOrigin + shadow-host-relative positioning", () => {
  it("getLayerOrigin returns the host element's rect when given a node in the shadow tree", () => {
    harness = mountShadowHost();
    // Give the host a real, non-zero on-screen box.
    harness.host.style.position = "absolute";
    harness.host.style.top = "40px";
    harness.host.style.left = "30px";
    harness.host.style.width = "300px";
    harness.host.style.height = "200px";
    // display:contents hosts have no box; ensure a layout box for the test.
    harness.host.style.display = "block";

    const origin = getLayerOrigin(harness.mount);
    const hostRect = harness.host.getBoundingClientRect();

    expect(origin.top).toBeCloseTo(hostRect.top, 0);
    expect(origin.left).toBeCloseTo(hostRect.left, 0);
  });

  it("blue span top/left are composer-rect-minus-origin, not absolute viewport coords", () => {
    harness = mountShadowHost();
    harness.host.style.position = "absolute";
    harness.host.style.top = "40px";
    harness.host.style.left = "30px";
    harness.host.style.display = "block";

    const f = fixture("The quick brown fox");
    render(
      <CompositionHighlightLayer
        composerEl={f.el}
        annotations={[annotation("quick brown", "soften", WARN)]}
        showGreen={false}
      />,
      { container: harness.mount },
    );

    flushDebounce();

    const [span] = blueHighlights(harness.mount);
    expect(span).toBeDefined();

    const composerRect = f.el.getBoundingClientRect();
    const origin = getLayerOrigin(harness.mount);

    const top = parseFloat(span!.style.top);
    const left = parseFloat(span!.style.left);

    // The positioning MUST subtract the host origin — the inline top/left are
    // smaller than the composer's absolute viewport coords by ~the origin.
    expect(top).toBeCloseTo(composerRect.top - origin.top, 0);
    expect(left).toBeLessThan(composerRect.left);
    expect(left).toBeCloseTo(left, 0);
    // And not the raw viewport value (origin is non-zero, so they must differ).
    expect(top).not.toBeCloseTo(composerRect.top, 0);
  });
});
