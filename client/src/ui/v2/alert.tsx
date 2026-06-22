// @x-builder/client — v2 Alert primitive (token-driven, shadow-DOM-portable)
//
// Persistent in-panel feedback. Exposes `role="alert"` (an assertive live
// region) and a `data-variant` marker so consumers and tests can distinguish
// info / warning / danger / success without reading colour. Styles travel inline
// as `var(--…)` references resolved against the seeded token closure.

import type { CSSProperties, ReactElement, ReactNode } from "react";

import { stateVariantTokens, type StateVariant } from "./tokens";

export interface AlertProps {
  variant: StateVariant;
  children: ReactNode;
}

/** A token-driven persistent alert. */
export function Alert({ variant, children }: AlertProps): ReactElement {
  const tokens = stateVariantTokens(variant);
  const style: CSSProperties = {
    display: "block",
    padding: "var(--padding-panel-default)",
    borderRadius: "var(--radius-md)",
    font: "var(--type-body-small)",
    color: tokens.fg,
    background: tokens.bg,
    border: `var(--border-width-thin) solid ${tokens.border}`,
  };

  return (
    <div role="alert" data-variant={variant} style={style}>
      {children}
    </div>
  );
}
