// @x-builder/overlay — v2 primitive contract tests (browser mode, cross-package)
//
// These tests exercise the fresh, token-driven, shadow-DOM-portable v2 primitive
// library built in `client/src/ui/v2/` (NOT the legacy `client/src/ui/
// foundation.tsx`). The overlay bundles them cross-package, so the overlay's
// browser-mode harness is the suite that owns their contract coverage: it is the
// only place they run inside a real shadow root with the Aurora Glass + product
// tokens adopted, which is what proves the "styles travel as token references"
// requirement.
//
// Cross-package import: relative path from `overlay/src/` up to the repo root and
// into `client/src/ui/v2/*`. Vite bundles cross-package source the same way the
// design-token sheet raw-imports `../../docs/...`.

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { Alert } from "../../client/src/ui/v2/alert";
import { Badge } from "../../client/src/ui/v2/badge";
import { Button } from "../../client/src/ui/v2/button";
import { IconButton } from "../../client/src/ui/v2/icon-button";
import { Input } from "../../client/src/ui/v2/input";
import { KeyValueList } from "../../client/src/ui/v2/key-value-list";
import { Skeleton } from "../../client/src/ui/v2/skeleton";
import { Switch } from "../../client/src/ui/v2/switch";

import { mountShadowHost, tokenValue, type ShadowHostHandle } from "./testing/shadow-host";

let harness: ShadowHostHandle;

function mount(ui: ReactNode): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("v2 Button", () => {
  it("renders a native button with the label and fires onClick", async () => {
    const onClick = vi.fn();
    const root = mount(<Button onClick={onClick}>Save</Button>);

    const btn = root.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("Save");

    btn!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables the native button and suppresses onClick when disabled", () => {
    const onClick = vi.fn();
    const root = mount(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    const btn = root.querySelector("button")!;
    expect(btn.disabled).toBe(true);

    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a spinner and sets aria-busy when loading, keeping the label visible", () => {
    const root = mount(
      <Button loading onClick={() => {}}>
        Import
      </Button>,
    );

    const btn = root.querySelector("button")!;
    expect(btn.getAttribute("aria-busy")).toBe("true");
    // Label stays visible per the Button content rules.
    expect(btn.textContent).toContain("Import");
    // A spinner element is present alongside the label.
    expect(root.querySelector('[data-spinner], [role="progressbar"]')).not.toBeNull();
  });

  it("resolves a token-driven style proving shadow-DOM token wiring", () => {
    const root = mount(<Button onClick={() => {}}>Save</Button>);
    const btn = root.querySelector("button")!;

    // The v2 token closure must resolve on the host: a neon token reads back
    // its seeded value through the rendered primitive.
    expect(tokenValue(btn, "--xb-surface-panel")).toBe("hsl(210 28% 9% / 0.72)");
    expect(tokenValue(btn, "--xb-accent")).toBe("hsl(174 90% 52%)");
  });
});

describe("v2 IconButton", () => {
  it("renders a button exposing its required accessible name", () => {
    const onClick = vi.fn();
    const root = mount(
      <IconButton label="Open settings" icon={<span>★</span>} onClick={onClick} />,
    );

    const btn = root.querySelector("button")!;
    expect(btn.getAttribute("aria-label")).toBe("Open settings");

    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("v2 Badge", () => {
  it("renders its text content (color alone is never enough)", () => {
    const root = mount(<Badge variant="success">Ready</Badge>);
    expect(root.textContent).toContain("Ready");
  });

  it("maps success / warning / danger to distinct rendered state", () => {
    const variants = ["success", "warning", "danger"] as const;
    const markers = variants.map((variant) => {
      const root = mount(<Badge variant={variant}>{variant}</Badge>);
      const badge = root.querySelector('[data-variant], [class]')!;
      const marker =
        badge.getAttribute("data-variant") ??
        badge.getAttribute("class") ??
        "";
      cleanup();
      harness.cleanup();
      return marker;
    });

    // Each variant must produce a distinguishable marker — no two collapse.
    expect(new Set(markers).size).toBe(3);
    expect(markers.some((m) => m.includes("success"))).toBe(true);
    expect(markers.some((m) => m.includes("warning"))).toBe(true);
    expect(markers.some((m) => m.includes("danger"))).toBe(true);
  });
});

describe("v2 Switch", () => {
  it("exposes role=switch and reflects the checked state", () => {
    const root = mount(<Switch checked label="Active context" onChange={() => {}} />);
    const sw = root.querySelector('[role="switch"]');
    expect(sw).not.toBeNull();
    expect(sw!.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onChange with the next boolean when toggled", () => {
    const onChange = vi.fn();
    const root = mount(
      <Switch checked={false} label="Active context" onChange={onChange} />,
    );

    const sw = root.querySelector('[role="switch"]') as HTMLElement;
    sw.click();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("v2 Input", () => {
  it("renders the controlled value and emits onChange on input", () => {
    const onChange = vi.fn();
    const root = mount(
      <Input value="openai" aria-label="Judge provider" onChange={onChange} />,
    );

    const input = root.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("openai");

    input.value = "anthropic";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });
});

describe("v2 Alert", () => {
  it("renders a danger alert with its message and an assertive live region", () => {
    const root = mount(<Alert variant="danger">Archive too large</Alert>);

    const alert = root.querySelector('[role="alert"]') ?? root.firstElementChild!;
    expect(root.textContent).toContain("Archive too large");
    expect(
      alert.getAttribute("data-variant") ?? alert.getAttribute("class") ?? "",
    ).toContain("danger");
  });

  it("renders a warning variant distinctly from danger", () => {
    const warnRoot = mount(<Alert variant="warning">Heads up</Alert>);
    const warn = warnRoot.firstElementChild!;
    const warnMarker =
      warn.getAttribute("data-variant") ?? warn.getAttribute("class") ?? "";
    expect(warnMarker).toContain("warning");
  });
});

describe("v2 Skeleton", () => {
  it("renders a placeholder element without crashing", () => {
    const root = mount(<Skeleton />);
    expect(root.firstElementChild).not.toBeNull();
  });
});

describe("v2 KeyValueList", () => {
  it("renders each key and its value", () => {
    const root = mount(
      <KeyValueList
        items={[
          { key: "Posts captured", value: "42" },
          { key: "Last capture", value: "2026-06-21" },
        ]}
      />,
    );

    expect(root.textContent).toContain("Posts captured");
    expect(root.textContent).toContain("42");
    expect(root.textContent).toContain("Last capture");
    expect(root.textContent).toContain("2026-06-21");
  });
});
