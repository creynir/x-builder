// @x-builder/overlay — design-system token sheet (XOB-019, folded-in)
//
// Seeds the FULL `docs/design-system/product-tokens.css` token closure onto the
// overlay shadow `:host`. The overlay is shadow-isolated and x.com publishes no
// `:root` design tokens, so `--space-*`, `--type-*`, `--radius-*`, `--score-*`
// (and every base primitive they reference) would not otherwise resolve. This
// sheet is adopted alongside the neon sheet in `bootstrap()` so downstream
// tickets (XOB-021/024/025/026/029) can consume the primitives.
//
// Mechanism: raw-import the canonical product-tokens.css and rescope its
// top-level `:root` selectors to `:host` via a global `:root` → `:host`
// replacement. That single replace also rescopes the `:root` blocks nested in
// the `@media` theme/motion variants and the combined `:root, [data-density…]`
// selector. The attribute-scoped blocks (`[data-theme="light"]`, density,
// contrast) carry no `:root`, so they stay inert on the host (which sets none
// of those attributes) — harmless. The result is `replaceSync`'d into a single
// constructed `CSSStyleSheet`.

import productTokensCss from "../../docs/design-system/product-tokens.css?raw";

/**
 * Rescope every `:root` selector in the source CSS to `:host` so the token
 * closure lands on the shadow host. A global replace is sufficient: `:root`
 * only ever appears as a selector here (custom-property values never contain
 * the literal `:root`).
 */
function rescopeRootToHost(css: string): string {
  return css.replace(/:root/g, ":host");
}

/**
 * Build the constructed stylesheet that seeds the product-tokens closure on
 * `:host`. Throws if `CSSStyleSheet` is unavailable; `bootstrap()` guards that
 * environment and degrades gracefully.
 */
export function buildDesignTokenSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(rescopeRootToHost(productTokensCss));
  return sheet;
}
