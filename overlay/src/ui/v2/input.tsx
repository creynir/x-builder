// @x-builder/client — v2 Input primitive (token-driven, shadow-DOM-portable)
//
// A native <input> whose styles travel inline as `var(--…)` references. The
// value is driven through the DOM node (set imperatively from the `value` prop)
// and changes are reported through a native `input` listener rather than React's
// synthetic onChange. Going through the real DOM event keeps the primitive
// portable into the overlay's shadow root, where React's value-tracker-based
// synthetic change wiring is brittle for programmatic input.

import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";

import { FOCUS_OUTLINE } from "./tokens";

export interface InputProps {
  value: string;
  onChange(value: string): void;
  type?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

const BASE_STYLE: CSSProperties = {
  width: "100%",
  minHeight: "var(--control-height-sm)",
  padding: "var(--space-1-5) var(--space-2)",
  font: "var(--type-body-small)",
  color: "var(--xb-text)",
  background: "var(--surface-sunken)",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  borderRadius: "var(--radius-md)",
};

/** A token-driven native input; `onChange` reports the current value string. */
export function Input({
  value,
  onChange,
  type = "text",
  "aria-label": ariaLabel,
  disabled = false,
}: InputProps): ReactElement {
  const ref = useRef<HTMLInputElement>(null);

  // Mirror the controlled `value` onto the DOM node without letting React manage
  // it (which would install a value tracker that suppresses programmatic input
  // events inside the shadow root).
  useEffect(() => {
    const node = ref.current;
    if (node && node.value !== value) node.value = value;
  }, [value]);

  // Report changes through the real DOM event so dispatched `input` events are
  // always observed regardless of React's synthetic-event tracking.
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const handler = (): void => onChange(node.value);
    node.addEventListener("input", handler);
    return () => node.removeEventListener("input", handler);
  }, [onChange]);

  return (
    <input
      ref={ref}
      type={type}
      defaultValue={value}
      aria-label={ariaLabel}
      disabled={disabled}
      style={{ ...BASE_STYLE, opacity: disabled ? 0.55 : 1 }}
      onFocus={(event) => Object.assign(event.currentTarget.style, FOCUS_OUTLINE)}
      onBlur={(event) => {
        event.currentTarget.style.outline = "";
      }}
    />
  );
}
