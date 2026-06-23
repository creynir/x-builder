// @x-builder/overlay — ComposeGenerateRail (LEFT cockpit zone)
//
// A purely presentational vertical pill list: one ghost v2 Button per
// GenerateCategory, labelled verbatim. A category in cooldown/warming appends a
// warning v2 Badge whose text is built ONLY from the fields on GenerateCategory
// (cooldownStatus + sampleCount) — there is no windowDays/message on the shape.
// The pending category (pending === category.id) renders the Button in its
// built-in loading+disabled state (spinner + aria-busy, label stays visible),
// which suppresses its onClick so a rapid second click cannot double-generate.
// Clicking a button calls onGenerate(category) with the FULL category object.
//
// basis never reaches the DOM, so cold-start (basis "default") renders
// identically to corpus-backed categories. Long labels truncate with CSS
// ellipsis and expose the full label via native `title` (the accessible name).
// All visual values come from --xb-*/--space-* tokens resolved in the overlay
// shadow :host; v2 primitives are consumed the same way the settings/* surfaces
// do (relative import into client/src/ui/v2).

import type { GenerateCategory } from "@x-builder/shared";
import type { ReactElement } from "react";

import { Badge } from "../../../client/src/ui/v2/badge";
import { Button } from "../../../client/src/ui/v2/button";

export interface ComposeGenerateRailProps {
  categories: GenerateCategory[];
  pending?: string;
  onGenerate: (category: GenerateCategory) => void;
}

/** Cooldown badge text built only from fields present on GenerateCategory. */
function cooldownLabel(category: GenerateCategory): string {
  return `${category.cooldownStatus} · ${category.sampleCount}×`;
}

/** The LEFT-zone vertical rail of generate-category pills. */
export function ComposeGenerateRail({
  categories,
  pending,
  onGenerate,
}: ComposeGenerateRailProps): ReactElement | null {
  if (categories.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        overflowY: "auto",
        padding: "var(--space-2)",
        background: "var(--xb-surface-panel)",
        border: "var(--border-width-thin) solid var(--xb-border-edge)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {categories.map((category) => {
        const isPending = pending === category.id;
        const showCooldown = category.cooldownStatus !== "clear";
        return (
          <Button
            key={category.id}
            variant="ghost"
            loading={isPending}
            disabled={isPending}
            onClick={() => onGenerate(category)}
            trailingIcon={
              showCooldown ? (
                <Badge variant="warning">{cooldownLabel(category)}</Badge>
              ) : undefined
            }
          >
            <span
              title={category.label}
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {category.label}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
