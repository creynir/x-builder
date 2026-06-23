import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootstrap } from "./bootstrap";

// Folded-in scope: bootstrap() must adopt a design-system token sheet alongside
// the Aurora Glass neon sheet so the product-tokens.css closure (the space,
// type, radius, and score token families plus the base primitives they
// reference) resolves on the shadow :host. The neon (--xb-) sheet must not be
// clobbered. We read computed styles off the React mount node, which inherits
// the custom properties declared on :host.

const HOST_ID = "xb-overlay-root";

function getHost(): HTMLElement {
  const host = document.getElementById(HOST_ID);
  if (!(host instanceof HTMLElement)) throw new Error("host not mounted");
  return host;
}

function getMountNode(host: HTMLElement): HTMLElement {
  const shadow = host.shadowRoot;
  if (!shadow) throw new Error("host has no shadow root");
  const mount = shadow.firstElementChild;
  if (!(mount instanceof HTMLElement)) {
    throw new Error("shadow root has no element mount node");
  }
  return mount;
}

function tokenValue(token: string): string {
  return getComputedStyle(getMountNode(getHost()))
    .getPropertyValue(token)
    .trim();
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  document.querySelectorAll(`#${HOST_ID}`).forEach((el) => el.remove());
  document.documentElement.removeAttribute("data-theme");
});

describe("design-system token seeding on :host", () => {
  it("resolves --space-2 to 8px", () => {
    bootstrap();
    expect(tokenValue("--space-2")).toBe("8px");
  });

  it("resolves --radius-md to 4px", () => {
    bootstrap();
    expect(tokenValue("--radius-md")).toBe("4px");
  });

  it("resolves --type-caption to a non-empty composite font shorthand", () => {
    bootstrap();
    const caption = tokenValue("--type-caption");
    expect(caption.length).toBeGreaterThan(0);
    // The closure pulls in --font-size-xs (12px) via the shorthand.
    expect(caption).toContain("12px");
  });

  it("resolves --score-strong to a non-empty color (proves --success-9 base layer is seeded)", () => {
    bootstrap();
    const score = tokenValue("--score-strong");
    expect(score.length).toBeGreaterThan(0);
    // --score-strong: var(--success-9) → hsl(150 58% 47%)
    expect(score).toContain("hsl");
  });

  it("still resolves the neon --xb-accent token (neon sheet not clobbered)", () => {
    bootstrap();
    expect(tokenValue("--xb-accent")).toBe("hsl(174 90% 52%)");
  });
});
