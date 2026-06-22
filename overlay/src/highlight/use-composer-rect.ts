// @x-builder/overlay — useComposerRect (tracks the composer's bounding box)
//
// Reads `composerEl.getBoundingClientRect()` and keeps it fresh as the composer
// resizes (`ResizeObserver`) or the page scrolls (passive `scroll` listener on
// `window`, capture phase so an ancestor scroll container is caught too). Both
// re-reads are funneled through the shared ~120ms rAF debounce — never run
// synchronously on the event tick — so a rapid scroll/resize burst collapses to
// one trailing measure and the composer is never blocked.
//
// Graceful degrade: an all-zero rect (composer not yet laid out or off-screen)
// is treated as "no rect" (returns null) so the layer renders nothing and
// retries on the next tick, exactly as the ticket's edge case requires.

import { useEffect, useState } from "react";

import { createRafDebounce } from "./raf-debounce";

/** True when a rect carries no usable geometry (all-zero ⇒ not laid out). */
function isAllZeroRect(rect: DOMRect): boolean {
  return (
    rect.top === 0 &&
    rect.left === 0 &&
    rect.width === 0 &&
    rect.height === 0
  );
}

/**
 * Track the composer's viewport rect. Returns `null` until the element is laid
 * out (or when it is `null` / collapsed to an all-zero box).
 */
export function useComposerRect(composerEl: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (composerEl === null) {
      setRect(null);
      return;
    }

    const measure = (): void => {
      const next = composerEl.getBoundingClientRect();
      // All-zero ⇒ treat as "no rect": render nothing, retry next tick.
      setRect(isAllZeroRect(next) ? null : next);
    };

    const debounce = createRafDebounce(measure);

    // Measure once immediately so the first paint has geometry without waiting a
    // full debounce window; subsequent reads ride the debounce.
    measure();

    const resizeObserver = new ResizeObserver(() => {
      debounce.schedule();
    });
    resizeObserver.observe(composerEl);

    const onScroll = (): void => {
      debounce.schedule();
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      try {
        resizeObserver.disconnect();
      } catch {
        // Page is unloading; nothing to clean up.
      }
      debounce.cancel();
    };
  }, [composerEl]);

  return rect;
}
