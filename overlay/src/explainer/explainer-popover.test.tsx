// @x-builder/overlay — Visual-AC (structural) tests for trigger + popover
//
// These assert the Aurora Glass token wiring required by the ticket's Visual AC.
// They run in the real shadow root with the design-token + neon sheets adopted,
// so a `var(--…)` reference resolves to its seeded value only if the primitive
// actually wired the token (rather than inlining a literal or omitting it).
//
// We assert two things per token family:
//   1. the token RESOLVES on the rendered node (proves the closure reaches it);
//   2. the node's relevant inline style REFERENCES the token (proves the
//      component opted into the token, not a hardcoded value).

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { MetricExplainer } from "./metric-explainer";
import { mountShadowHost, tokenValue, type ShadowHostHandle } from "../testing/shadow-host";

let harness: ShadowHostHandle;

function mount(ui: ReactNode): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

function trigger(root: HTMLElement): HTMLButtonElement {
  const el = root.querySelector("button");
  if (!(el instanceof HTMLButtonElement)) throw new Error("trigger not found");
  return el;
}

function popover(root: HTMLElement): HTMLElement {
  const el = root.querySelector('[role="dialog"]');
  if (!(el instanceof HTMLElement)) throw new Error("popover not found");
  return el;
}

/** The raw inline style attribute text (token references survive here verbatim). */
function inlineStyle(node: Element): string {
  return node.getAttribute("style") ?? "";
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("ExplainerTrigger — Visual AC tokens (quiet ghost)", () => {
  it("resolves the muted-text + xs-font tokens on the host", () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    const btn = trigger(root);

    // Tokens resolve through the rendered button (closure reaches it).
    expect(tokenValue(btn, "--xb-text-muted").length).toBeGreaterThan(0);
    expect(tokenValue(btn, "--font-size-xs")).toBe("12px");
  });

  it("references --xb-text-muted and --font-size-xs in its inline style (not literals)", () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    const style = inlineStyle(trigger(root));

    expect(style).toContain("var(--xb-text-muted)");
    expect(style).toContain("var(--font-size-xs)");
  });
});

describe("ExplainerPopover — Visual AC tokens (Aurora Glass surface)", () => {
  it("resolves all required surface tokens on the host", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    trigger(root).click();

    await vi.waitFor(() => {
      const dialog = popover(root);
      expect(tokenValue(dialog, "--xb-surface-overlay").length).toBeGreaterThan(0);
      expect(tokenValue(dialog, "--xb-border-edge").length).toBeGreaterThan(0);
      expect(tokenValue(dialog, "--xb-glow-sm").length).toBeGreaterThan(0);
      // From the design-token sheet (4px) and the composite caption font.
      expect(tokenValue(dialog, "--radius-md")).toBe("4px");
      expect(tokenValue(dialog, "--type-caption")).toContain("12px");
    });
  });

  it("references the surface / border / glow / radius / caption tokens in inline style", async () => {
    const root = mount(<MetricExplainer metricKey="overall" />);
    trigger(root).click();

    await vi.waitFor(() => {
      const style = inlineStyle(popover(root));
      expect(style).toContain("var(--xb-surface-overlay)");
      expect(style).toContain("var(--xb-border-edge)");
      expect(style).toContain("var(--xb-glow-sm)");
      expect(style).toContain("var(--radius-md)");
      expect(style).toContain("var(--type-caption)");
    });
  });
});
