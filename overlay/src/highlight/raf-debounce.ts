// @x-builder/overlay — shared rAF + ~120ms debounce tracker for the highlight layer
//
// Both `useComposerRect` and `useHighlightRects` must re-measure/re-map on the
// SAME discipline the AnchorLayer established: never synchronously on a
// scroll/resize/keydown event, but on a cancel-and-reschedule ~120ms debounce
// whose trailing edge runs inside a single rAF. A burst of events collapses to
// one trailing tick, so rapid typing never blocks the composer.
//
// `createRafDebounce(cb)` returns `{ schedule, cancel }`. `schedule()` cancels any
// pending tick and arms a fresh one; `cancel()` tears everything down (call it on
// unmount). rAF degrades to a 0ms timeout when unavailable (jsdom), matching the
// AnchorLayer fallback.

/** ~120ms debounce window, per the ticket's debounce discipline. */
export const HIGHLIGHT_DEBOUNCE_MS = 120;

/** rAF that degrades to a microtask-ish timeout when unavailable (jsdom). */
function scheduleFrame(cb: () => void): number {
  const raf = (
    globalThis as { requestAnimationFrame?: (fn: FrameRequestCallback) => number }
  ).requestAnimationFrame;
  if (typeof raf === "function") {
    return raf(() => cb());
  }
  return setTimeout(cb, 0) as unknown as number;
}

/** Cancel a handle from `scheduleFrame`, matching the rAF/timeout it returned. */
function cancelFrame(handle: number): void {
  const caf = (
    globalThis as { cancelAnimationFrame?: (h: number) => void }
  ).cancelAnimationFrame;
  if (typeof caf === "function") {
    caf(handle);
  }
  clearTimeout(handle);
}

export interface RafDebounce {
  /** Cancel any pending tick and arm a fresh ~120ms-debounced rAF tick. */
  schedule(): void;
  /** Tear down any pending timer/frame. Idempotent; call on unmount. */
  cancel(): void;
}

/**
 * Build a cancel-and-reschedule rAF debounce around `cb`. The trailing edge of
 * the ~120ms window fires `cb` inside one rAF, so layout reads happen on a frame
 * boundary rather than on the raw event tick.
 */
export function createRafDebounce(cb: () => void): RafDebounce {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let frameHandle: number | null = null;

  const cancel = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
  };

  const schedule = (): void => {
    cancel();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      frameHandle = scheduleFrame(() => {
        frameHandle = null;
        cb();
      });
    }, HIGHLIGHT_DEBOUNCE_MS);
  };

  return { schedule, cancel };
}
