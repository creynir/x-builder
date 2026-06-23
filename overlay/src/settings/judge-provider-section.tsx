// @x-builder/overlay — JudgeProviderSection
//
// Renders a v2 Select over the three JudgeProviderId values, seeded from the
// current `value` and labelled via the shared `judgeProviderLabels` single
// source of truth. On change it reports the chosen provider id upward; the
// read-current-then-send-FULL merge lives in SettingsAffordance.

import { judgeProviderIdSchema, judgeProviderLabels, type JudgeProviderId } from "@x-builder/shared";
import type { ReactElement } from "react";

import { Select } from "../../../client/src/ui/v2/select";

export interface JudgeProviderSectionProps {
  value: JudgeProviderId;
  onCommit(id: JudgeProviderId): void;
}

const PROVIDER_OPTIONS = judgeProviderIdSchema.options.map((id) => ({
  value: id,
  label: judgeProviderLabels[id],
}));

/** The judge-provider picker. */
export function JudgeProviderSection({
  value,
  onCommit,
}: JudgeProviderSectionProps): ReactElement {
  return (
    <Select
      value={value}
      aria-label="Judge provider"
      options={PROVIDER_OPTIONS}
      onChange={(next) => onCommit(next as JudgeProviderId)}
    />
  );
}
