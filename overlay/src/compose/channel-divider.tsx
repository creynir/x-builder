// @x-builder/overlay — ChannelDivider (XOB-029)
//
// The labelled neon hairline that separates the static engine and AI judge
// channels where they are co-located (vertically between zones in wide layout,
// horizontally between cards in stacked layout). It carries the static⟂judge
// firewall identity at the seam: a `--xb-border-edge` gradient line plus the
// two channel text labels, always visible in both layouts.
//
// Token-only styling (no `#1d9bf0` X-blue, no primary CTA): the line is a
// `--xb-border-edge` gradient and the labels ride `--xb-text-muted` /
// `--type-caption`, distinct from native X UI.

import type { CSSProperties, ReactElement } from "react";

export interface ChannelDividerProps {
  /** The label on the leading side of the hairline (e.g. "Static engine"). */
  leading: string;
  /** The label on the trailing side of the hairline (e.g. "AI judge"). */
  trailing: string;
}

const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  font: "var(--type-caption)",
  color: "var(--xb-text-muted)",
  letterSpacing: "0.1em",
};

const LINE_STYLE: CSSProperties = {
  flex: 1,
  height: "var(--border-width-thin)",
  background:
    "linear-gradient(90deg, transparent, var(--xb-border-edge), transparent)",
};

/** A labelled neon hairline marking the static⟂judge channel seam. */
export function ChannelDivider({ leading, trailing }: ChannelDividerProps): ReactElement {
  return (
    <div role="separator" style={ROW_STYLE}>
      <span>{leading}</span>
      <span aria-hidden="true" style={LINE_STYLE} />
      <span>{trailing}</span>
    </div>
  );
}
