// @x-builder/client — v2 Badge primitive (token-driven, shadow-DOM-portable)
//
// A compact state/category label. A badge always contains text (colour alone is
// never enough) and exposes a `data-variant` marker so each variant is
// distinguishable without reading colour. Styles travel inline as `var(--…)`
// references resolved against the seeded token closure.

import type { CSSProperties, ReactElement, ReactNode } from "react";

import { badgeVariantTokens, type BadgeVariant } from "./tokens";

export interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
}

/** A token-driven text badge. */
export function Badge({ variant, children }: BadgeProps): ReactElement {
  const tokens = badgeVariantTokens(variant);
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--space-1)",
    padding: "var(--space-0-5) var(--space-2)",
    borderRadius: "var(--radius-full)",
    font: "var(--type-badge)",
    color: tokens.fg,
    background: tokens.bg,
    border: `var(--border-width-thin) solid ${tokens.border}`,
  };

  return (
    <span data-variant={variant} style={style}>
      {children}
    </span>
  );
}
