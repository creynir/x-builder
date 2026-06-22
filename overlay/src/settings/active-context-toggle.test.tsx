// @x-builder/overlay — ActiveContextToggle unit tests (browser mode)
//
// The toggle is a thin Switch wrapper: it reflects `checked`, can be `disabled`,
// and emits the NEXT boolean on change. The optimistic-echo / rollback wiring
// lives in SettingsAffordance (covered there); here we pin the leaf contract.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { mountShadowHost, type ShadowHostHandle } from "../testing/shadow-host";
import { ActiveContextToggle } from "./active-context-toggle";

let harness: ShadowHostHandle;

function mountToggle(
  props: Parameters<typeof ActiveContextToggle>[0],
): HTMLElement {
  harness = mountShadowHost();
  render(<ActiveContextToggle {...props} />, { container: harness.mount });
  return harness.mount;
}

function toggle(root: HTMLElement): HTMLElement {
  const el = root.querySelector('[role="switch"]');
  if (!(el instanceof HTMLElement)) throw new Error("switch not found");
  return el;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("ActiveContextToggle", () => {
  it("renders a switch reflecting the checked prop and the label", () => {
    const root = mountToggle({ checked: true, onChange: vi.fn() });
    expect(toggle(root).getAttribute("aria-checked")).toBe("true");
    expect(root.textContent).toContain("Active context");
  });

  it("emits the inverted boolean on change", () => {
    const onChange = vi.fn();
    const root = mountToggle({ checked: false, onChange });

    toggle(root).click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not emit onChange when disabled", () => {
    const onChange = vi.fn();
    const root = mountToggle({ checked: false, disabled: true, onChange });

    toggle(root).click();

    expect(onChange).not.toHaveBeenCalled();
  });
});
