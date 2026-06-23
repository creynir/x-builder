// @x-builder/overlay — token-seeded shadow host harness (test-only)
//
// The settings affordance and the v2 primitives are shadow-DOM-portable: their
// styles travel as token references (`var(--xb-…)`, `var(--radius-…)`) that
// only resolve when the design-token + neon sheets are adopted on the shadow
// `:host`. These tests therefore must render into a REAL shadow root with those
// sheets adopted, exactly as `bootstrap()` does in production — rendering into
// the bare document body would leave every token unresolved and make the
// Visual-AC assertions meaningless.
//
// `mountShadowHost()` returns the host element plus the React mount node inside
// its shadow root. Pass the mount node as `render(ui, { container: mount })` so
// React renders into the shadow tree. Call `host.remove()` (or the returned
// `cleanup`) in `afterEach`; `vitest-browser-react`'s own `cleanup()` only
// unmounts roots and removes containers parented to `document.body`, so the
// shadow host must be torn down explicitly.

import { buildDesignTokenSheet } from "../design-tokens";
import { buildNeonSheet } from "../neon-sheet";

export interface ShadowHostHandle {
  /** The shadow host element, appended to `document.documentElement`. */
  host: HTMLElement;
  /** The open shadow root with both token sheets adopted. */
  shadow: ShadowRoot;
  /** The element React renders into (first child of the shadow root). */
  mount: HTMLElement;
  /** Remove the host from the document. Safe to call more than once. */
  cleanup(): void;
}

/**
 * Create a fresh `<xb-overlay-test-host>` on `document.documentElement` with an
 * open shadow root that adopts the design-token sheet then the neon sheet (same
 * order as production: neon `--xb-*` tokens win). Returns the host and the
 * inner mount node.
 *
 * `xtheme` optionally seeds `data-xtheme` on the host so the light/default
 * theme override block applies (e.g. for the white-theme Visual-AC checks).
 */
export function mountShadowHost(options: { xtheme?: string } = {}): ShadowHostHandle {
  const host = document.createElement("xb-overlay-test-host");
  if (options.xtheme) host.dataset.xtheme = options.xtheme;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.adoptedStyleSheets = [buildDesignTokenSheet(), buildNeonSheet()];

  const mount = document.createElement("div");
  shadow.appendChild(mount);

  return {
    host,
    shadow,
    mount,
    cleanup() {
      host.remove();
    },
  };
}

/** Resolve a custom property's computed value off a node inside the shadow root. */
export function tokenValue(node: Element, token: string): string {
  return getComputedStyle(node).getPropertyValue(token).trim();
}
