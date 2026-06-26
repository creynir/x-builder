// @x-builder/overlay — ReadinessIndicator
//
// Maps an OverlayReadiness shape to colored v2 Badge dots — one each for the
// static engine, the LLM judge, and live capture — using the REAL shared
// ReadinessState enum. When capture is paused / layout-changed, OR the selector
// miss count crosses its threshold, a warning Alert surfaces the verbatim
// "X layout changed — affordances paused" copy. Judge readiness is surfaced here
// (via readiness.llm), not as a settings field.

import type { ReadinessState, SubsystemStatus, OverlayReadiness } from "@x-builder/shared";
import type { ReactElement } from "react";

import { Alert } from "../ui/v2/alert";
import { Badge } from "../ui/v2/badge";
import type { BadgeVariant } from "../ui/v2/index";

export interface ReadinessIndicatorProps {
  readiness: OverlayReadiness | "loading" | { error: unknown };
  selectorMissCount: number;
  selectorMissThreshold?: number;
}

const LAYOUT_CHANGED_TEXT = "X layout changed — affordances paused";
const DEFAULT_SELECTOR_MISS_THRESHOLD = 5;

/** Map a subsystem readiness state to a Badge variant. */
function subsystemVariant(state: ReadinessState): BadgeVariant {
  switch (state) {
    case "ready":
      return "success";
    case "partial":
    case "checking":
    case "stale":
      return "warning";
    case "unavailable":
    case "failed":
    case "disabled":
    case "unconfigured":
      return "danger";
    default:
      return "uncertain";
  }
}

function isResolved(
  readiness: ReadinessIndicatorProps["readiness"],
): readiness is OverlayReadiness {
  return (
    readiness !== "loading" &&
    typeof readiness === "object" &&
    readiness !== null &&
    !("error" in readiness)
  );
}

function SubsystemBadge({ status }: { status: SubsystemStatus }): ReactElement {
  return <Badge variant={subsystemVariant(status.state)}>{status.label}</Badge>;
}

/** The engine / judge / capture readiness dots plus the layout-changed alert. */
export function ReadinessIndicator({
  readiness,
  selectorMissCount,
  selectorMissThreshold = DEFAULT_SELECTOR_MISS_THRESHOLD,
}: ReadinessIndicatorProps): ReactElement | null {
  if (!isResolved(readiness)) return null;

  const captureOk = readiness.capture.state === "ok";
  const capturePaused =
    readiness.capture.state === "paused" ||
    readiness.capture.state === "layout_changed";
  const showLayoutWarning =
    capturePaused || selectorMissCount >= selectorMissThreshold;

  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          alignItems: "center",
        }}
      >
        <SubsystemBadge status={readiness.staticEngine} />
        <SubsystemBadge status={readiness.llm} />
        <Badge variant={captureOk ? "success" : "warning"}>
          {readiness.capture.label}
        </Badge>
      </div>
      {showLayoutWarning ? (
        <Alert variant="warning">{LAYOUT_CHANGED_TEXT}</Alert>
      ) : null}
    </div>
  );
}
