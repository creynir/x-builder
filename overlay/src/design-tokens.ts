// @x-builder/overlay - base design token sheet
//
// Seeds the live overlay primitive tokens onto the shadow :host. The historical
// SPA-era product-tokens.css file was removed; this module is now the local base
// token source referenced by docs/design-system/README.md.

const BASE_TOKENS = `
  --font-size-xs: 12px;

  --space-px: 1px;
  --space-0-5: 2px;
  --space-1: 4px;
  --space-1-5: 6px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-8: 32px;
  --space-12: 48px;

  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-full: 9999px;

  --border-width-thin: 1px;
  --border-width-thick: 2px;

  --control-height-xs: 28px;
  --control-height-sm: 36px;
  --control-height-md: 44px;
  --density-button-height: var(--control-height-sm);
  --density-input-height: var(--control-height-sm);
  --density-nav-item-height: var(--control-height-sm);
  --icon-size-sm: 14px;
  --icon-size-md: 18px;

  --gap-inline-control: var(--space-2);
  --gap-block-section: var(--space-3);
  --padding-page: var(--space-4);
  --padding-panel-default: var(--space-3);
  --padding-panel-spacious: var(--space-4);

  --overlay-width-sm: 360px;
  --overlay-width-md: 480px;
  --overlay-width-lg: 720px;
  --overlay-height-sm: 320px;
  --sidebar-width-collapsed: 56px;
  --sidebar-width-expanded: 248px;

  --tracking-normal: 0;
  --tracking-wide: 0.04em;
  --text-measure-compact: 48ch;
  --text-measure-ui: 64ch;

  --type-caption: 400 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --type-badge: 600 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --type-label: 600 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --type-data: 500 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --type-body-small: 400 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --type-body: 400 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --type-panel-title: 700 15px/1.3 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --type-page-title: 700 24px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  --neutral-4: hsl(215 16% 22%);
  --neutral-5: hsl(215 16% 28%);
  --accent-3: hsl(174 70% 18% / 0.5);
  --info-3: hsl(205 70% 18% / 0.5);
  --success-3: hsl(150 58% 18% / 0.5);
  --success-9: hsl(150 58% 47%);
  --warning-3: hsl(42 82% 20% / 0.55);
  --warning-9: hsl(42 92% 60%);
  --danger-3: hsl(352 70% 19% / 0.55);
  --danger-9: hsl(352 85% 62%);
  --uncertain-3: hsl(260 42% 20% / 0.55);

  --text-primary: var(--xb-text);
  --text-secondary: var(--xb-text-muted);
  --text-muted: var(--xb-text-muted);
  --text-heading: var(--xb-text);
  --text-disabled: hsl(195 12% 54%);
  --text-on-accent: hsl(210 24% 9%);
  --text-accent: var(--xb-accent);
  --text-info: hsl(205 96% 72%);
  --text-success: hsl(150 68% 68%);
  --text-warning: hsl(42 95% 72%);
  --text-danger: hsl(352 92% 76%);
  --text-uncertain: hsl(260 72% 76%);

  --surface-primary: var(--xb-surface-overlay);
  --surface-panel: var(--xb-surface-panel);
  --surface-overlay: var(--xb-surface-overlay);
  --surface-raised: hsl(210 24% 18% / 0.96);
  --surface-sunken: hsl(210 26% 9% / 0.96);
  --surface-hover: hsl(210 24% 22% / 0.82);
  --surface-active: hsl(210 24% 24% / 0.92);
  --surface-selected: hsl(174 70% 18% / 0.55);

  --border-default: var(--xb-border-edge);
  --border-subtle: hsl(195 18% 60% / 0.28);
  --border-hover: hsl(174 90% 62% / 0.75);
  --border-focus: var(--xb-accent);
  --border-accent: var(--xb-accent);
  --border-info: hsl(205 96% 62% / 0.7);
  --border-success: hsl(150 70% 50% / 0.7);
  --border-warning: hsl(42 92% 60% / 0.75);
  --border-danger: hsl(352 85% 62% / 0.75);
  --border-uncertain: hsl(260 72% 66% / 0.7);

  --interactive-default: var(--xb-accent);
  --interactive-hover: hsl(174 90% 62%);
  --focus-ring-color: var(--xb-accent);
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;

  --usage-unused-bg: hsl(210 18% 18% / 0.72);
  --usage-unused-fg: var(--xb-text-muted);
  --usage-generation-bg: hsl(174 70% 18% / 0.55);
  --usage-generation-fg: var(--xb-accent);
  --usage-signal-bg: hsl(205 70% 18% / 0.55);
  --usage-signal-fg: hsl(205 96% 72%);
  --usage-voice-bg: hsl(316 62% 18% / 0.55);
  --usage-voice-fg: var(--xb-accent-2);
  --usage-excluded-bg: hsl(352 70% 18% / 0.42);
  --usage-excluded-fg: hsl(352 92% 76%);

  --score-strong: var(--success-9);
  --score-good: hsl(174 90% 52%);
  --score-usable: hsl(42 92% 60%);
  --score-needs-rewrite: hsl(352 85% 62%);
  --score-unknown: hsl(195 18% 54%);

  --sidebar-bg: var(--xb-surface-panel);
  --sidebar-fg: var(--xb-text);
  --sidebar-border: var(--xb-border-edge);
  --sidebar-hover: var(--surface-hover);
  --sidebar-active-indicator: var(--xb-accent);

  --duration-400: 400ms;
  --ease-default: cubic-bezier(0.2, 0, 0, 1);
  --z-modal: 2147483000;
  --z-popover: 2147483200;
  --z-toast: 2147483300;
`;

const SHEET_TEXT = `
:host {
${BASE_TOKENS}
}
`;

/** Build the constructed stylesheet that seeds the base token closure on :host. */
export function buildDesignTokenSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHEET_TEXT);
  return sheet;
}
