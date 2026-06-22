// @x-builder/overlay — JudgeProviderSection tests (browser mode)
//
// The section renders an Input seeded from AppSettings.judgeProvider and, on
// blur/submit, asks its parent to persist the changed provider. The
// read-current-then-send-FULL merge happens in SettingsAffordance (covered
// there); here we pin that the leaf surfaces the current value through an Input
// and reports the edited value upward.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { mountShadowHost, type ShadowHostHandle } from "../testing/shadow-host";
import { JudgeProviderSection } from "./judge-provider-section";

let harness: ShadowHostHandle;

function mountSection(
  props: Parameters<typeof JudgeProviderSection>[0],
): HTMLElement {
  harness = mountShadowHost();
  render(<JudgeProviderSection {...props} />, { container: harness.mount });
  return harness.mount;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("JudgeProviderSection", () => {
  it("renders an Input seeded with the current judgeProvider value", () => {
    const root = mountSection({ value: "openai", onCommit: vi.fn() });
    const input = root.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("openai");
  });

  it("commits the edited provider string on blur", () => {
    const onCommit = vi.fn();
    const root = mountSection({ value: "openai", onCommit });

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "anthropic";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(onCommit).toHaveBeenCalledWith("anthropic");
  });
});
