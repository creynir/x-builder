// @x-builder/client — v2 Switch primitive (token-driven, shadow-DOM-portable)
//
// An immediate binary control. Exposes `role="switch"` + `aria-checked`, emits
// the NEXT boolean on toggle, and ignores changes when disabled. The optional
// label is rendered alongside (and is the accessible name). Styles travel inline
// as `var(--…)` references; no global CSS.

import type { CSSProperties, ReactElement } from "react";

import { FOCUS_OUTLINE } from "./tokens";

export interface SwitchProps {
  checked: boolean;
  onChange(next: boolean): void;
  label?: string;
  disabled?: boolean;
}

/** A token-driven switch reporting the inverted boolean on toggle. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: SwitchProps): ReactElement {
  const trackStyle: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    width: "var(--space-8)",
    minHeight: "var(--space-4)",
    padding: "var(--space-0-5)",
    borderRadius: "var(--radius-full)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    background: checked ? "var(--interactive-default)" : "var(--neutral-5)",
    border: "var(--border-width-thin) solid var(--xb-border-edge)",
    justifyContent: checked ? "flex-end" : "flex-start",
  };

  const thumbStyle: CSSProperties = {
    display: "block",
    width: "var(--space-3)",
    height: "var(--space-3)",
    borderRadius: "var(--radius-full)",
    background: "var(--xb-text)",
  };

  const wrapperStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--gap-inline-control)",
    font: "var(--type-body-small)",
    color: "var(--xb-text)",
  };

  return (
    <label style={wrapperStyle}>
      {label ? <span>{label}</span> : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        style={trackStyle}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
        onFocus={(event) => Object.assign(event.currentTarget.style, FOCUS_OUTLINE)}
        onBlur={(event) => {
          event.currentTarget.style.outline = "";
        }}
      >
        <span aria-hidden="true" style={thumbStyle} />
      </button>
    </label>
  );
}
