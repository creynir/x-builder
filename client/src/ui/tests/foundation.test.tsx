import { readFileSync } from "node:fs";
import type {
  ButtonHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const foundationModulePath = "../foundation";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  label: string;
  tooltip: string;
  icon: ReactNode;
  variant?: "ghost" | "secondary" | "danger";
};

type PageHeaderProps = {
  title: string;
  description?: string;
  backAction?: ReactNode;
  actions?: ReactNode;
};

type AlertProps = {
  variant: "warning" | "danger";
  title: string;
  children: ReactNode;
  recovery?: ReactNode;
};

type BadgeProps = {
  variant: "neutral" | "warning" | "danger" | "info";
  children: ReactNode;
};

type EmptyStateProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
};

type SkeletonProps = {
  label: string;
  width: number;
  height: number;
};

type ScoreBarProps = {
  label: string;
  value: number;
  max?: number;
  bandLabel?: string;
  helpText?: string;
  loading?: boolean;
  disabled?: boolean;
};

type InputProps = {
  id: string;
  label: string;
  helperText?: string;
  error?: string;
  loading?: boolean;
  disabled?: boolean;
  value?: string | number;
};

type DrawerProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

type KeyValueListProps = {
  items: Array<{
    label: string;
    value: ReactNode;
  }>;
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
};

type SwitchProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
  disabled?: boolean;
};

type FoundationComponents = {
  Alert: (props: AlertProps) => ReactElement;
  Badge: (props: BadgeProps) => ReactElement;
  Button: (props: ButtonProps) => ReactElement;
  Drawer: (props: DrawerProps) => ReactElement | null;
  EmptyState: (props: EmptyStateProps) => ReactElement;
  IconButton: (props: IconButtonProps) => ReactElement;
  Input: (props: InputProps) => ReactElement;
  KeyValueList: (props: KeyValueListProps) => ReactElement;
  PageHeader: (props: PageHeaderProps) => ReactElement;
  ScoreBar: (props: ScoreBarProps) => ReactElement;
  Skeleton: (props: SkeletonProps) => ReactElement;
  Switch: (props: SwitchProps) => ReactElement;
  ToastRegion: () => ReactElement;
  Tooltip: (props: { label: string; children: ReactNode }) => ReactElement;
};

async function loadFoundation() {
  return (await import(foundationModulePath)) as FoundationComponents;
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function countOpeningTags(html: string, tagName: string) {
  return [...html.matchAll(new RegExp(`<${tagName}(\\s|>)`, "g"))].length;
}

function firstButton(html: string) {
  const button = html.match(/<button\b[\s\S]*?<\/button>/)?.[0];

  if (!button) {
    throw new Error(`Expected a button in rendered markup:\n${html}`);
  }

  return button;
}

function buttonVisibleText(buttonHtml: string) {
  return textContent(
    buttonHtml.replace(/<[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/[^>]+>/g, ""),
  );
}

describe("UI foundation public surface", () => {
  it("exports the shell primitive components as functions", async () => {
    const foundation = await loadFoundation();

    expect(foundation.Button).toBeTypeOf("function");
    expect(foundation.IconButton).toBeTypeOf("function");
    expect(foundation.Badge).toBeTypeOf("function");
    expect(foundation.ScoreBar).toBeTypeOf("function");
    expect(foundation.Input).toBeTypeOf("function");
    expect(foundation.Drawer).toBeTypeOf("function");
    expect(foundation.KeyValueList).toBeTypeOf("function");
    expect(foundation.Tooltip).toBeTypeOf("function");
    expect(foundation.Alert).toBeTypeOf("function");
    expect(foundation.EmptyState).toBeTypeOf("function");
    expect(foundation.Skeleton).toBeTypeOf("function");
    expect(foundation.ToastRegion).toBeTypeOf("function");
    expect(foundation.PageHeader).toBeTypeOf("function");
  });
});

describe("ScoreBar", () => {
  it("renders caller-provided label, value, band, and help text without deterministic copy", async () => {
    const { ScoreBar } = await loadFoundation();

    const html = renderToStaticMarkup(
      <ScoreBar
        label="Readiness"
        value={72}
        max={100}
        bandLabel="Ready"
        helpText="Based on the selected checks."
      />,
    );
    const text = textContent(html);

    expect(html).toContain("xb-score-bar");
    expect(html).toContain('aria-valuenow="72"');
    expect(html).toContain('aria-valuemax="100"');
    expect(text).toContain("Readiness");
    expect(text).toContain("72");
    expect(text).toContain("Ready");
    expect(text).toContain("Based on the selected checks.");
    expect(text).not.toContain("Heuristic rank, not prediction.");
  });

  it("exposes loading and disabled states without losing the caller label", async () => {
    const { ScoreBar } = await loadFoundation();

    const html = renderToStaticMarkup(
      <ScoreBar label="Queue fit" value={0} loading disabled />,
    );
    const text = textContent(html);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('role="status"');
    expect(text).toContain("Queue fit");
  });
});

describe("Input", () => {
  it("renders label, helper, value, and disabled state with described-by wiring", async () => {
    const { Input } = await loadFoundation();

    const html = renderToStaticMarkup(
      <Input
        id="followers"
        label="Followers"
        helperText="Used only for local prediction ranges."
        value={2400}
        disabled
      />,
    );

    expect(html).toContain('for="followers"');
    expect(html).toContain('id="followers"');
    expect(html).toContain('value="2400"');
    expect(html).toContain("disabled");
    expect(html).toContain("aria-describedby");
    expect(textContent(html)).toContain("Followers");
    expect(textContent(html)).toContain("Used only for local prediction ranges.");
  });

  it("renders invalid and loading accessible states with the error associated to the field", async () => {
    const { Input } = await loadFoundation();

    const html = renderToStaticMarkup(
      <Input
        id="followers"
        label="Followers"
        error="Enter a positive follower count."
        loading
      />,
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("aria-describedby");
    expect(textContent(html)).toContain("Enter a positive follower count.");
  });
});

describe("Drawer", () => {
  it("renders an open dialog shell with title, close action, and body content", async () => {
    const { Drawer } = await loadFoundation();

    const html = renderToStaticMarkup(
      <Drawer open title="Details" closeLabel="Close details" onClose={() => {}}>
        <p>Evidence and scoring context.</p>
      </Drawer>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(textContent(html)).toContain("Details");
    expect(firstButton(html)).toContain('aria-label="Close details"');
    expect(textContent(html)).toContain("Evidence and scoring context.");
  });

  it("does not render body content when closed", async () => {
    const { Drawer } = await loadFoundation();

    const html = renderToStaticMarkup(
      <Drawer
        open={false}
        title="Details"
        closeLabel="Close details"
        onClose={() => {}}
      >
        <p>Evidence and scoring context.</p>
      </Drawer>,
    );

    expect(textContent(html)).not.toContain("Evidence and scoring context.");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("KeyValueList", () => {
  it("renders label and value rows from caller-provided items", async () => {
    const { KeyValueList } = await loadFoundation();

    const html = renderToStaticMarkup(
      <KeyValueList
        items={[
          { label: "Source format", value: "one-liner" },
          { label: "Detected format", value: "genuine_question" },
        ]}
      />,
    );
    const text = textContent(html);

    expect(html).toContain("xb-key-value-list");
    expect(text).toContain("Source format");
    expect(text).toContain("one-liner");
    expect(text).toContain("Detected format");
    expect(text).toContain("genuine_question");
  });

  it("renders empty, loading, and disabled states when callers provide them", async () => {
    const { KeyValueList } = await loadFoundation();

    const emptyHtml = renderToStaticMarkup(
      <KeyValueList items={[]} emptyMessage="No scoring metadata yet." />,
    );
    const loadingHtml = renderToStaticMarkup(<KeyValueList items={[]} loading />);
    const disabledHtml = renderToStaticMarkup(
      <KeyValueList
        items={[{ label: "Prediction", value: "Needs followers" }]}
        disabled
      />,
    );

    expect(textContent(emptyHtml)).toContain("No scoring metadata yet.");
    expect(loadingHtml).toContain('role="status"');
    expect(loadingHtml).toContain('aria-busy="true"');
    expect(disabledHtml).toContain('aria-disabled="true"');
    expect(textContent(disabledHtml)).toContain("Needs followers");
  });
});

describe("PageHeader", () => {
  it("renders one route h1 with optional description, back action, and route actions", async () => {
    const { Button, PageHeader } = await loadFoundation();

    const html = renderToStaticMarkup(
      <PageHeader
        title="Settings"
        description="Repair local engine, judge, and storage readiness."
        backAction={<Button variant="ghost">Back to Writer</Button>}
        actions={<Button variant="primary">Save settings</Button>}
      />,
    );

    expect(countOpeningTags(html, "h1")).toBe(1);
    expect(html).toContain(">Settings</h1>");
    expect(textContent(html)).toContain(
      "Repair local engine, judge, and storage readiness.",
    );
    expect(textContent(html)).toContain("Back to Writer");
    expect(textContent(html)).toContain("Save settings");
  });
});

describe("IconButton", () => {
  it("renders an icon-only button with an accessible name and tooltip", async () => {
    const { IconButton } = await loadFoundation();

    const html = renderToStaticMarkup(
      <IconButton
        label="Refresh status"
        tooltip="Refresh status"
        icon={<span aria-hidden="true">refresh</span>}
      />,
    );
    const button = firstButton(html);

    expect(button).toContain('aria-label="Refresh status"');
    expect(buttonVisibleText(button)).toBe("");
    expect(html).toContain('role="tooltip"');
    expect(textContent(html)).toContain("Refresh status");
  });
});

describe("Alert", () => {
  it.each(["warning", "danger"] as const)(
    "renders %s text with a recovery action slot",
    async (variant) => {
      const { Alert, Button } = await loadFoundation();

      const html = renderToStaticMarkup(
        <Alert
          variant={variant}
          title="Could not reach the local engine"
          recovery={<Button variant="secondary">Retry</Button>}
        >
          Your idea is still here.
        </Alert>,
      );

      expect(html).toContain(`xb-alert--${variant}`);
      expect(textContent(html)).toContain("Could not reach the local engine");
      expect(textContent(html)).toContain("Your idea is still here.");
      expect(textContent(html)).toContain("Retry");
    },
  );
});

describe("Button", () => {
  it("keeps its label visible and exposes busy state while loading", async () => {
    const { Button } = await loadFoundation();

    const html = renderToStaticMarkup(
      <Button variant="primary" loading>
        Generate
      </Button>,
    );
    const button = firstButton(html);

    expect(button).toContain('aria-busy="true"');
    expect(buttonVisibleText(button)).toBe("Generate");
  });
});

// EXTRACTION-TARGET TEST (AC2) — the foundation `Switch` does not exist yet.
// This block FAILS NOW because `Switch` is not exported from `foundation`:
// destructuring it yields `undefined`, so calling it throws a runtime
// "Switch is not a function" error (a clean missing-export failure, not a
// syntax/type error). Green's extraction adds and exports `Switch`, which makes
// every assertion below pass. The harness is SSR-only (node env, no DOM, no
// testing-library), so the keyboard toggle is exercised the SSR-compatible way:
// a Space keypress on a native checkbox produces exactly the change event whose
// `target.checked` is the flipped value, so invoking the rendered input's
// `onChange` with that synthetic event is the faithful component-level analog.
type ChildShape = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

function flattenElements(node: unknown): ChildShape[] {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((child) => flattenElements(child));
  }

  const element = node as ChildShape;
  const here = element.type !== undefined ? [element] : [];
  const children = element.props?.children;

  return [...here, ...flattenElements(children)];
}

function findCheckboxInput(element: ReactElement): ChildShape {
  const input = flattenElements(element).find(
    (child) =>
      child.type === "input" && child.props?.type === "checkbox",
  );

  if (input === undefined) {
    throw new Error("Expected a native checkbox <input> inside the Switch.");
  }

  return input;
}

describe("Switch", () => {
  it("encapsulates the prior native-checkbox markup: toggles via change/Space to flip checked + fire onChange, reflects disabled, with no aria-checked or role=switch", async () => {
    const { Switch } = await loadFoundation();
    const onChange = vi.fn();

    // Calling the missing export throws "Switch is not a function" here — the
    // expected fail-now mode before Green adds and exports the component.
    // Render unchecked: a Space keypress on a native checkbox emits a change
    // event whose target.checked is the flipped (now true) value, so invoking
    // the rendered input's onChange with it is the SSR-faithful keyboard toggle.
    const uncheckedElement = Switch({
      id: "show-details",
      label: "Show deterministic details",
      checked: false,
      onChange,
    });
    const uncheckedInput = findCheckboxInput(uncheckedElement);
    const toggleOn = uncheckedInput.props?.onChange as
      | ((event: { target: { checked: boolean } }) => void)
      | undefined;

    expect(toggleOn).toBeTypeOf("function");
    toggleOn?.({ target: { checked: true } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);

    // Toggling a checked switch the other way reports false.
    const checkedElement = Switch({
      id: "show-details",
      label: "Show deterministic details",
      checked: true,
      onChange,
    });
    const toggleOff = findCheckboxInput(checkedElement).props?.onChange as
      | ((event: { target: { checked: boolean } }) => void)
      | undefined;

    toggleOff?.({ target: { checked: false } });
    expect(onChange).toHaveBeenLastCalledWith(false);

    // Rendered markup must reproduce the prior inline settings switch exactly:
    // a labeled bare native checkbox with id/htmlFor wiring, controlled checked
    // reflection, the same wrapper class, and a disabled control when disabled.
    // It is NOT a custom role="switch" widget, so it carries NO aria-checked and
    // NO role="switch" — matching the preserved settings-route SSR markup.
    const checkedHtml = renderToStaticMarkup(
      <Switch
        id="show-details"
        label="Show deterministic details"
        checked
        onChange={() => {}}
      />,
    );
    const uncheckedHtml = renderToStaticMarkup(
      <Switch
        id="show-details"
        label="Show deterministic details"
        checked={false}
        onChange={() => {}}
      />,
    );
    const disabledHtml = renderToStaticMarkup(
      <Switch
        id="show-details"
        label="Show deterministic details"
        checked
        disabled
        onChange={() => {}}
      />,
    );

    expect(textContent(checkedHtml)).toContain("Show deterministic details");
    expect(checkedHtml).toContain('id="show-details"');
    expect(checkedHtml).toContain('for="show-details"');
    expect(checkedHtml).toContain('type="checkbox"');
    // Same tokenized switch wrapper class the settings markup uses.
    expect(checkedHtml).toContain('class="xb-settings-route__switch"');
    // Controlled checked state reflects in the markup.
    expect(checkedHtml).toContain("checked=");
    expect(uncheckedHtml).not.toContain("checked=");
    // Bare native checkbox — never an ARIA switch widget.
    expect(checkedHtml).not.toContain("aria-checked");
    expect(uncheckedHtml).not.toContain("aria-checked");
    expect(checkedHtml).not.toContain('role="switch"');
    // Disabled renders the input disabled.
    expect(disabledHtml).toContain("disabled");
    expect(disabledHtml).not.toContain("aria-checked");
  });
});

describe("foundation stylesheet", () => {
  it("uses product tokens and dense shell selectors without decorative page treatment", () => {
    const css = readFileSync(new URL("../foundation.css", import.meta.url), "utf8");

    expect(css).toContain("product-tokens.css");
    expect(css).toContain("--type-page-title");
    expect(css).toContain("--padding-page");
    expect(css).toContain("--space-2");
    expect(css).toContain("--border-default");
    expect(css).toMatch(/\.xb-page-header\b/);
    expect(css).toMatch(/\.xb-button\b/);
    expect(css).toMatch(/\.xb-icon-button\b/);
    expect(css).toMatch(/\.xb-alert\b/);
    expect(css).toMatch(/\.xb-toast-region\b/);
    expect(css).not.toMatch(/gradient|glow|hero|landing/i);
  });
});
