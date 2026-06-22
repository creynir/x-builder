// @x-builder/client — v2 Select primitive (token-driven, shadow-DOM-portable)
//
// A native <select> over a bounded option set. `onChange` receives the selected
// option VALUE (a string), not the raw event, so consumers wire provider/format
// pickers without unwrapping `event.target`. Styles travel inline as `var(--…)`
// references; no global CSS.

import type { CSSProperties, ReactElement } from "react";

import { FOCUS_OUTLINE } from "./tokens";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange(value: string): void;
  options: SelectOption[];
  "aria-label"?: string;
  disabled?: boolean;
}

const BASE_STYLE: CSSProperties = {
  width: "100%",
  minHeight: "var(--control-height-sm)",
  padding: "var(--space-1) var(--space-2)",
  font: "var(--type-body-small)",
  color: "var(--xb-text)",
  background: "var(--surface-sunken)",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  borderRadius: "var(--radius-md)",
};

/** A token-driven native select; `onChange` reports the chosen value string. */
export function Select({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  disabled = false,
}: SelectProps): ReactElement {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      style={{ ...BASE_STYLE, opacity: disabled ? 0.55 : 1 }}
      onFocus={(event) => Object.assign(event.currentTarget.style, FOCUS_OUTLINE)}
      onBlur={(event) => {
        event.currentTarget.style.outline = "";
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
