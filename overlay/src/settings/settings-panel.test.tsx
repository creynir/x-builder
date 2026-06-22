// @x-builder/overlay — SettingsPanel tests (browser mode)
//
// Covers the CaptureSummary→KeyValueList rendering and the Visual-AC structural
// contract: the panel surface is built from the Aurora Glass tokens
// (--xb-surface-panel / --xb-glass-blur / --xb-border-edge / --radius-lg) and
// the readiness Badge variant mapping (ready→success, warming→warning,
// degraded/unavailable→danger). Rendered into a real token-seeded shadow root so
// the var() references actually resolve.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import {
  makeAppSettings,
  makeCaptureSummary,
  makeOverlayReadiness,
} from "../testing/fixtures";
import { mountShadowHost, tokenValue, type ShadowHostHandle } from "../testing/shadow-host";
import { SettingsPanel } from "./settings-panel";

let harness: ShadowHostHandle;

function mountPanel(
  overrides: Partial<Parameters<typeof SettingsPanel>[0]> = {},
  xtheme?: string,
): HTMLElement {
  harness = mountShadowHost(xtheme ? { xtheme } : {});
  render(
    <SettingsPanel
      open
      onClose={vi.fn()}
      settings={makeAppSettings()}
      readiness={makeOverlayReadiness()}
      capture={makeCaptureSummary()}
      onUpdateSettings={vi.fn()}
      onUploadArchive={vi.fn()}
      {...overrides}
    />,
    { container: harness.mount },
  );
  return harness.mount;
}

function panel(root: HTMLElement): HTMLElement {
  const el = root.querySelector('[role="dialog"]');
  if (!(el instanceof HTMLElement)) throw new Error("dialog not found");
  return el;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("SettingsPanel — dialog semantics", () => {
  it("renders role=dialog, aria-modal, and an accessible label", () => {
    const dialog = panel(mountPanel());
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("X Builder settings");
  });
});

describe("SettingsPanel — CaptureSummary in KeyValueList", () => {
  it("renders postsCaptured and lastCaptureAt values", () => {
    const root = mountPanel({
      capture: makeCaptureSummary({ postsCaptured: 42, lastCaptureAt: "2026-06-21" }),
    });
    expect(root.textContent).toContain("42");
    expect(root.textContent).toContain("2026-06-21");
  });
});

describe("SettingsPanel — Visual AC token structure", () => {
  it("resolves the Aurora Glass panel surface tokens on the dialog", () => {
    const dialog = panel(mountPanel());

    // The panel's var() references must resolve against the seeded :host tokens.
    expect(tokenValue(dialog, "--xb-surface-panel")).toBe("hsl(210 28% 9% / 0.72)");
    expect(tokenValue(dialog, "--xb-glass-blur")).toBe("12px");
    expect(tokenValue(dialog, "--xb-border-edge")).toBe("hsl(174 90% 52% / 0.55)");

    // The panel's resolved styles consume those tokens (not a bare/blank box).
    const style = getComputedStyle(dialog);
    expect(style.borderRadius).not.toBe("");
    expect(style.borderRadius).not.toBe("0px");
  });

  it("applies the white (default) theme override to the panel surface", () => {
    const dialog = panel(mountPanel({}, "default"));
    // The default-theme block raises panel opacity + darkens text.
    expect(tokenValue(dialog, "--xb-surface-panel")).toBe("hsl(210 28% 9% / 0.94)");
    expect(tokenValue(dialog, "--xb-text")).toBe("hsl(200 30% 12%)");
  });
});

describe("SettingsPanel — readiness Badge variant mapping (Visual AC)", () => {
  function markers(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll("[data-variant]")).map(
      (el) => el.getAttribute("data-variant") ?? "",
    );
  }

  it("maps ready → success", () => {
    const root = mountPanel({ readiness: makeOverlayReadiness() });
    expect(markers(root)).toContain("success");
  });

  it("maps warming → warning and degraded/unavailable → danger", () => {
    const root = mountPanel({
      readiness: makeOverlayReadiness({
        staticEngine: {
          state: "warming",
          label: "Static engine warming",
          retryable: false,
          checkedAt: "2026-06-21T00:00:00.000Z",
        },
        llm: {
          state: "unavailable",
          label: "Judge unavailable",
          retryable: true,
          checkedAt: "2026-06-21T00:00:00.000Z",
        },
      }),
    });
    const m = markers(root);
    expect(m).toContain("warning");
    expect(m).toContain("danger");
  });
});
