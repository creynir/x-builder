// @x-builder/client — v2 Button primitive (token-driven, shadow-DOM-portable)
//
// A native <button> whose styles are carried inline as `var(--…)` references
// into the seeded token closure, so it renders identically in the SPA :root and
// inside the overlay shadow :host with no global stylesheet. Loading replaces
// the leading icon with a spinner and keeps the label visible (product-component
// content rule); disabled uses the native disabled attribute and suppresses
// onClick.

import type { CSSProperties, ReactElement, ReactNode } from "react";

import { FOCUS_OUTLINE } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Background / foreground / border token triple per variant. */
const VARIANT_STYLE: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: "var(--interactive-default)",
    color: "var(--text-on-accent)",
    border: "var(--border-width-thin) solid var(--border-accent)",
  },
  secondary: {
    background: "var(--xb-surface-panel)",
    color: "var(--xb-text)",
    border: "var(--border-width-thin) solid var(--xb-border-edge)",
  },
  ghost: {
    background: "transparent",
    color: "var(--xb-text)",
    border: "var(--border-width-thin) solid transparent",
  },
  danger: {
    background: "var(--danger-3)",
    color: "var(--text-danger)",
    border: "var(--border-width-thin) solid var(--border-danger)",
  },
};

const SIZE_STYLE: Record<ButtonSize, CSSProperties> = {
  sm: {
    minHeight: "var(--control-height-xs)",
    padding: "var(--space-1) var(--space-2)",
    font: "var(--type-label)",
  },
  md: {
    minHeight: "var(--control-height-sm)",
    padding: "var(--space-1-5) var(--space-3)",
    font: "var(--type-body-small)",
  },
};

function Spinner(): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-spinner=""
      role="progressbar"
      style={{
        display: "inline-block",
        width: "var(--icon-size-sm)",
        height: "var(--icon-size-sm)",
        borderRadius: "var(--radius-full)",
        border: "var(--border-width-thick) solid var(--xb-border-edge)",
        borderTopColor: "var(--xb-accent)",
      }}
    />
  );
}

/** A token-driven native button. */
export function Button({
  children,
  onClick,
  disabled = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  variant = "secondary",
  size = "md",
}: ButtonProps): ReactElement {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--gap-inline-control)",
    borderRadius: "var(--radius-md)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    boxShadow: "var(--xb-glow-sm)",
    ...VARIANT_STYLE[variant],
    ...SIZE_STYLE[size],
  };

  return (
    <button
      type="button"
      style={style}
      disabled={disabled}
      aria-busy={loading ? "true" : undefined}
      onClick={disabled ? undefined : onClick}
      onFocus={(event) => Object.assign(event.currentTarget.style, FOCUS_OUTLINE)}
      onBlur={(event) => {
        event.currentTarget.style.outline = "";
      }}
    >
      {loading ? <Spinner /> : leadingIcon}
      <span>{children}</span>
      {trailingIcon}
    </button>
  );
}
