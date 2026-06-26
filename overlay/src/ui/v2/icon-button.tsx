// @x-builder/client — v2 IconButton primitive (token-driven, shadow-DOM-portable)
//
// A compact icon-only native <button> with a required accessible name. Styles
// travel inline as `var(--…)` references; no global CSS. The optional tooltip is
// surfaced as the native `title` so it works inside the shadow root without a
// portal.

import type { CSSProperties, ReactElement, ReactNode } from "react";

import { FOCUS_OUTLINE } from "./tokens";

export type IconButtonVariant = "ghost" | "secondary" | "danger";

export interface IconButtonProps {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  variant?: IconButtonVariant;
  tooltip?: string;
}

const VARIANT_STYLE: Record<IconButtonVariant, CSSProperties> = {
  ghost: {
    background: "transparent",
    color: "var(--xb-accent)",
    border: "var(--border-width-thin) solid transparent",
  },
  secondary: {
    background: "var(--xb-surface-panel)",
    color: "var(--xb-accent)",
    border: "var(--border-width-thin) solid var(--xb-border-edge)",
  },
  danger: {
    background: "var(--danger-3)",
    color: "var(--text-danger)",
    border: "var(--border-width-thin) solid var(--border-danger)",
  },
};

/** A token-driven icon-only button exposing a required accessible name. */
export function IconButton({
  label,
  icon,
  onClick,
  variant = "ghost",
  tooltip,
}: IconButtonProps): ReactElement {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "var(--control-height-sm)",
    minHeight: "var(--control-height-sm)",
    padding: "var(--space-1)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    ...VARIANT_STYLE[variant],
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={tooltip ?? label}
      style={style}
      onClick={onClick}
      onFocus={(event) => Object.assign(event.currentTarget.style, FOCUS_OUTLINE)}
      onBlur={(event) => {
        event.currentTarget.style.outline = "";
      }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex" }}>
        {icon}
      </span>
    </button>
  );
}
