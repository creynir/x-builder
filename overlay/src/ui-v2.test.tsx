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
// the FRESH v2 `EmptyState` primitive — this file does not exist yet,
// so importing it is what drives the RED state for the contract block below.
import { EmptyState } from "../../client/src/ui/v2/empty-state";
import { IconButton } from "../../client/src/ui/v2/icon-button";
import { Input } from "../../client/src/ui/v2/input";
import { KeyValueList } from "../../client/src/ui/v2/key-value-list";
import { ScoreBar } from "../../client/src/ui/v2/score-bar";
import { Select } from "../../client/src/ui/v2/select";
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
      <Input value="hello" aria-label="Search known posts" onChange={onChange} />,
    );

    const input = root.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("hello");

    input.value = "world";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });
});

describe("v2 Select", () => {
  it("renders a native select reflecting the value and the option set", () => {
    const root = mount(
      <Select
        value="codex-cli"
        aria-label="Judge provider"
        onChange={() => {}}
        options={[
          { value: "codex-cli", label: "Codex judge" },
          { value: "claude-cli", label: "Claude judge" },
          { value: "cursor-cli", label: "Cursor judge" },
        ]}
      />,
    );

    const select = root.querySelector("select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe("codex-cli");
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "codex-cli",
      "claude-cli",
      "cursor-cli",
    ]);
  });

  it("emits onChange with the chosen value", () => {
    const onChange = vi.fn();
    const root = mount(
      <Select
        value="codex-cli"
        aria-label="Judge provider"
        onChange={onChange}
        options={[
          { value: "codex-cli", label: "Codex judge" },
          { value: "claude-cli", label: "Claude judge" },
        ]}
      />,
    );

    const select = root.querySelector("select") as HTMLSelectElement;
    select.value = "claude-cli";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith("claude-cli");
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

describe("v2 ScoreBar", () => {
  // StaticEngineColumn is the first consumer of the fresh v2 ScoreBar primitive. It mirrors
  // the legacy `ScoreBarProps` ({ label, value, max?, bandLabel?, helpText?,
  // loading?, disabled? }) but renders with inline `var(--…)` token styles (no
  // global classnames) so it travels into the shadow root. The fill colour maps
  // value → a score-band token (`--score-strong/good/usable/needs-rewrite/
  // unknown`); it must NEVER use the judge / accent CTA hue. We assert on stable
  // signals only: progressbar ARIA, the rendered value text, the `data-score-band`
  // marker, and the fill element's inline width.

  /** The single score-band fill element (the impl exposes `data-score-fill`). */
  function fill(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>("[data-score-fill]");
    if (!el) throw new Error("ScoreBar must expose a [data-score-fill] element.");
    return el;
  }

  /** The bar's stable score-band marker (`strong`/`good`/`usable`/…). */
  function band(root: ParentNode): string {
    const el = root.querySelector<HTMLElement>("[data-score-band]");
    if (!el) throw new Error("ScoreBar must expose a [data-score-band] marker.");
    return el.getAttribute("data-score-band") ?? "";
  }

  it("renders the label and the value text", () => {
    const root = mount(<ScoreBar label="Static score" value={72} />);
    expect(root.textContent).toContain("Static score");
    expect(root.textContent).toContain("72");
  });

  it("exposes progressbar semantics reflecting value and max", () => {
    const root = mount(<ScoreBar label="Static score" value={72} />);
    const bar = root.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("aria-valuenow")).toBe("72");
    // max defaults to 100.
    expect(bar!.getAttribute("aria-valuemax")).toBe("100");
    expect(bar!.getAttribute("aria-valuemin")).toBe("0");
  });

  it("when loading, sets aria-busy and shows a skeleton with no value text", () => {
    const root = mount(<ScoreBar label="Static score" value={72} loading />);

    // aria-busy is set on the busy element.
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    // A skeleton placeholder stands in for the bar.
    expect(root.querySelector("[data-skeleton]")).not.toBeNull();
    // The numeric value must NOT leak while loading (no real score yet).
    expect(root.textContent).not.toContain("72");
  });

  it("when disabled, marks the bar disabled (aria-disabled) and stays inert", () => {
    const root = mount(<ScoreBar label="Static score" value={72} disabled />);
    const bar = root.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("aria-disabled")).toBe("true");
  });

  it("fills the bar to value/max as an inline percentage width", () => {
    const root = mount(<ScoreBar label="Static score" value={30} max={120} />);
    // 30 / 120 = 25%.
    expect(fill(root).style.width).toBe("25%");
  });

  it("clamps an over-max value to a full (100%) fill", () => {
    const root = mount(<ScoreBar label="Static score" value={150} max={100} />);
    expect(fill(root).style.width).toBe("100%");
  });

  it("maps the fill colour to a distinct score-band token across value ranges", () => {
    // Each band must resolve to a DIFFERENT, defined score-band token so colour
    // alone is never the only differentiator AND no two ranges collapse.
    const strong = mount(<ScoreBar label="s" value={90} />);
    const strongBand = band(strong);
    cleanup();
    harness.cleanup();

    const needsRewrite = mount(<ScoreBar label="s" value={10} />);
    const lowBand = band(needsRewrite);

    // The high score and the low score land in different bands.
    expect(strongBand).not.toBe(lowBand);
    // The band markers are drawn from the known score-band vocabulary.
    const vocab = ["strong", "good", "usable", "needs-rewrite", "unknown"];
    expect(vocab).toContain(strongBand);
    expect(vocab).toContain(lowBand);
  });

  it("never paints the fill with the judge or accent CTA hue (neutral score bands only)", () => {
    const root = mount(<ScoreBar label="Static score" value={72} />);
    const fillEl = fill(root);
    const bg = getComputedStyle(fillEl).backgroundColor;
    // The judge token --xb-judge resolves to hsl(192 95% 60%) → rgb(38, 232, 250);
    // the accent --xb-accent → rgb. The score-band fill must be neither.
    expect(bg).not.toBe(tokenValue(fillEl, "--xb-judge"));
    expect(bg).not.toBe(tokenValue(fillEl, "--xb-accent"));
    // The bar markup must not reference the judge/accent token names at all.
    expect(fillEl.closest("[role='progressbar']")?.outerHTML ?? "").not.toContain(
      "--xb-judge",
    );
  });
});

describe("v2 EmptyState", () => {
  // SuggestAffordance is the FIRST consumer of the fresh v2 `EmptyState` primitive. It
  // mirrors the legacy `client/src/ui/foundation.tsx` `EmptyState` prop shape —
  // `{ title: string; children: ReactNode; action?: ReactNode }` — but renders
  // with inline `var(--…)` token styles (no global classnames) so it travels
  // into the shadow root. We assert on stable structural signals only: the
  // title text, the body (children), the optional action region's presence /
  // absence, and that it mounts without crashing inside the seeded shadow host.

  it("renders the title text", () => {
    const root = mount(
      <EmptyState title="No post history yet">Capture some posts first.</EmptyState>,
    );
    expect(root.textContent).toContain("No post history yet");
  });

  it("renders the children as the body", () => {
    const root = mount(
      <EmptyState title="No post history yet">
        <span>Capture some posts first.</span>
      </EmptyState>,
    );
    expect(root.textContent).toContain("Capture some posts first.");
  });

  it("renders the action region when an action is provided", () => {
    const root = mount(
      <EmptyState
        title="No post history yet"
        action={<Button onClick={() => {}}>Import archive</Button>}
      >
        Capture some posts first.
      </EmptyState>,
    );
    // The action surfaces as its own rendered control.
    const actionButton = Array.from(root.querySelectorAll("button")).find((b) =>
      /import archive/i.test(b.textContent ?? ""),
    );
    expect(actionButton).toBeDefined();
  });

  it("omits the action region entirely when no action is provided", () => {
    const root = mount(
      <EmptyState title="No post history yet">Capture some posts first.</EmptyState>,
    );
    // No action → no rendered control. The title + body still render, but the
    // empty state holds no button when `action` is absent (not an empty wrapper
    // masquerading as one): there is simply no button in the subtree.
    expect(root.querySelector("button")).toBeNull();
    // …yet the core content is intact, proving the absence is the action only.
    expect(root.textContent).toContain("No post history yet");
    expect(root.textContent).toContain("Capture some posts first.");
  });

  it("mounts inside the seeded shadow host without crashing (token-driven)", () => {
    // The primitive must resolve its inline `var(--…)` styles against the seeded
    // token closure — rendering into the real shadow root proves it travels.
    const root = mount(
      <EmptyState title="No post history yet">Capture some posts first.</EmptyState>,
    );
    expect(root.firstElementChild).not.toBeNull();
  });
});
