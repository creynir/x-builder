import { readFileSync } from "node:fs";
import type {
  ButtonHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

type FoundationComponents = {
  Alert: (props: AlertProps) => ReactElement;
  Badge: (props: BadgeProps) => ReactElement;
  Button: (props: ButtonProps) => ReactElement;
  EmptyState: (props: EmptyStateProps) => ReactElement;
  IconButton: (props: IconButtonProps) => ReactElement;
  PageHeader: (props: PageHeaderProps) => ReactElement;
  Skeleton: (props: SkeletonProps) => ReactElement;
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
    expect(foundation.Tooltip).toBeTypeOf("function");
    expect(foundation.Alert).toBeTypeOf("function");
    expect(foundation.EmptyState).toBeTypeOf("function");
    expect(foundation.Skeleton).toBeTypeOf("function");
    expect(foundation.ToastRegion).toBeTypeOf("function");
    expect(foundation.PageHeader).toBeTypeOf("function");
  });
});

describe("PageHeader", () => {
  it("renders one route h1 with optional description, back action, and route actions", async () => {
    const { Button, PageHeader } = await loadFoundation();

    const html = renderToStaticMarkup(
      <PageHeader
        title="Settings"
        description="Repair local engine, Codex, and storage readiness."
        backAction={<Button variant="ghost">Back to Writer</Button>}
        actions={<Button variant="primary">Save settings</Button>}
      />,
    );

    expect(countOpeningTags(html, "h1")).toBe(1);
    expect(html).toContain(">Settings</h1>");
    expect(textContent(html)).toContain(
      "Repair local engine, Codex, and storage readiness.",
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
