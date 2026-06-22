// @x-builder/overlay — shadow-DOM injection host bootstrap (XOB-018)
//
// Entry called by the page's `addInitScript` (XOB-015) via
// `window.__xbBootstrap()`. Mounts a single `<xb-overlay-root>` shadow host on
// `document.documentElement` (never `document.body`, never an X-owned node),
// adopts the Aurora Glass neon sheet, and renders the (empty) React tree plus
// the theme bridge inside the shadow root.
//
// Idempotent (guarded by the host id) and paint-friendly (the React render is
// deferred to `requestIdleCallback`; the host/shadow/sheet are created
// synchronously so the host is present the moment `bootstrap()` returns).

import { createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";

import { buildNeonSheet } from "./neon-sheet";
import { OverlayRuntime } from "./runtime";
import { OverlayThemeBridge } from "./theme-bridge";

const HOST_ID = "xb-overlay-root";
const HOST_TAG = "xb-overlay-root";

/** Schedule deferred mount work off the paint-critical path. */
function onIdle(fn: () => void): void {
  const ric = (
    globalThis as { requestIdleCallback?: (cb: () => void) => number }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    ric(fn);
  } else {
    setTimeout(fn, 0);
  }
}

/** Adopt the neon sheet onto the shadow root, degrading gracefully if unsupported. */
function adoptNeonSheet(shadow: ShadowRoot): void {
  const supportsConstructable =
    typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow;

  if (!supportsConstructable) {
    console.warn("[xb] adoptedStyleSheets unavailable — neon sheet skipped");
    return;
  }

  shadow.adoptedStyleSheets = [buildNeonSheet()];
}

/**
 * Mount the overlay shadow host exactly once per document. Safe to call
 * repeatedly (e.g. on SPA navigation re-bootstraps) — the id guard ensures a
 * single host survives.
 */
export function bootstrap(): void {
  // Idempotency guard: if the host already exists, do nothing.
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement(HOST_TAG);
  host.id = HOST_ID;

  // Mount on the document element only — never `document.body` or any X-owned
  // element. This keeps the overlay outside X's React tree.
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  adoptNeonSheet(shadow);

  // The React mount node: shadow root's first element child. Created
  // synchronously so the shadow tree is inspectable immediately; the actual
  // render is deferred below.
  const mountNode = document.createElement("div");
  shadow.appendChild(mountNode);

  onIdle(() => {
    // The host may have been torn down before the idle callback fired.
    if (!document.getElementById(HOST_ID)) return;
    // Empty runtime tree + the theme bridge (writes `data-xtheme` onto the host).
    createRoot(mountNode).render(
      createElement(
        Fragment,
        null,
        createElement(OverlayRuntime, null),
        createElement(OverlayThemeBridge, { hostEl: host }),
      ),
    );
  });
}
