// @x-builder/overlay — IIFE entry (XOB-018)
//
// Bundled by vite into `dist/overlay.iife.js` (React bundled in,
// self-contained). The page's `addInitScript` (XOB-015) injects this bundle
// and later calls `window.__xbBootstrap()` to mount the overlay. We assign the
// global at module-evaluation time so it is available the instant the bundle
// runs.

import { bootstrap } from "./bootstrap";

declare global {
  interface Window {
    __xbBootstrap?: () => void;
  }
}

window.__xbBootstrap = bootstrap;

export { bootstrap };
