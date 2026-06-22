// @x-builder/overlay — single per-frame compose rect snapshot (XOB-029)
//
// THE one place the cockpit reads layout geometry. It captures the shadow-host
// origin AND the modal/composer rect TOGETHER in a single rAF-gated, ~120 ms-
// debounced pass, so the three zone pins and the composition highlight layer
// anchor off ONE consistent snapshot rather than each running its own measure
// loop on a different frame (the carried XOB-022 L2 / XOB-023 C1 skew). A burst
// of scroll/resize/SPA-churn events collapses to one trailing read.
//
// The snapshot is taken relative to the shadow host (the on-page element the
// overlay's absolutely-positioned children are laid against), exactly as
// `getLayerOrigin` resolves it for the highlight layer — so a pin positioned at
// `modal.top - origin.top` lands on the modal, and the single highlight layer
// (anchored to the same composer) shares the same frame's geometry.

import { useEffect, useState } from "react";

import { getLayerOrigin } from "../highlight/composition-highlight-layer";
import { createRafDebounce } from "../highlight/raf-debounce";

/** A host-relative box (viewport rect minus the host origin). */
export interface SnapshotRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** One per-frame snapshot: host origin + the host-relative modal/composer boxes. */
export interface ComposeSnapshot {
  /** The modal (dialog) box, host-relative; `null` until laid out. */
  modal: SnapshotRect | null;
  /** The composer box, host-relative; `null` until laid out. */
  composer: SnapshotRect | null;
}

/** True when a viewport rect carries no usable geometry (all-zero ⇒ unlaid). */
function isAllZero(rect: DOMRect): boolean {
  return rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0;
}

/** Convert a viewport rect to a host-relative box, or `null` when unlaid. */
function toHostRelative(
  rect: DOMRect,
  origin: { top: number; left: number },
): SnapshotRect | null {
  if (isAllZero(rect)) return null;
  return {
    top: rect.top - origin.top,
    left: rect.left - origin.left,
    width: rect.width,
    height: rect.height,
  };
}

/** Two host-relative boxes are equal (or both null) — same geometry. */
function rectEqual(a: SnapshotRect | null, b: SnapshotRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/** Two snapshots carry identical geometry (so a re-render would be a no-op). */
function snapshotEqual(a: ComposeSnapshot, b: ComposeSnapshot): boolean {
  return rectEqual(a.modal, b.modal) && rectEqual(a.composer, b.composer);
}

/**
 * Track the modal + composer geometry as ONE per-frame snapshot, host-relative.
 * `hostNode` is any node inside the overlay shadow tree (the layer root) so the
 * origin resolves to the shadow host; `modalEl` / `composerEl` are the X dialog
 * and its contenteditable. Re-measures on scroll/resize through the shared rAF
 * debounce; returns `{ modal: null, composer: null }` until both are laid out.
 */
export function useComposeSnapshot(
  hostNode: Node | null,
  modalEl: HTMLElement | null,
  composerEl: HTMLElement | null,
): ComposeSnapshot {
  const [snapshot, setSnapshot] = useState<ComposeSnapshot>({ modal: null, composer: null });

  useEffect(() => {
    if (modalEl === null && composerEl === null) {
      setSnapshot({ modal: null, composer: null });
      return;
    }

    const measure = (): void => {
      // ONE snapshot: read the host origin and both rects on the same frame.
      const origin = getLayerOrigin(hostNode);
      const modal = modalEl !== null ? toHostRelative(modalEl.getBoundingClientRect(), origin) : null;
      const composer =
        composerEl !== null ? toHostRelative(composerEl.getBoundingClientRect(), origin) : null;
      const next: ComposeSnapshot = { modal, composer };
      // Bail when geometry is unchanged so a measure→render→measure cannot loop.
      setSnapshot((prev) => (snapshotEqual(prev, next) ? prev : next));
    };

    const debounce = createRafDebounce(measure);

    // Measure once immediately so the first paint has geometry.
    measure();

    const observed: HTMLElement[] = [];
    const resizeObserver = new ResizeObserver(() => debounce.schedule());
    if (modalEl !== null) {
      resizeObserver.observe(modalEl);
      observed.push(modalEl);
    }
    if (composerEl !== null) {
      resizeObserver.observe(composerEl);
      observed.push(composerEl);
    }

    const onScroll = (): void => debounce.schedule();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      try {
        resizeObserver.disconnect();
      } catch {
        // Page unloading; nothing to clean up.
      }
      debounce.cancel();
    };
  }, [hostNode, modalEl, composerEl]);

  return snapshot;
}
