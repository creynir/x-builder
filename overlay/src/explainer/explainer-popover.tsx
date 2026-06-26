// @x-builder/overlay — ExplainerPopover (the metric explanation dialog)
//
// A non-modal `role="dialog"` anchored near its ExplainerTrigger. It explains a
// single metric: the label heading, the `whatItMeans` paragraph, the `howToRead`
// paragraph, and — when the entry defines a scale — the two poles rendered as a
// pair of v2 `Badge`s (always `neutral`: a labelled scale must not imply colour
// meaning). For `audienceMatch` (and any metric with no numeric value) the scale
// is omitted and an "insufficient data" note is shown instead, so a null value
// never crashes the render.
//
// It is NON-modal (`aria-modal="false"`) so Shift-Tab can still reach x.com.
// Closing: `Esc` (focus return is owned by the parent via the trigger ref) and
// click-outside detected with `composedPath()` across the shadow boundary; a
// pointerdown whose path stays inside the dialog must NOT dismiss it.
//
// Styling: Aurora Glass tokens only, inline as `var(--…)` references — surface,
// border edge, small glow, medium radius, caption font, body text colour, and a
// glass blur backdrop. Width/height are constrained so a long entry scrolls
// internally rather than overflowing the shadow host.

import { useEffect, useRef, type CSSProperties, type ReactElement, type RefObject } from "react";

import { Badge } from "../ui/v2/badge";
import type { ExplainerEntry } from "./types";

export interface ExplainerPopoverProps {
  /** Stable id; matches the trigger's `aria-controls`. */
  id: string;
  /** The resolved copy for this metric. */
  entry: ExplainerEntry;
  /** Close request (Esc / click-outside); parent restores focus to the trigger. */
  onClose(): void;
  /** The trigger button, so click-outside can treat it as "inside". */
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Current metric value: `null`/`undefined` ⇒ omit scale, show the null note. */
  value?: number | null;
  /** Current band label, surfaced as muted context when present. */
  band?: string;
}

const POPOVER_STYLE: CSSProperties = {
  position: "absolute",
  insetInlineStart: 0,
  marginBlockStart: "var(--space-1)",
  maxWidth: "min(320px, 90vw)",
  maxHeight: "60vh",
  overflowY: "auto",
  display: "grid",
  gap: "var(--space-2)",
  padding: "var(--space-3)",
  // Aurora Glass surface.
  background: "var(--xb-surface-overlay)",
  backdropFilter: "blur(var(--xb-glass-blur))",
  WebkitBackdropFilter: "blur(var(--xb-glass-blur))",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--xb-glow-sm)",
  font: "var(--type-caption)",
  color: "var(--xb-text)",
  zIndex: "var(--xb-z-panel)",
};

const HEADING_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-label)",
  color: "var(--xb-text)",
};

const PARAGRAPH_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-caption)",
  color: "var(--xb-text)",
};

const NOTE_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-caption)",
  color: "var(--xb-text-muted)",
};

const SCALE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

/** The metric explanation dialog. */
export function ExplainerPopover({
  id,
  entry,
  onClose,
  triggerRef,
  value,
  band,
}: ExplainerPopoverProps): ReactElement {
  // The dialog node itself — used for shadow-aware click-outside containment
  // (`document.getElementById` cannot see into the shadow root).
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Esc closes (parent returns focus to the trigger). Capture phase so a keydown
  // dispatched on the trigger — which is outside this subtree's React handlers —
  // still reaches us across the shadow boundary.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Click-outside via composedPath: a pointerdown whose path never touches the
  // dialog or its trigger dismisses the popover; an inside interaction does not.
  useEffect(() => {
    const onPointerDown = (event: Event): void => {
      const dialog = dialogRef.current;
      const trigger = triggerRef.current;
      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const target = (path[0] as Node | undefined) ?? (event.target as Node | null);
      const inside =
        (dialog != null && target instanceof Node && dialog.contains(target)) ||
        (trigger != null && target instanceof Node && trigger.contains(target)) ||
        (dialog != null && path.includes(dialog)) ||
        (trigger != null && path.includes(trigger));
      if (!inside) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose, triggerRef]);

  const hasValue = value !== null && value !== undefined;
  // The labelled scale is part of the metric's meaning, so it renders whenever
  // the entry defines one — independent of whether a current value is known. A
  // missing value only suppresses any value-anchored highlight and surfaces the
  // insufficient-data note below; it does not hide the scale itself.
  const showScale = entry.scale != null;

  return (
    <div
      ref={dialogRef}
      id={id}
      role="dialog"
      aria-modal="false"
      aria-label={`${entry.label} — metric explainer`}
      style={POPOVER_STYLE}
    >
      <h3 style={HEADING_STYLE}>{entry.label}</h3>
      <p style={PARAGRAPH_STYLE}>{entry.whatItMeans}</p>
      <p style={PARAGRAPH_STYLE}>{entry.howToRead}</p>
      {showScale && entry.scale ? (
        <div style={SCALE_STYLE}>
          <Badge variant="neutral">{entry.scale.lowLabel}</Badge>
          <Badge variant="neutral">{entry.scale.highLabel}</Badge>
        </div>
      ) : null}
      {band ? <p style={NOTE_STYLE}>Current band: {band}</p> : null}
      {!hasValue ? (
        <p style={NOTE_STYLE}>No value yet — insufficient data to place this metric.</p>
      ) : null}
    </div>
  );
}
