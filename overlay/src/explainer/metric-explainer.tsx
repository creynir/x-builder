// @x-builder/overlay — MetricExplainer (orchestrator)
//
// The inline, leaf affordance a metric host renders after a metric label. It
// always shows a quiet ExplainerTrigger ("ⓘ") and, when expanded (L4 local
// state), an ExplainerPopover describing the metric. Copy resolves from the
// `source` override when supplied, else from the shipped `overlayExplainerCopy`;
// a key absent from the resolved map (a downstream union/map drift) degrades to
// a "No description available" fallback rather than crashing.
//
// Open/close: clicking the trigger toggles `expanded`; Esc and click-outside
// (raised inside the popover) request a close, and this component restores focus
// to the trigger so keyboard users land back where they were. Each instance owns
// its own `expanded` — multiple explainers can be open at once; one-at-a-time is
// a metric-host concern, out of scope here.

import { useCallback, useId, useRef, useState, type ReactElement } from "react";

import { overlayExplainerCopy } from "./copy";
import { ExplainerPopover } from "./explainer-popover";
import { ExplainerTrigger } from "./explainer-trigger";
import type { ExplainerEntry, ExplainerSource, MetricKey } from "./types";

export interface MetricExplainerProps {
  /** Which metric to explain. */
  metricKey: MetricKey;
  /** L1 copy override; falls back to `overlayExplainerCopy` when absent. */
  source?: ExplainerSource;
  /** Current metric value; `null`/absent ⇒ popover omits the scale + notes it. */
  value?: number | null;
  /** Current band label, surfaced as context when present. */
  band?: string;
}

/** The fallback shown when a key is missing from the resolved copy map. */
const FALLBACK_ENTRY: ExplainerEntry = {
  label: "No description available",
  whatItMeans: "No description available for this metric.",
  howToRead: "There is no explainer copy registered for this metric.",
  goodDirection: "higher",
};

const CONTAINER_STYLE = {
  position: "relative" as const,
  display: "inline-flex",
  alignItems: "center",
};

/** Inline metric explainer: trigger always, popover on expand. */
export function MetricExplainer({
  metricKey,
  source,
  value,
  band,
}: MetricExplainerProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const copy = source ?? overlayExplainerCopy;
  const entry: ExplainerEntry = copy[metricKey] ?? FALLBACK_ENTRY;

  const close = useCallback((): void => {
    setExpanded(false);
    // Restore focus to the trigger so keyboard users are not stranded.
    triggerRef.current?.focus();
  }, []);

  return (
    <span style={CONTAINER_STYLE}>
      <ExplainerTrigger
        buttonRef={triggerRef}
        label={entry.label}
        expanded={expanded}
        popoverId={popoverId}
        onToggle={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <ExplainerPopover
          id={popoverId}
          entry={entry}
          band={band}
          onClose={close}
          triggerRef={triggerRef}
          value={value}
        />
      ) : null}
    </span>
  );
}
