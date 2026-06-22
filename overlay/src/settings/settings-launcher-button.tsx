// @x-builder/overlay — SettingsLauncherButton
//
// The always-visible launcher pinned to the top-left of the overlay shadow
// layer. It is an icon button carrying dialog-popup semantics (`role="button"`
// is implicit on <button>, plus `aria-haspopup="dialog"` and `aria-expanded`)
// and an Aurora-Glass neon orb surface (panel surface + glass blur + edge +
// glow, teal accent icon). A readiness dot in the orb summarises overall state.
//
// Built as a dedicated button rather than the bare v2 IconButton because the
// launcher must expose the popup/expanded ARIA the IconButton does not model;
// it mirrors the IconButton's token-driven orb styling.

import type { OverlayReadiness } from "@x-builder/shared";
import { forwardRef, type CSSProperties, type ReactElement } from "react";

import { FOCUS_OUTLINE } from "../../../client/src/ui/v2/index";

export interface SettingsLauncherButtonProps {
  status: OverlayReadiness | "loading";
  open: boolean;
  onToggle(): void;
}

const ORB_STYLE: CSSProperties = {
  position: "fixed",
  top: "var(--space-3)",
  left: "var(--space-3)",
  zIndex: "var(--xb-z-panel)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "var(--control-height-md)",
  height: "var(--control-height-md)",
  borderRadius: "var(--radius-full)",
  cursor: "pointer",
  color: "var(--xb-accent)",
  background: "var(--xb-surface-panel)",
  backdropFilter: "blur(var(--xb-glass-blur))",
  WebkitBackdropFilter: "blur(var(--xb-glass-blur))",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  boxShadow: "var(--xb-glow-md)",
};

/** Map overall readiness to the dot colour token. */
function dotColor(status: SettingsLauncherButtonProps["status"]): string {
  if (status === "loading") return "var(--xb-text-muted)";
  const states = [status.staticEngine.state, status.llm.state];
  if (states.some((s) => s === "unavailable" || s === "failed")) {
    return "var(--danger-9)";
  }
  if (status.capture.state !== "ok" || states.some((s) => s !== "ready")) {
    return "var(--warning-9)";
  }
  return "var(--success-9)";
}

/** The top-left settings launcher orb. */
export const SettingsLauncherButton = forwardRef<
  HTMLButtonElement,
  SettingsLauncherButtonProps
>(function SettingsLauncherButton({ status, open, onToggle }, ref): ReactElement {
  return (
    <button
      ref={ref}
      type="button"
      aria-label="X Builder settings"
      aria-haspopup="dialog"
      aria-expanded={open}
      style={ORB_STYLE}
      onClick={onToggle}
      onFocus={(event) => Object.assign(event.currentTarget.style, FOCUS_OUTLINE)}
      onBlur={(event) => {
        event.currentTarget.style.outline = "";
      }}
    >
      <span aria-hidden="true" style={{ font: "var(--type-panel-title)" }}>
        ✦
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "var(--space-1)",
          right: "var(--space-1)",
          width: "var(--space-2)",
          height: "var(--space-2)",
          borderRadius: "var(--radius-full)",
          background: dotColor(status),
        }}
      />
    </button>
  );
});
