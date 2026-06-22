// @x-builder/overlay — ExplainerTrigger (quiet "ⓘ" toggle)
//
// The always-rendered affordance that opens a metric's ExplainerPopover. It is a
// ghost native <button> (IconButton-derived styling: no fill, no border) sized
// down to disappear next to the metric label until the reader wants it. Its
// styles travel inline as `var(--…)` references — `--xb-text-muted` for the
// quiet glyph colour and `--font-size-xs` for the small footprint — so they
// resolve against the seeded token closure inside the overlay shadow host.
//
// A11y: `aria-expanded` mirrors the popover open state, `aria-controls` points at
// the popover id (best-effort — the popover is conditionally rendered, so this
// is absent while closed, which is acceptable per ARIA for conditional content),
// and `aria-label` is "Explain [label]" so the glyph has a real accessible name.

import type { CSSProperties, ReactElement, Ref } from "react";

import { FOCUS_OUTLINE } from "../../../client/src/ui/v2/index";

export interface ExplainerTriggerProps {
  /** Human metric label, woven into the accessible name. */
  label: string;
  /** Whether the popover this trigger controls is currently open. */
  expanded: boolean;
  /** The popover element id, wired to `aria-controls` when open. */
  popoverId: string;
  /** Toggle the popover open/closed. */
  onToggle(): void;
  /** Ref to the underlying button so the popover can return focus on close. */
  buttonRef?: Ref<HTMLButtonElement>;
}

const TRIGGER_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  marginInlineStart: "var(--space-1)",
  background: "transparent",
  border: "var(--border-width-thin) solid transparent",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  lineHeight: 1,
  // Quiet ghost: muted colour + xs font so it never competes with the label.
  color: "var(--xb-text-muted)",
  fontSize: "var(--font-size-xs)",
};

/** The quiet "ⓘ" button that opens a metric explainer. */
export function ExplainerTrigger({
  label,
  expanded,
  popoverId,
  onToggle,
  buttonRef,
}: ExplainerTriggerProps): ReactElement {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Explain ${label}`}
      aria-expanded={expanded}
      aria-controls={expanded ? popoverId : undefined}
      style={TRIGGER_STYLE}
      onClick={onToggle}
      onFocus={(event) => Object.assign(event.currentTarget.style, FOCUS_OUTLINE)}
      onBlur={(event) => {
        event.currentTarget.style.outline = "";
      }}
    >
      <span aria-hidden="true">ⓘ</span>
    </button>
  );
}
