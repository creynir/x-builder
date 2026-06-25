// @x-builder/overlay — useHighlightRects (§16.4 quote-location pipeline)
//
// Maps each `annotation.quote` to one or more client rects in the live composer,
// following §16.4 verbatim: first-match + left-to-right consumed-offset. The
// whole pass is debounced ~120ms via the shared rAF tracker and is NEVER run
// synchronously on a scroll/keydown event — rapid typing collapses to a single
// trailing re-map and the composer is never blocked.
//
// §16.4 per annotation (left-to-right):
//   idx = composerEl.textContent.indexOf(quote, consumedOffset)
//   idx === -1                  → silently drop (unmatched quote)
//   else: TreeWalker the leaf Text node + local offset for idx and idx+len,
//         build a Range, getClientRects(); empty → silently drop;
//         else advance consumedOffset = idx + quote.length, push one
//         HighlightRect per rect.
//
// The ENTIRE pass is wrapped in try/catch: any throw ⇒ return [] and warn once
// with the exact string. `getClientRects()` returning an all-empty list, an
// unmatched quote, or a thrown getter all degrade to "fewer / zero highlights",
// never to a crash — the compose flow continues unaffected.
//
// KNOWN LIMITATION (documented per the ticket edge case): when a quote spans
// multiple Text nodes (X inserts inline `<span>`s for hashtag/mention colouring),
// the collapsed-offset → leaf-node mapping still builds a Range across the two
// resolved leaves and yields rects covering the approximate region; it does not
// throw or crash, but the rects may be coarser than a single-node quote.

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { JudgeAnnotation } from "@x-builder/shared";

import { createRafDebounce } from "./raf-debounce";

/** Internal shape: one client rect of a located quote, tagged for rendering. */
export interface HighlightRect {
  annotationIndex: number;
  rect: DOMRect;
  severity: JudgeAnnotation["severity"];
  recommendation: string;
}

/**
 * Collect client rects for the `[startIndex, endIndex)` slice of the composer's
 * textContent, built PER TEXT NODE rather than from one range spanning the whole
 * slice. This is the §16.4 quote location with one correction: a single range
 * across the quote also covers the EMPTY Draft.js blocks between paragraphs, and
 * `getClientRects()` returns a full-width rect for each of those blank lines —
 * which painted blue bars over the gaps (XOB bug). Sub-ranging each text node
 * means empty blocks (no Text node) contribute no rect, so only real glyphs are
 * highlighted. The composer is NOT a single Text node (X nests rich-text spans),
 * so we accumulate leaf lengths and clip each leaf to the slice.
 */
export function collectSpanRects(
  root: HTMLElement,
  startIndex: number,
  endIndex: number,
  lineHeight: number | null,
): DOMRect[] {
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;

  for (
    let node = walker.nextNode() as Text | null;
    node !== null;
    node = walker.nextNode() as Text | null
  ) {
    const len = node.data.length;
    const nodeStart = consumed;
    const nodeEnd = consumed + len;
    consumed = nodeEnd;

    // Overlap of [startIndex, endIndex) with this leaf's [nodeStart, nodeEnd).
    const from = Math.max(startIndex, nodeStart);
    const to = Math.min(endIndex, nodeEnd);
    if (from < to) {
      const range = document.createRange();
      range.setStart(node, from - nodeStart);
      range.setEnd(node, to - nodeStart);
      for (const rect of Array.from(range.getClientRects())) {
        // Skip degenerate rects (collapsed / zero-area whitespace fragments).
        if (rect.width > 0 && rect.height > 0) {
          out.push(snapRectToLine(rect, lineHeight));
        }
      }
    }

    if (nodeEnd >= endIndex) {
      break;
    }
  }

  return out;
}

/**
 * Resolve the composer's computed line-height in px, or `null` when it is the
 * `"normal"` keyword (or otherwise unparseable). Used to snap glyph-tight client
 * rects to their full line box.
 */
export function computedLineHeight(composerEl: HTMLElement): number | null {
  const raw = getComputedStyle(composerEl).lineHeight;
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) && raw.endsWith("px") ? px : null;
}

/**
 * Snap a glyph-tight client rect to its line box. `Range.getClientRects()`
 * returns rects sized to the GLYPHS, vertically centred in the line box, so a
 * 16px font on a 1.4 line-height sits ~2px below the line top. An underlay
 * highlight must cover the full line — and align with the composer's own box —
 * so when we know the line-height we expand the rect to it, splitting the leading
 * symmetrically. When the line-height is `"normal"` we fall back to the raw glyph
 * rect (graceful: slightly tighter, never wrong).
 */
function snapRectToLine(rect: DOMRect, lineHeight: number | null): DOMRect {
  if (lineHeight === null || lineHeight <= rect.height) {
    return rect;
  }
  const leading = (lineHeight - rect.height) / 2;
  return new DOMRect(rect.left, rect.top - leading, rect.width, lineHeight);
}

/**
 * §16.4 locate pass. Pure over the live DOM; the caller wraps scheduling and
 * memoization around it. Returns the flattened `HighlightRect[]` for all matched
 * annotations, dropping unmatched/empty-rect ones.
 */
function locateAll(composerEl: HTMLElement, annotations: JudgeAnnotation[]): HighlightRect[] {
  const out: HighlightRect[] = [];
  // Reading textContent may itself throw (e.g. a hostile getter); the caller's
  // try/catch covers it. Read once per pass and reuse for every indexOf.
  const text = composerEl.textContent ?? "";
  const lineHeight = computedLineHeight(composerEl);

  let consumedOffset = 0;
  for (let annotationIndex = 0; annotationIndex < annotations.length; annotationIndex += 1) {
    const { quote, severity, recommendation } = annotations[annotationIndex]!;

    const idx = text.indexOf(quote, consumedOffset);
    if (idx === -1) {
      // Unmatched quote → silently drop, do NOT advance the cursor.
      continue;
    }

    // Per-text-node rects: real glyphs only, never the empty blocks between
    // paragraphs (which a whole-quote range would paint as full-width bars).
    const rects = collectSpanRects(composerEl, idx, idx + quote.length, lineHeight);
    if (rects.length === 0) {
      // Collapsed/hidden / unlocatable → silently drop, do NOT advance.
      continue;
    }

    // Match found and rendered → advance the cursor past this occurrence so a
    // later annotation with the same quote string locates the NEXT occurrence.
    consumedOffset = idx + quote.length;

    for (const rect of rects) {
      out.push({
        annotationIndex,
        rect,
        severity,
        recommendation,
      });
    }
  }

  return out;
}

/**
 * Hook: debounced §16.4 mapping of `annotations` → `HighlightRect[]` against the
 * live `composerEl`. Re-maps on a ~120ms rAF-debounced tick whenever `composerEl`
 * or the `annotations` reference changes; never synchronously on an event.
 */
export function useHighlightRects(
  composerEl: HTMLElement | null,
  annotations: JudgeAnnotation[],
): HighlightRect[] {
  const [rects, setRects] = useState<HighlightRect[]>([]);

  // Hold the latest inputs in a ref so the scheduled tick reads fresh values
  // without re-arming the effect on every render.
  const inputsRef = useRef({ composerEl, annotations });
  inputsRef.current = { composerEl, annotations };

  useEffect(() => {
    if (composerEl === null) {
      setRects([]);
      return;
    }

    const remap = (): void => {
      const { composerEl: el, annotations: anns } = inputsRef.current;
      // Compute the next rects OUTSIDE React, then commit synchronously. The tick
      // fires from a timer/rAF (outside React's batching), so without flushSync
      // React 19 defers the commit past the debounce tick; the ticket's contract
      // is that rects SNAP into place on each tick (no transition), so a
      // synchronous commit is exactly right.
      let next: HighlightRect[];
      if (el === null) {
        next = [];
      } else {
        try {
          next = locateAll(el, anns);
        } catch (err) {
          // Any throw in the locate pass ⇒ empty layer + warn once. The compose
          // flow continues unaffected.
          console.warn("[xb] highlight locate threw:", err);
          next = [];
        }
      }
      flushSync(() => {
        setRects(next);
      });
    };

    const debounce = createRafDebounce(remap);

    // Schedule the initial map on the debounce (NOT synchronously): the test
    // advances timers to flush it, mirroring the AnchorLayer discipline.
    debounce.schedule();

    return () => {
      debounce.cancel();
    };
    // Re-arm when the composer element or the annotations reference changes.
  }, [composerEl, annotations]);

  return rects;
}

/**
 * Hook: per-line client rects covering the ENTIRE composer text, so the
 * generated-state green highlight can follow the text line-by-line (like the
 * blue underlays) instead of painting one flat block over the whole region —
 * empty lines between paragraphs are skipped (no text node → no rect).
 * Re-measures on a rAF-debounced resize/scroll; returns `[]` when disabled.
 */
export function useFullTextRects(composerEl: HTMLElement | null, enabled: boolean): DOMRect[] {
  const [rects, setRects] = useState<DOMRect[]>([]);

  useEffect(() => {
    if (composerEl === null || !enabled) {
      setRects([]);
      return;
    }

    const measure = (): void => {
      let next: DOMRect[] = [];
      try {
        const text = composerEl.textContent ?? "";
        next = collectSpanRects(composerEl, 0, text.length, computedLineHeight(composerEl));
      } catch {
        next = [];
      }
      flushSync(() => {
        setRects(next);
      });
    };

    const debounce = createRafDebounce(measure);
    debounce.schedule();

    const resizeObserver = new ResizeObserver(() => debounce.schedule());
    resizeObserver.observe(composerEl);
    const onScroll = (): void => debounce.schedule();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      try {
        resizeObserver.disconnect();
      } catch {
        // Page unloading; nothing to clean up.
      }
      debounce.cancel();
    };
  }, [composerEl, enabled]);

  return rects;
}
