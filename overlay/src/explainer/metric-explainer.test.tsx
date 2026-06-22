// @x-builder/overlay — MetricExplainer behaviour tests (browser mode, real shadow DOM)
//
// MetricExplainer is the orchestrator: it always renders an ExplainerTrigger
// ("ⓘ") and, when expanded, an ExplainerPopover (role="dialog"). Copy resolves
// from `overlayExplainerCopy[metricKey]` unless a `source` override is passed.
// These tests run in the real Chromium harness inside a token-seeded shadow root
// so the open/close, focus-return, composedPath click-outside, and a11y wiring
// are exercised against real shadow-boundary semantics (the production context).
//
// No transport: explainer copy is static, so no FakeEngineTransport / provider.

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { overlayExplainerCopy } from "./copy";
import { MetricExplainer } from "./metric-explainer";
import type { ExplainerSource, MetricKey } from "./types";
import { mountShadowHost, type ShadowHostHandle } from "../testing/shadow-host";

let harness: ShadowHostHandle;

function mount(ui: ReactNode): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

/** The always-rendered "ⓘ" trigger button. */
function trigger(root: HTMLElement): HTMLButtonElement {
  const el = root.querySelector("button");
  if (!(el instanceof HTMLButtonElement)) throw new Error("trigger not found");
  return el;
}

/** The popover dialog, or null when closed. */
function popover(root: HTMLElement): HTMLElement | null {
  const el = root.querySelector('[role="dialog"]');
  return el instanceof HTMLElement ? el : null;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("MetricExplainer — closed default", () => {
  it("renders only the trigger with aria-expanded=false; no dialog", () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    const btn = trigger(root);

    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(popover(root)).toBeNull();
  });

  it("gives the trigger an accessible name referencing the metric label", () => {
    const root = mount(<MetricExplainer metricKey="negativeRisk" />);
    const label = overlayExplainerCopy.negativeRisk.label;
    // Per spec: aria-label="Explain [label]".
    expect(trigger(root).getAttribute("aria-label")).toContain(label);
  });
});

describe("MetricExplainer — open on click", () => {
  it("opens a role=dialog popover with aria-label '[label] — metric explainer'", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    trigger(root).click();

    await vi.waitFor(() => {
      const dialog = popover(root);
      expect(dialog).not.toBeNull();
      const label = overlayExplainerCopy.overall.label;
      expect(dialog!.getAttribute("aria-label")).toBe(`${label} — metric explainer`);
      expect(trigger(root).getAttribute("aria-expanded")).toBe("true");
    });
  });

  it("shows whatItMeans + howToRead, and two Badges when a scale is defined", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    trigger(root).click();

    const entry = overlayExplainerCopy.overall;
    await vi.waitFor(() => {
      const dialog = popover(root)!;
      expect(dialog.textContent).toContain(entry.whatItMeans);
      expect(dialog.textContent).toContain(entry.howToRead);
      if (entry.scale) {
        // The band scale renders the two poles as v2 Badge spans.
        const badges = dialog.querySelectorAll("[data-variant]");
        expect(badges.length).toBeGreaterThanOrEqual(2);
        expect(dialog.textContent).toContain(entry.scale.lowLabel);
        expect(dialog.textContent).toContain(entry.scale.highLabel);
      }
    });
  });
});

describe("MetricExplainer — close paths", () => {
  it("closes on Esc and returns focus to the trigger", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    const btn = trigger(root);

    btn.click();
    await vi.waitFor(() => expect(popover(root)).not.toBeNull());

    btn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );

    await vi.waitFor(() => {
      expect(popover(root)).toBeNull();
      expect(trigger(root).getAttribute("aria-expanded")).toBe("false");
      expect(harness.shadow.activeElement).toBe(trigger(root));
    });
  });

  it("closes on click-outside detected via composedPath across the shadow boundary", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    const btn = trigger(root);

    btn.click();
    await vi.waitFor(() => expect(popover(root)).not.toBeNull());

    // A pointerdown originating outside the shadow host entirely: its
    // composedPath()[0] is a light-DOM node, so the handler must close.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, composed: true }),
    );

    await vi.waitFor(() => {
      expect(popover(root)).toBeNull();
    });
    outside.remove();
  });

  it("stays open when the pointerdown is inside the popover", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    trigger(root).click();
    await vi.waitFor(() => expect(popover(root)).not.toBeNull());

    const dialog = popover(root)!;
    dialog.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, composed: true }),
    );

    // No close: an interaction inside the dialog must not dismiss it.
    expect(popover(root)).not.toBeNull();
  });
});

describe("MetricExplainer — source override (L1)", () => {
  it("renders the overridden voiceMatch copy, not the static default", async () => {
    const overriddenWhatItMeans = "OVERRIDE: how human, not AI-slop, the voice reads";
    const overriddenHowToRead = "OVERRIDE-READ: higher means more authentically you";
    const source: ExplainerSource = {
      ...overlayExplainerCopy,
      voiceMatch: {
        ...overlayExplainerCopy.voiceMatch,
        label: "Voice match (custom)",
        whatItMeans: overriddenWhatItMeans,
        howToRead: overriddenHowToRead,
      },
    };

    const root = mount(<MetricExplainer metricKey="voiceMatch" source={source} />);
    trigger(root).click();

    await vi.waitFor(() => {
      const dialog = popover(root)!;
      expect(dialog.getAttribute("aria-label")).toBe(
        "Voice match (custom) — metric explainer",
      );
      expect(dialog.textContent).toContain(overriddenWhatItMeans);
      expect(dialog.textContent).toContain(overriddenHowToRead);
      // The static default copy must NOT leak through.
      expect(dialog.textContent).not.toContain(
        overlayExplainerCopy.voiceMatch.whatItMeans,
      );
    });
  });
});

describe("MetricExplainer — audienceMatch null value", () => {
  it("renders without crashing and notes insufficient data when value is null", async () => {
    const root = mount(<MetricExplainer metricKey="audienceMatch" value={null} />);
    trigger(root).click();

    await vi.waitFor(() => {
      const dialog = popover(root)!;
      expect(dialog).not.toBeNull();
      // The null note must surface; no scale crash.
      expect(dialog.textContent?.toLowerCase()).toContain("insufficient data");
    });
  });

  it("renders without crashing when value prop is absent entirely", async () => {
    const root = mount(<MetricExplainer metricKey="audienceMatch" />);
    trigger(root).click();

    await vi.waitFor(() => {
      expect(popover(root)).not.toBeNull();
      expect(popover(root)!.textContent ?? "").not.toBe("");
    });
  });
});

describe("MetricExplainer — unknown key fallback", () => {
  it('renders "No description available" for a key absent from the copy map; no crash', async () => {
    // Cast an unknown key to MetricKey to drive the runtime fallback path that
    // exists because the copy map and the union could drift via a downstream bug.
    const root = mount(<MetricExplainer metricKey={"madeUpKey" as MetricKey} />);
    const btn = trigger(root);

    expect(btn).not.toBeNull();
    btn.click();

    await vi.waitFor(() => {
      const dialog = popover(root)!;
      expect(dialog).not.toBeNull();
      expect(dialog.textContent?.toLowerCase()).toContain("no description available");
    });
  });
});

describe("MetricExplainer — a11y wiring", () => {
  it("is non-modal (aria-modal=false) so Shift-Tab can reach x.com", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    trigger(root).click();

    await vi.waitFor(() => {
      expect(popover(root)!.getAttribute("aria-modal")).toBe("false");
    });
  });

  it("wires trigger aria-controls to the popover id when open", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    trigger(root).click();

    await vi.waitFor(() => {
      const dialog = popover(root)!;
      const controls = trigger(root).getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      expect(dialog.id).toBe(controls);
    });
  });
});
