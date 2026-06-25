// @x-builder/overlay — Tooltip (instant, token-styled hover hint)
//
// Native `title` only appears after a ~1s browser delay and can't be sped up, so
// affordances that need an immediate explanation (cooldown badges, etc.) use this
// instead: a hover hint shown the instant the pointer enters, with a `pointer`
// cursor. It is positioned `fixed` against the target's viewport rect (measured
// on hover) so it ESCAPES any `overflow:auto` ancestor (e.g. the cockpit pins)
// instead of being clipped.

import { useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

const WRAP_STYLE: CSSProperties = {
  display: "inline-flex",
  cursor: "pointer",
};

const TIP_BASE: CSSProperties = {
  position: "fixed",
  zIndex: "var(--xb-z-popover)",
  width: "max-content",
  maxWidth: "280px",
  padding: "var(--space-2)",
  background: "var(--xb-surface-overlay)",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--xb-glow-sm)",
  color: "var(--xb-text)",
  font: "var(--type-body-small)",
  whiteSpace: "normal",
  // The hint never intercepts the pointer (so leaving the target always hides it).
  pointerEvents: "none",
};

export interface TooltipProps {
  content: string;
  children: ReactNode;
  /** Which side of the target the hint opens toward. Default "top". */
  placement?: "top" | "bottom";
}

/** A wrapper that shows `content` instantly on hover (pointer cursor). */
export function Tooltip({ content, children, placement = "top" }: TooltipProps): ReactElement {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const open = (): void => {
    const el = wrapRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setCoords(
      placement === "bottom"
        ? { left: r.left, top: r.bottom + 6, below: true }
        : { left: r.left, top: r.top - 6, below: false },
    );
  };

  const tipStyle: CSSProperties | null =
    coords === null
      ? null
      : {
          ...TIP_BASE,
          left: `${coords.left}px`,
          top: `${coords.top}px`,
          // For a "top" hint, anchor the bottom edge to the target's top.
          transform: coords.below ? undefined : "translateY(-100%)",
        };

  return (
    <span
      ref={wrapRef}
      style={WRAP_STYLE}
      onMouseEnter={open}
      onMouseLeave={() => setCoords(null)}
    >
      {children}
      {tipStyle !== null && content.length > 0 ? (
        <span role="tooltip" style={tipStyle}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
