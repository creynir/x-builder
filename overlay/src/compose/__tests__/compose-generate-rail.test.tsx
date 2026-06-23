// @x-builder/overlay — ComposeGenerateRail tests (browser mode → Playwright Chromium)
//
// RED: `../compose-generate-rail` does not exist yet, so importing
// `ComposeGenerateRail` is what drives the failing state. These tests pin the
// component contract from the ticket — one ghost `Button` per category, a
// `warning` `Badge` when `cooldownStatus !== "clear"`, the pending button in its
// loading+disabled state (siblings unaffected), the FULL category object passed
// to `onGenerate`, cold-start/corpus visual parity, and the edge cases (empty /
// single / unknown-pending / rapid double-click).
//
// Harness: the established overlay shadow-host harness (`mountShadowHost`) with
// the design-token + neon sheets adopted, rendered via `vitest-browser-react`
// into the real shadow tree — same pattern as `ui-v2.test.tsx` and the settings
// suites. Queries are shadow-aware (off the returned mount node). We assert what
// is stable in browser mode (variant markers, aria-busy, disabled, structure),
// not brittle pixel values.

import type { GenerateCategory } from "@x-builder/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import {
  cooldownCategory,
  defaultCategories,
} from "../../testing/generate-categories";
import { mountShadowHost, type ShadowHostHandle } from "../../testing/shadow-host";

// Not-yet-existing module — importing it is what drives the RED state.
import { ComposeGenerateRail } from "../compose-generate-rail";

let harness: ShadowHostHandle;

function mount(ui: Parameters<typeof render>[0]): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

// --------------------------------------------------------------------------
// Shadow-aware query helpers.
// --------------------------------------------------------------------------

/** Every native button rendered in the rail. */
function buttons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
}

/** The single button whose accessible text contains the given label. */
function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const match = buttons(root).find((b) => (b.textContent ?? "").includes(label));
  if (!match) throw new Error(`no button found containing label "${label}"`);
  return match;
}

/** Every warning-variant badge rendered anywhere in the rail. */
function warningBadges(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-variant="warning"]'));
}

// --------------------------------------------------------------------------
// 1. Render — 4 default categories → 4 buttons, exact labels, no badges.
// --------------------------------------------------------------------------

describe("ComposeGenerateRail — render", () => {
  it("renders exactly one button per category with the verbatim label and no cooldown badges", () => {
    const root = mount(
      <ComposeGenerateRail categories={defaultCategories} onGenerate={vi.fn()} />,
    );

    const btns = buttons(root);
    expect(btns).toHaveLength(defaultCategories.length);

    // Labels appear verbatim — one button per category label, in order.
    for (const category of defaultCategories) {
      expect(buttonByLabel(root, category.label)).toBeDefined();
    }

    // All `clear` → no warning badge anywhere.
    expect(warningBadges(root)).toHaveLength(0);
  });

  it("renders the buttons as the ghost variant (no X primary CTA hue)", () => {
    const root = mount(
      <ComposeGenerateRail categories={defaultCategories} onGenerate={vi.fn()} />,
    );

    // The v2 ghost Button has a transparent background and never the X primary
    // CTA fill (#1d9bf0 / rgb(29,155,240)). Assert the stable ghost marker:
    // a transparent / non-primary computed background on each button.
    for (const btn of buttons(root)) {
      const bg = getComputedStyle(btn).backgroundColor;
      expect(bg).not.toBe("rgb(29, 155, 240)");
      // Ghost background is transparent → 0 alpha (rgba(...,0)) or the keyword.
      expect(/rgba?\(0, 0, 0, 0\)|transparent/.test(bg)).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// 2. Cooldown annotation — warning Badge adjacent to the button; still clickable.
// --------------------------------------------------------------------------

describe("ComposeGenerateRail — cooldown annotation", () => {
  it("appends a warning Badge for a cooldown category and keeps that button clickable", () => {
    const onGenerate = vi.fn();
    const root = mount(
      <ComposeGenerateRail categories={[cooldownCategory]} onGenerate={onGenerate} />,
    );

    // Exactly one warning badge, for the single cooldown category.
    const badges = warningBadges(root);
    expect(badges).toHaveLength(1);

    // The badge text is built ONLY from fields on GenerateCategory: cooldownStatus
    // + sampleCount. It must surface both signals and NOT a windowDays/message field.
    const badgeText = badges[0]!.textContent ?? "";
    expect(badgeText).toContain(cooldownCategory.cooldownStatus); // "cooldown"
    expect(badgeText).toContain(String(cooldownCategory.sampleCount)); // "4"

    // The button is NOT disabled — the user can override the cooldown.
    const btn = buttonByLabel(root, cooldownCategory.label);
    expect(btn.disabled).toBe(false);

    btn.click();
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(cooldownCategory);
  });

  it("shows no warning badge when every category is clear", () => {
    const root = mount(
      <ComposeGenerateRail categories={defaultCategories} onGenerate={vi.fn()} />,
    );
    expect(warningBadges(root)).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 3. Pending spinner — the pending button is aria-busy + disabled; siblings free.
// --------------------------------------------------------------------------

describe("ComposeGenerateRail — pending state", () => {
  it("marks only the pending button aria-busy + disabled; siblings stay enabled", () => {
    const pendingCategory = defaultCategories[0]!;
    const root = mount(
      <ComposeGenerateRail
        categories={defaultCategories}
        pending={pendingCategory.id}
        onGenerate={vi.fn()}
      />,
    );

    const pendingBtn = buttonByLabel(root, pendingCategory.label);
    expect(pendingBtn.getAttribute("aria-busy")).toBe("true");
    expect(pendingBtn.disabled).toBe(true);

    // Every OTHER button is neither busy nor disabled.
    for (const category of defaultCategories.slice(1)) {
      const sibling = buttonByLabel(root, category.label);
      expect(sibling.getAttribute("aria-busy")).not.toBe("true");
      expect(sibling.disabled).toBe(false);
    }
  });

  it("keeps the pending button's label visible (loading does not replace it)", () => {
    const pendingCategory = defaultCategories[0]!;
    const root = mount(
      <ComposeGenerateRail
        categories={defaultCategories}
        pending={pendingCategory.id}
        onGenerate={vi.fn()}
      />,
    );

    const pendingBtn = buttonByLabel(root, pendingCategory.label);
    expect(pendingBtn.textContent).toContain(pendingCategory.label);
  });
});

// --------------------------------------------------------------------------
// 4. Click payload — onGenerate receives the FULL category object, once.
// --------------------------------------------------------------------------

describe("ComposeGenerateRail — click payload", () => {
  it("calls onGenerate once with the full GenerateCategory object (not just its format)", () => {
    const onGenerate = vi.fn<(category: GenerateCategory) => void>();
    const target = defaultCategories[1]!; // "Build-in-public" / founder_story
    const root = mount(
      <ComposeGenerateRail categories={defaultCategories} onGenerate={onGenerate} />,
    );

    buttonByLabel(root, target.label).click();

    expect(onGenerate).toHaveBeenCalledTimes(1);

    const arg = onGenerate.mock.calls[0]![0];
    // The argument is the WHOLE object, not the bare format string.
    expect(typeof arg).toBe("object");
    expect(arg).toEqual(target);
    expect(arg.id).toBe(target.id);
    expect(arg.format).toBe(target.format);
    // Guard against onGenerate(category.format): the arg is not the format string.
    expect(arg).not.toBe(target.format);
  });
});

// --------------------------------------------------------------------------
// 5. Cold-start parity — basis "default" renders identically to "top_performer".
// --------------------------------------------------------------------------

describe("ComposeGenerateRail — cold-start parity", () => {
  it("renders a basis:'default' button with no extra distinction vs basis:'top_performer'", () => {
    const coldStart: GenerateCategory = {
      id: "cold",
      label: "Cold",
      format: "hot_take",
      basis: "default",
      cooldownStatus: "clear",
      sampleCount: 0,
    };
    const corpusBacked: GenerateCategory = {
      id: "warm",
      label: "Warm",
      format: "hot_take",
      basis: "top_performer",
      cooldownStatus: "clear",
      sampleCount: 12,
    };

    const root = mount(
      <ComposeGenerateRail
        categories={[coldStart, corpusBacked]}
        onGenerate={vi.fn()}
      />,
    );

    const coldBtn = buttonByLabel(root, coldStart.label);
    const warmBtn = buttonByLabel(root, corpusBacked.label);

    // No basis-driven badge / marker distinguishes the two: neither carries a
    // warning badge (both clear) and the basis value must not leak into the DOM.
    expect(warningBadges(root)).toHaveLength(0);
    expect(coldBtn.outerHTML).not.toContain("default");
    expect(coldBtn.outerHTML).not.toContain("top_performer");
    expect(warmBtn.outerHTML).not.toContain("top_performer");

    // Same structural shape: both are ghost buttons with the same class surface
    // and the same key computed styles (no basis-driven visual divergence).
    expect(coldBtn.className).toBe(warmBtn.className);
    const cold = getComputedStyle(coldBtn);
    const warm = getComputedStyle(warmBtn);
    expect(cold.backgroundColor).toBe(warm.backgroundColor);
    expect(cold.borderTopColor).toBe(warm.borderTopColor);
    expect(cold.opacity).toBe(warm.opacity);
  });
});

// --------------------------------------------------------------------------
// 6. Edge cases — empty / single / unknown-pending / rapid double-click.
// --------------------------------------------------------------------------

describe("ComposeGenerateRail — edge cases", () => {
  it("renders nothing for an empty categories array (no button, no throw)", () => {
    let root!: HTMLElement;
    expect(() => {
      root = mount(<ComposeGenerateRail categories={[]} onGenerate={vi.fn()} />);
    }).not.toThrow();

    expect(buttons(root)).toHaveLength(0);
    expect(warningBadges(root)).toHaveLength(0);
  });

  it("renders a single pill for a single category", () => {
    const single = defaultCategories[0]!;
    const root = mount(
      <ComposeGenerateRail categories={[single]} onGenerate={vi.fn()} />,
    );

    const btns = buttons(root);
    expect(btns).toHaveLength(1);
    expect(btns[0]!.textContent).toContain(single.label);
  });

  it("shows no spinner when `pending` references an id not in categories", () => {
    const root = mount(
      <ComposeGenerateRail
        categories={defaultCategories}
        pending="not_a_real_id"
        onGenerate={vi.fn()}
      />,
    );

    for (const btn of buttons(root)) {
      expect(btn.getAttribute("aria-busy")).not.toBe("true");
      expect(btn.disabled).toBe(false);
    }
  });

  it("blocks a rapid second click while that button is pending (no double-generation)", () => {
    const onGenerate = vi.fn();
    const pendingCategory = defaultCategories[0]!;
    const root = mount(
      <ComposeGenerateRail
        categories={defaultCategories}
        pending={pendingCategory.id}
        onGenerate={onGenerate}
      />,
    );

    const pendingBtn = buttonByLabel(root, pendingCategory.label);
    expect(pendingBtn.disabled).toBe(true);

    // A native disabled button suppresses click; two rapid clicks fire nothing.
    pendingBtn.click();
    pendingBtn.click();
    expect(onGenerate).not.toHaveBeenCalled();
  });
});
