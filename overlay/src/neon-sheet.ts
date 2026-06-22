// @x-builder/overlay — Aurora Glass neon token sheet (XOB-018)
//
// Constructs the single `CSSStyleSheet` adopted by the overlay shadow root.
// It seeds the full `--xb-*` token set on `:host`, collapses the host's own
// box (`display: contents`, zero paint), exposes the light/`default`-theme
// override block, and stubs the reduced-motion pulse pattern that XOB-022+
// will inherit.

/**
 * The complete Aurora Glass `--xb-*` token set, seeded on `:host`.
 *
 * NOTE on value forms: custom-property values are stored verbatim by the
 * engine (no parsing/normalization beyond whitespace trimming), so the
 * authored alpha forms must already match the trimmed values the tests
 * read back via `getComputedStyle` — e.g. `0.4`/`0.2`, not `0.40`/`0.20`.
 */
const HOST_TOKENS = `
  --xb-accent: hsl(174 90% 52%);
  --xb-accent-2: hsl(316 88% 62%);
  --xb-judge: hsl(192 95% 60%);
  --xb-surface-panel: hsl(210 28% 9% / 0.72);
  --xb-surface-overlay: hsl(210 30% 7% / 0.88);
  --xb-border-edge: hsl(174 90% 52% / 0.55);
  --xb-glow-sm: 0 0 8px hsl(174 90% 52% / 0.35);
  --xb-glow-md: 0 0 18px hsl(174 90% 52% / 0.4);
  --xb-glow-judge: 0 0 12px hsl(192 95% 60% / 0.45);
  --xb-text: hsl(180 25% 96%);
  --xb-text-muted: hsl(195 18% 74%);
  --xb-band-post-now: hsl(150 70% 50%);
  --xb-band-slight: hsl(174 90% 52%);
  --xb-band-major: hsl(42 92% 60%);
  --xb-band-donot: hsl(352 85% 62%);
  --xb-pulse-duration: 1100ms;
  --xb-glass-blur: 12px;
  --xb-z-pin: 2147483000;
  --xb-z-panel: 2147483100;
  --xb-z-popover: 2147483200;
  --xb-highlight-green: hsl(150 72% 50%);
  --xb-highlight-green-wash: hsl(150 72% 50% / 0.14);
  --xb-highlight-blue: hsl(205 96% 62%);
  --xb-highlight-blue-warn: hsl(205 96% 62% / 0.34);
  --xb-highlight-blue-suggest: hsl(205 96% 62% / 0.2);
`;

/**
 * `default` (light) theme override: the dark-glass panel becomes near-opaque,
 * body text flips dark, and the neon glows are softened to half intensity so
 * they read on a light backdrop.
 */
const DEFAULT_THEME_OVERRIDE = `
  --xb-surface-panel: hsl(210 28% 9% / 0.94);
  --xb-surface-overlay: hsl(210 30% 7% / 0.94);
  --xb-text: hsl(200 30% 12%);
  --xb-glow-sm: 0 0 8px hsl(174 90% 52% / 0.18);
  --xb-glow-md: 0 0 18px hsl(174 90% 52% / 0.2);
  --xb-glow-judge: 0 0 12px hsl(192 95% 60% / 0.22);
`;

const SHEET_TEXT = `
:host {
  display: contents;
${HOST_TOKENS}
}

:host([data-xtheme="default"]) {
${DEFAULT_THEME_OVERRIDE}
}

@media (prefers-reduced-motion: reduce) {
  :host {
    --xb-pulse-duration: 0ms;
  }
}
`;

/**
 * Build the single constructed stylesheet adopted by the overlay shadow root.
 *
 * Throws if `CSSStyleSheet` is unavailable; callers (`bootstrap`) guard for
 * that environment and degrade gracefully.
 */
export function buildNeonSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHEET_TEXT);
  return sheet;
}
