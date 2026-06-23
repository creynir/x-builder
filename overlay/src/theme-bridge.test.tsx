import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { OverlayThemeBridge } from "./theme-bridge";

/** Let a MutationObserver microtask + a frame elapse so the bridge reacts. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function makeHost(): HTMLElement {
  const host = document.createElement("xb-overlay-root");
  host.id = "xb-overlay-root";
  document.documentElement.appendChild(host);
  return host;
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("#xb-overlay-root").forEach((el) => el.remove());
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
});

describe("OverlayThemeBridge — data-theme attribute", () => {
  it("reflects the active dim theme onto the host after mount", async () => {
    document.documentElement.setAttribute("data-theme", "dim");
    const host = makeHost();

    render(<OverlayThemeBridge hostEl={host} />);
    await tick();

    expect(host.dataset.xtheme).toBe("dim");
  });

  it("tracks a live theme change to lights-out without remounting", async () => {
    document.documentElement.setAttribute("data-theme", "dim");
    const host = makeHost();

    render(<OverlayThemeBridge hostEl={host} />);
    await tick();
    expect(host.dataset.xtheme).toBe("dim");

    // The same host element instance must be updated in place (no remount).
    document.documentElement.setAttribute("data-theme", "lights-out");
    await tick();

    expect(host.dataset.xtheme).toBe("lights-out");
    expect(document.getElementById("xb-overlay-root")).toBe(host);
  });
});

describe("OverlayThemeBridge — background-color heuristic fallback", () => {
  it("maps the dim background color to the dim theme", async () => {
    document.body.style.backgroundColor = "rgb(21, 32, 43)";
    const host = makeHost();

    render(<OverlayThemeBridge hostEl={host} />);
    await tick();

    expect(host.dataset.xtheme).toBe("dim");
  });

  it("maps a pure-black background to lights-out", async () => {
    document.body.style.backgroundColor = "rgb(0, 0, 0)";
    const host = makeHost();

    render(<OverlayThemeBridge hostEl={host} />);
    await tick();

    expect(host.dataset.xtheme).toBe("lights-out");
  });

  it("falls back to the default theme for any other background", async () => {
    document.body.style.backgroundColor = "rgb(255, 255, 255)";
    const host = makeHost();

    render(<OverlayThemeBridge hostEl={host} />);
    await tick();

    expect(host.dataset.xtheme).toBe("default");
  });
});
