// @x-builder/overlay — ReadinessIndicator tests (browser mode)
//
// Maps OverlayReadiness SubsystemStatus.state (the real shared ReadinessState
// enum) → Badge variants, and surfaces a warning Alert when capture is paused /
// layout-changed OR when the selector miss count crosses its threshold. Judge
// readiness is surfaced here (via readiness.llm), NOT as a settings field.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { makeOverlayReadiness, subsystem } from "../testing/fixtures";
import { mountShadowHost, type ShadowHostHandle } from "../testing/shadow-host";
import { ReadinessIndicator } from "./readiness-indicator";

let harness: ShadowHostHandle;

function mountIndicator(
  props: Parameters<typeof ReadinessIndicator>[0],
): HTMLElement {
  harness = mountShadowHost();
  render(<ReadinessIndicator {...props} />, { container: harness.mount });
  return harness.mount;
}

/** The warning alert text the spec pins down verbatim. */
const LAYOUT_CHANGED_TEXT = "X layout changed — affordances paused";

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("ReadinessIndicator — capture warning alert", () => {
  it('renders a warning Alert when capture.state === "layout_changed"', () => {
    const root = mountIndicator({
      readiness: makeOverlayReadiness({
        capture: {
          state: "layout_changed",
          label: "Layout changed",
          checkedAt: "2026-06-21T00:00:00.000Z",
        },
      }),
      selectorMissCount: 0,
    });

    const alert = root.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(
      alert!.getAttribute("data-variant") ?? alert!.getAttribute("class") ?? "",
    ).toContain("warning");
    expect(root.textContent).toContain(LAYOUT_CHANGED_TEXT);
  });

  it("renders the same warning Alert when selectorMissCount >= 5", () => {
    const root = mountIndicator({
      readiness: makeOverlayReadiness(), // capture ok
      selectorMissCount: 5,
    });

    const alert = root.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(
      alert!.getAttribute("data-variant") ?? alert!.getAttribute("class") ?? "",
    ).toContain("warning");
    expect(root.textContent).toContain(LAYOUT_CHANGED_TEXT);
  });

  it("renders no warning Alert when capture is ok and miss count is below threshold", () => {
    const root = mountIndicator({
      readiness: makeOverlayReadiness(),
      selectorMissCount: 4,
    });

    const alert = root.querySelector('[role="alert"]');
    const marker =
      alert?.getAttribute("data-variant") ?? alert?.getAttribute("class") ?? "";
    expect(marker).not.toContain("warning");
  });
});

describe("ReadinessIndicator — Badge variant mapping (real ReadinessState)", () => {
  /** Collect the variant markers rendered on the readiness badges. */
  function badgeMarkers(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll("[data-variant]")).map(
      (el) => el.getAttribute("data-variant") ?? "",
    );
  }

  it('maps state "ready" → success', () => {
    const root = mountIndicator({
      readiness: makeOverlayReadiness({
        staticEngine: subsystem({ state: "ready", label: "Static engine ready" }),
      }),
      selectorMissCount: 0,
    });
    expect(badgeMarkers(root)).toContain("success");
  });

  it('maps state "partial" → warning', () => {
    const root = mountIndicator({
      readiness: makeOverlayReadiness({
        llm: subsystem({ state: "partial", label: "Judge partial" }),
      }),
      selectorMissCount: 0,
    });
    expect(badgeMarkers(root)).toContain("warning");
  });

  it('maps state "unavailable" → danger', () => {
    const root = mountIndicator({
      readiness: makeOverlayReadiness({
        llm: subsystem({ state: "unavailable", label: "Judge unavailable" }),
      }),
      selectorMissCount: 0,
    });
    expect(badgeMarkers(root)).toContain("danger");
  });

  it('maps state "failed" → danger', () => {
    const root = mountIndicator({
      readiness: makeOverlayReadiness({
        llm: subsystem({ state: "failed", label: "Judge failed" }),
      }),
      selectorMissCount: 0,
    });
    expect(badgeMarkers(root)).toContain("danger");
  });
});
