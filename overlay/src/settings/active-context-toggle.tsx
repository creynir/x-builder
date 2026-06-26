// @x-builder/overlay — ActiveContextToggle
//
// A thin wrapper over the v2 Switch, labelled "Active context". It reflects the
// `checked` prop, can be `disabled`, and emits the NEXT boolean on change. The
// optimistic-echo / activate-deactivate transport wiring lives in
// SettingsAffordance; this leaf only renders the control.

import type { ReactElement } from "react";

import { Switch } from "../ui/v2/switch";

export interface ActiveContextToggleProps {
  checked: boolean;
  disabled?: boolean;
  onChange(next: boolean): void;
}

/** The active-archive-context on/off switch. */
export function ActiveContextToggle({
  checked,
  disabled,
  onChange,
}: ActiveContextToggleProps): ReactElement {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      label="Active context"
      onChange={onChange}
    />
  );
}
