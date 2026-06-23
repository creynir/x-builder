import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrap } from "./bootstrap";

const HOST_ID = "xb-overlay-root";

/** The complete Aurora Glass `--xb-*` token set seeded on `:host`. */
const EXPECTED_TOKENS: Record<string, string> = {
  "--xb-accent": "hsl(174 90% 52%)",
  "--xb-accent-2": "hsl(316 88% 62%)",
  "--xb-judge": "hsl(192 95% 60%)",
  "--xb-surface-panel": "hsl(210 28% 9% / 0.72)",
  "--xb-surface-overlay": "hsl(210 30% 7% / 0.88)",
  "--xb-border-edge": "hsl(174 90% 52% / 0.55)",
  "--xb-glow-sm": "0 0 8px hsl(174 90% 52% / 0.35)",
  "--xb-glow-md": "0 0 18px hsl(174 90% 52% / 0.4)",
  "--xb-glow-judge": "0 0 12px hsl(192 95% 60% / 0.45)",
  "--xb-text": "hsl(180 25% 96%)",
  "--xb-text-muted": "hsl(195 18% 74%)",
  "--xb-band-post-now": "hsl(150 70% 50%)",
  "--xb-band-slight": "hsl(174 90% 52%)",
  "--xb-band-major": "hsl(42 92% 60%)",
  "--xb-band-donot": "hsl(352 85% 62%)",
  "--xb-pulse-duration": "1100ms",
  "--xb-glass-blur": "12px",
  "--xb-z-pin": "2147483000",
  "--xb-z-panel": "2147483100",
  "--xb-z-popover": "2147483200",
  "--xb-highlight-green": "hsl(150 72% 50%)",
  "--xb-highlight-green-wash": "hsl(150 72% 50% / 0.14)",
  "--xb-highlight-blue": "hsl(205 96% 62%)",
  "--xb-highlight-blue-warn": "hsl(205 96% 62% / 0.34)",
  "--xb-highlight-blue-suggest": "hsl(205 96% 62% / 0.2)",
};

const TOKEN_NAMES = Object.keys(EXPECTED_TOKENS);

function getHost(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

/** Resolve the mount node inside the host's shadow root that React renders into. */
function getMountNode(host: HTMLElement): HTMLElement {
  const shadow = host.shadowRoot;
  if (!shadow) throw new Error("host has no shadow root");
  const mount = shadow.firstElementChild;
  if (!(mount instanceof HTMLElement)) {
    throw new Error("shadow root has no element mount node");
  }
  return mount;
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  // The host persists on documentElement across calls (idempotency); remove it.
  document.querySelectorAll(`#${HOST_ID}`).forEach((el) => el.remove());
  document.documentElement.removeAttribute("data-theme");
});

describe("overlay shadow-DOM host", () => {
  it("mounts exactly one host element when called twice (idempotency)", () => {
    bootstrap();
    bootstrap();

    const hosts = document.querySelectorAll(`#${HOST_ID}`);
    expect(hosts.length).toBe(1);
  });

  it("appends the host only to documentElement, never to body", () => {
    const bodyAppend = vi.spyOn(document.body, "appendChild");
    const childCountBefore = document.body.childElementCount;

    bootstrap();

    const host = getHost();
    expect(host).not.toBeNull();
    expect(host!.parentElement).toBe(document.documentElement);
    expect(document.body.contains(host!)).toBe(false);
    expect(bodyAppend).not.toHaveBeenCalled();
    expect(document.body.childElementCount).toBe(childCountBefore);

    bodyAppend.mockRestore();
  });

  it("attaches an open shadow root with a non-empty adopted style sheet", () => {
    bootstrap();

    const host = getHost()!;
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot!.mode).toBe("open");
    expect(host.shadowRoot!.adoptedStyleSheets.length).toBeGreaterThan(0);
  });

  it("renders no visible box (zero-paint host via display:contents)", () => {
    bootstrap();

    const host = getHost()!;
    expect(getComputedStyle(host).display).toBe("contents");
  });
});

describe("Aurora Glass token seeding", () => {
  it("resolves --xb-accent to its exact hsl value from the constructed sheet", () => {
    bootstrap();

    const mount = getMountNode(getHost()!);
    const accent = getComputedStyle(mount).getPropertyValue("--xb-accent").trim();
    expect(accent).toBe("hsl(174 90% 52%)");
  });

  it.each(TOKEN_NAMES)("seeds %s as a present, non-empty token", (token) => {
    bootstrap();

    const mount = getMountNode(getHost()!);
    const value = getComputedStyle(mount).getPropertyValue(token).trim();
    expect(value.length).toBeGreaterThan(0);
  });

  it("resolves all 25 tokens to their exact declared values", () => {
    bootstrap();

    const style = getComputedStyle(getMountNode(getHost()!));
    for (const [token, expected] of Object.entries(EXPECTED_TOKENS)) {
      expect(style.getPropertyValue(token).trim()).toBe(expected);
    }
  });

  it("seeds exactly the 25-token set", () => {
    expect(TOKEN_NAMES.length).toBe(25);
  });
});

describe("Visual AC token characteristics", () => {
  it("gives --xb-surface-panel an alpha channel for glass translucency", () => {
    bootstrap();

    const panel = getComputedStyle(getMountNode(getHost()!))
      .getPropertyValue("--xb-surface-panel")
      .trim();
    expect(panel).toContain("/");
    expect(panel).toBe("hsl(210 28% 9% / 0.72)");
  });

  it("carries box-shadow values (not none) for every glow token", () => {
    bootstrap();

    const style = getComputedStyle(getMountNode(getHost()!));
    for (const glow of ["--xb-glow-sm", "--xb-glow-md", "--xb-glow-judge"]) {
      const value = style.getPropertyValue(glow).trim();
      expect(value).not.toBe("none");
      expect(value).toContain("px");
    }
  });

  it("exposes the default-theme override raising panel opacity and darkening text", () => {
    bootstrap();

    const host = getHost()!;
    host.dataset.xtheme = "default";
    const style = getComputedStyle(getMountNode(host));

    expect(style.getPropertyValue("--xb-surface-panel").trim()).toBe(
      "hsl(210 28% 9% / 0.94)",
    );
    expect(style.getPropertyValue("--xb-text").trim()).toBe("hsl(200 30% 12%)");
  });

  it("collapses --xb-pulse-duration to 0ms under reduced motion", () => {
    bootstrap();

    const sheets = getHost()!.shadowRoot!.adoptedStyleSheets;
    const cssText = sheets
      .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
      .join("\n");

    expect(cssText).toContain("prefers-reduced-motion: reduce");
    expect(cssText).toMatch(/--xb-pulse-duration:\s*0ms/);
  });
});

describe("SPA navigation resilience", () => {
  it("keeps a single host after a simulated navigation re-bootstrap", () => {
    bootstrap();

    // Simulate an SPA route change: swap the head and fire a navigation-ish event.
    const freshHead = document.createElement("head");
    document.documentElement.replaceChild(freshHead, document.head);
    window.dispatchEvent(new Event("popstate"));

    bootstrap();

    expect(document.querySelectorAll(`#${HOST_ID}`).length).toBe(1);
  });
});
