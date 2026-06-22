// @x-builder/client — v2 primitive token helpers
//
// The v2 primitives are shadow-DOM-portable: they ship NO global stylesheet and
// instead carry their styles as inline `style` objects whose every value is a
// `var(--…)` reference. Those custom properties resolve against the design-token
// + Aurora Glass sheets adopted on the overlay shadow `:host` (and against the
// client `:root` in the SPA), so the same component renders correctly in both
// contexts with zero global CSS of its own.
//
// This module is the single place the variant→token maps live, so Badge / Alert
// (and future v2 consumers) stay in lockstep and never inline a raw colour. The
// ONLY literal values allowed in the v2 layer are the token-definition sheets
// (product-tokens.css / neon-sheet.ts) — never here.

import type { CSSProperties } from "react";

/** Semantic state variants shared by Badge and Alert. */
export type StateVariant = "info" | "warning" | "danger" | "success";

/** Badge carries the full product-component variant set. */
export type BadgeVariant =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "uncertain";

/**
 * Foreground / background / border token triple for a semantic state. Every
 * entry is a `var(--…)` reference into the seeded token closure — no literals.
 */
interface VariantTokens {
  readonly fg: string;
  readonly bg: string;
  readonly border: string;
}

const STATE_TOKENS: Record<StateVariant, VariantTokens> = {
  info: { fg: "var(--text-info)", bg: "var(--info-3)", border: "var(--border-info)" },
  warning: {
    fg: "var(--text-warning)",
    bg: "var(--warning-3)",
    border: "var(--border-warning)",
  },
  danger: {
    fg: "var(--text-danger)",
    bg: "var(--danger-3)",
    border: "var(--border-danger)",
  },
  success: {
    fg: "var(--text-success)",
    bg: "var(--success-3)",
    border: "var(--border-success)",
  },
};

const BADGE_TOKENS: Record<BadgeVariant, VariantTokens> = {
  ...STATE_TOKENS,
  neutral: {
    fg: "var(--text-secondary)",
    bg: "var(--usage-unused-bg)",
    border: "var(--border-subtle)",
  },
  accent: {
    fg: "var(--text-accent)",
    bg: "var(--usage-generation-bg)",
    border: "var(--border-accent)",
  },
  uncertain: {
    fg: "var(--text-uncertain)",
    bg: "var(--uncertain-3)",
    border: "var(--border-uncertain)",
  },
};

/** Resolve the token triple for an Alert/Badge state variant. */
export function stateVariantTokens(variant: StateVariant): VariantTokens {
  return STATE_TOKENS[variant];
}

/** Resolve the token triple for any Badge variant. */
export function badgeVariantTokens(variant: BadgeVariant): VariantTokens {
  return BADGE_TOKENS[variant];
}

/** Inline accent focus ring shared by the interactive v2 controls. */
export const FOCUS_OUTLINE: CSSProperties = {
  outlineColor: "var(--focus-ring-color)",
  outlineWidth: "var(--focus-ring-width)",
  outlineStyle: "solid",
  outlineOffset: "var(--focus-ring-offset)",
};
