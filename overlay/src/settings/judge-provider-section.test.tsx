// @x-builder/overlay — JudgeProviderSection tests (browser mode)
//
// The section renders a Select over the three JudgeProviderId values, seeded
// from AppSettings.judgeProvider and labelled via `judgeProviderLabels`. On
// change it reports the chosen provider id upward; the read-current-then-send-
// FULL merge (full real AppSettings) happens in SettingsAffordance (covered
// there). Here we pin the leaf: it surfaces the current id and the labels, and
// reports the chosen id.

import { judgeProviderLabels } from "@x-builder/shared";
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
  it("renders a Select seeded with the current judgeProvider id", () => {
    const root = mountSection({ value: "codex-cli", onCommit: vi.fn() });
    const select = root.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("codex-cli");
  });

  it("offers the three provider ids with their human labels", () => {
    const root = mountSection({ value: "codex-cli", onCommit: vi.fn() });
    const select = root.querySelector("select") as HTMLSelectElement;

    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(new Set(optionValues)).toEqual(
      new Set(["codex-cli", "claude-cli", "cursor-cli"]),
    );
    // Labels come from the shared single source of truth.
    expect(root.textContent).toContain(judgeProviderLabels["codex-cli"]);
    expect(root.textContent).toContain(judgeProviderLabels["claude-cli"]);
    expect(root.textContent).toContain(judgeProviderLabels["cursor-cli"]);
  });

  it("commits the chosen provider id on change", () => {
    const onCommit = vi.fn();
    const root = mountSection({ value: "codex-cli", onCommit });

    const select = root.querySelector("select") as HTMLSelectElement;
    select.value = "cursor-cli";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onCommit).toHaveBeenCalledWith("cursor-cli");
  });
});
