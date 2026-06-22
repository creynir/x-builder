// @x-builder/overlay — X theme → overlay theme bridge (XOB-018)
//
// Reads X's active theme and reflects it onto the shadow host's
// `data-xtheme` attribute, which the neon sheet keys its override blocks off.
// Pure DOM side-effect: no React state holds the theme; the source of truth
// is `hostEl.dataset.xtheme`. A MutationObserver on `<html>` keeps it in sync
// across live theme switches without remounting React.

import { useEffect } from "react";

export type XTheme = "default" | "dim" | "lights-out";

export interface OverlayThemeBridgeProps {
  /** The `<xb-overlay-root>` element; the bridge writes `data-xtheme` here. */
  hostEl: HTMLElement;
}

/** Map a raw X `data-theme` attribute value onto our theme enum. */
function fromDataTheme(value: string): XTheme | null {
  switch (value.trim().toLowerCase()) {
    case "dim":
      return "dim";
    case "lights-out":
    case "lightsout":
    case "dark":
      return "lights-out";
    case "default":
    case "light":
      return "default";
    default:
      return null;
  }
}

/**
 * Heuristic fallback for X layouts that carry no `data-theme` attribute:
 * derive the theme from the `<body>` computed background color.
 *   rgb(21, 32, 43) → Dim, rgb(0, 0, 0) → Lights Out, otherwise Default.
 */
function fromBackgroundColor(): XTheme {
  const bg = getComputedStyle(document.body).backgroundColor.replace(/\s+/g, "");
  if (bg === "rgb(21,32,43)") return "dim";
  if (bg === "rgb(0,0,0)") return "lights-out";
  return "default";
}

/** Resolve X's active theme: prefer the `data-theme` attribute, else heuristic. */
function resolveTheme(): XTheme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) {
    const mapped = fromDataTheme(attr);
    if (mapped) return mapped;
  }
  return fromBackgroundColor();
}

/**
 * Side-effect-only component: keeps `hostEl.dataset.xtheme` in sync with X's
 * active theme on mount and across live changes. Renders nothing.
 */
export function OverlayThemeBridge({ hostEl }: OverlayThemeBridgeProps): null {
  useEffect(() => {
    const sync = (): void => {
      hostEl.dataset.xtheme = resolveTheme();
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });

    return () => observer.disconnect();
  }, [hostEl]);

  return null;
}
