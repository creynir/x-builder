import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiError, AppStatus, RouteConfig } from "@x-builder/shared";

import {
  createShellPreferencesStore,
  type ShellPreferencesStore,
} from "../shell-preferences";

const appShellModulePath = "../app-shell";
const routeErrorBannerModulePath = "../route-error-banner";

type ShellHistory = {
  location: {
    pathname: string;
  };
};

type ShellRouteComponentProps = {
  route: RouteConfig;
};

type ShellRouteComponents = Partial<
  Record<RouteConfig["id"], (props: ShellRouteComponentProps) => ReactElement>
>;

type AppShellProps = {
  apiClient?: {
    getStatus: () => Promise<AppStatus>;
  };
  history: ShellHistory;
  preferencesStore: ShellPreferencesStore;
  routeComponents?: ShellRouteComponents;
};

type AppShellModule = {
  AppShell: (props: AppShellProps) => ReactElement;
  createMemoryShellHistory: (options: { initialPath: string }) => ShellHistory;
};

type RouteErrorBannerProps = {
  error: ApiError | null;
  isRetrying?: boolean;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
};

type RouteErrorBannerModule = {
  RouteErrorBanner: (props: RouteErrorBannerProps) => ReactElement | null;
};

async function loadAppShell() {
  return (await import(appShellModulePath)) as AppShellModule;
}

async function loadRouteErrorBanner() {
  return (await import(routeErrorBannerModulePath)) as RouteErrorBannerModule;
}

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function createMemoryStorage(): MemoryStorage {
  const entries = new Map<string, string>();

  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

function createPreferencesStore() {
  return createShellPreferencesStore({
    storage: createMemoryStorage(),
    storageKey: "x-builder:test-route-error-recovery",
  });
}

function createPartialStatus(): AppStatus {
  const checkedAt = "2026-06-06T12:00:00.000Z";

  return {
    codex: {
      checkedAt,
      details: {},
      label: "Codex judge",
      message: "Codex is not configured.",
      retryable: true,
      state: "unconfigured",
    },
    deterministic: {
      checkedAt,
      details: {},
      label: "Deterministic scorer",
      retryable: false,
      state: "ready",
    },
    engine: {
      checkedAt,
      details: {},
      label: "Engine",
      retryable: false,
      state: "ready",
    },
    generatedAt: checkedAt,
    lastRun: {
      state: "none",
    },
    overall: "partial",
    storage: {
      checkedAt,
      details: {},
      label: "Storage",
      retryable: false,
      state: "ready",
    },
    version: "0.0.0-test",
  };
}

function createRouteError(overrides: Partial<ApiError> = {}): ApiError {
  return {
    code: "engine_unreachable",
    details: {
      rawError: "internal database-password stack trace",
    },
    message: "Could not reach the local engine. Your work is still here.",
    retryable: true,
    scope: "route",
    status: 503,
    ...overrides,
  };
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function renderBanner(
  RouteErrorBanner: RouteErrorBannerModule["RouteErrorBanner"],
  props: Partial<RouteErrorBannerProps> = {},
) {
  return renderToStaticMarkup(
    <RouteErrorBanner
      error={createRouteError()}
      onOpenSettings={vi.fn()}
      onRetry={vi.fn(async () => undefined)}
      {...props}
    />,
  );
}

describe("RouteErrorBanner", () => {
  it("uses an assertive Alert recovery banner without exposing raw internals", async () => {
    const { RouteErrorBanner } = await loadRouteErrorBanner();

    const html = renderBanner(RouteErrorBanner);
    const text = textContent(html);

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(text).toContain("Could not reach the local engine.");
    expect(text).toContain("Your work is still here.");
    expect(text).toContain("Retry");
    expect(text).toContain("Open Settings");
    expect(text).not.toContain("database-password");
    expect(text).not.toContain("stack trace");
  });

  it("clears after a successful retry removes the route error", async () => {
    const { RouteErrorBanner } = await loadRouteErrorBanner();

    const errorHtml = renderBanner(RouteErrorBanner, {
      isRetrying: true,
    });
    const recoveredHtml = renderBanner(RouteErrorBanner, {
      error: null,
    });

    expect(textContent(errorHtml)).toContain("Retry");
    expect(errorHtml).toContain('aria-busy="true"');
    expect(textContent(recoveredHtml)).not.toContain("Retry");
    expect(recoveredHtml).not.toContain('role="alert"');
  });

  it("does not promote field validation errors to the route banner", async () => {
    const { RouteErrorBanner } = await loadRouteErrorBanner();
    const fieldError = createRouteError({
      code: "validation_failed",
      fieldErrors: {
        idea: ["Idea is required."],
      },
      message: "The request is invalid.",
      retryable: false,
      scope: "field",
      status: 400,
    });

    const html = renderBanner(RouteErrorBanner, {
      error: fieldError,
    });

    expect(html).toBe("");
    expect(textContent(html)).not.toContain("Idea is required.");
  });
});

describe("AppShell route recovery integration", () => {
  it("keeps the status bar and sidebar mounted when a route throws", async () => {
    const { AppShell, createMemoryShellHistory } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/writer" });
    const preferencesStore = createPreferencesStore();
    const apiClient = {
      getStatus: vi.fn(async () => createPartialStatus()),
    };
    const failingRoute = () => {
      throw new Error("raw writer route failure: database-password");
    };

    const html = renderToStaticMarkup(
      <AppShell
        apiClient={apiClient}
        history={history}
        preferencesStore={preferencesStore}
        routeComponents={{
          writer: failingRoute,
        }}
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Writer");
    expect(text).toContain("Settings");
    expect(text).toContain("Codex judge");
    expect(text).toContain("This route could not render.");
    expect(text).toContain("Retry");
    expect(text).toContain("Open Settings");
    expect(text).not.toContain("database-password");
  });
});
