import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ApiError,
  AppStatus,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
  RouteConfig,
} from "@x-builder/shared";

import {
  createShellPreferencesStore,
  type ShellPreferencesStore,
} from "../shell-preferences";

const appShellModulePath = "../app-shell";

type ShellHistory = {
  location: {
    pathname: string;
  };
};

type RouteHeadingFocusTarget = {
  routeId: RouteConfig["id"];
  headingId: string;
  headingText: string;
};

type ShellRouteComponentProps = {
  route: RouteConfig;
};

type ShellRouteComponents = Partial<
  Record<RouteConfig["id"], (props: ShellRouteComponentProps) => ReactElement>
>;

type ShellApiClient = {
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
  getSettings?: () => Promise<unknown>;
  getStatus: () => Promise<AppStatus>;
  saveSettings?: (input: unknown) => Promise<unknown>;
};

type AppShellProps = {
  apiClient?: ShellApiClient;
  history: ShellHistory;
  preferencesStore: ShellPreferencesStore;
  routeComponents?: ShellRouteComponents;
  onRouteHeadingFocus?: (target: RouteHeadingFocusTarget) => void;
};

type CreateMemoryShellHistoryOptions = {
  initialPath: string;
};

type NavigateShellRouteOptions = {
  history: ShellHistory;
  preferencesStore: ShellPreferencesStore;
  to: RouteConfig["path"];
  focusRouteHeading: (target: RouteHeadingFocusTarget) => void;
};

type GuardSettingsNavigationOptions = {
  activeRouteId: RouteConfig["id"];
  isSettingsDirty: boolean;
  onNavigate: (to: RouteConfig["path"]) => void;
  onWarnUnsavedSettings: (to: RouteConfig["path"]) => void;
  to: RouteConfig["path"];
};

type AppShellPublicDriverOptions = AppShellProps & {
  renderShell?: (props: AppShellProps) => ReactElement;
};

type AppShellPublicDriver = {
  activatePlaceholderPrimaryAction: () => string;
  generateWriterIdea: () => Promise<string>;
  openWriterErrorSettings: () => string;
  updateWriterIdea: (idea: string) => string;
};

type AppShellModule = {
  AppShell: (props: AppShellProps) => ReactElement;
  createAppShellPublicDriver: (
    options: AppShellPublicDriverOptions,
  ) => AppShellPublicDriver;
  createMemoryShellHistory: (
    options: CreateMemoryShellHistoryOptions,
  ) => ShellHistory;
  guardSettingsNavigation: (
    options: GuardSettingsNavigationOptions,
  ) => "navigated" | "warned";
  navigateShellRoute: (options: NavigateShellRouteOptions) => void;
};

async function loadAppShell() {
  return (await import(appShellModulePath)) as AppShellModule;
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

function createPreferencesStore(
  savedPreferences?: Parameters<ShellPreferencesStore["set"]>[0],
) {
  const store = createShellPreferencesStore({
    storage: createMemoryStorage(),
    storageKey: "x-builder:test-app-shell",
  });

  if (savedPreferences !== undefined) {
    store.set(savedPreferences);
  }

  return store;
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function countOpeningTags(html: string, tagName: string) {
  return [...html.matchAll(new RegExp(`<${tagName}(\\s|>)`, "g"))].length;
}

function renderShell(AppShell: AppShellModule["AppShell"], props: AppShellProps) {
  return renderToStaticMarkup(<AppShell {...props} />);
}

function subsystem(
  label: string,
  state: AppStatus["engine"]["state"],
): AppStatus["engine"] {
  return {
    checkedAt: "2026-06-06T12:10:00.000Z",
    details: {},
    label,
    retryable: state !== "ready",
    state,
  };
}

function createReadyStatus(): AppStatus {
  return {
    codex: subsystem("Codex judge", "ready"),
    deterministic: subsystem("Deterministic scorer", "ready"),
    engine: subsystem("Engine", "ready"),
    generatedAt: "2026-06-06T12:10:00.000Z",
    lastRun: {
      state: "none",
    },
    overall: "ready",
    storage: subsystem("Storage", "ready"),
    version: "0.0.0-test",
  };
}

function createApiError(overrides: Partial<ApiError> = {}): ApiError {
  return {
    code: "engine_unreachable",
    message: "Could not reach the local engine. Your idea is still here.",
    retryable: true,
    scope: "writer",
    status: 503,
    ...overrides,
  };
}

function createValidIdeaResponse(): GenerateIdeaResponse {
  return {
    candidates: [
      {
        format: "one-liner",
        id: "candidate-one-liner",
        text: "Local-first writing tools need boring edges.",
      },
      {
        format: "mini-framework",
        id: "candidate-mini-framework",
        text: "Name the constraint, show the tradeoff, then make the local-first call.",
      },
      {
        format: "debate-question",
        id: "candidate-debate-question",
        text: "What local-first compromise would make builders trust the tool more?",
      },
    ],
  };
}

function throwApiError(apiError: ApiError): never {
  throw Object.assign(new Error(apiError.message), {
    apiError,
  });
}

function createShellApiClient(
  overrides: Partial<ShellApiClient> = {},
): ShellApiClient {
  return {
    generateIdea: vi.fn(async () => createValidIdeaResponse()),
    getSettings: vi.fn(async () => {
      throw new Error("Placeholders must not load settings.");
    }),
    getStatus: vi.fn(async () => createReadyStatus()),
    saveSettings: vi.fn(async () => {
      throw new Error("Placeholders must not save settings.");
    }),
    ...overrides,
  };
}

describe("AppShell route frame", () => {
  it("renders Writer inside the shell and canonicalizes the root URL", async () => {
    const { AppShell, createMemoryShellHistory } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/" });
    const preferencesStore = createPreferencesStore();

    const html = renderShell(AppShell, { history, preferencesStore });

    expect(history.location.pathname).toBe("/writer");
    expect(countOpeningTags(html, "nav")).toBe(1);
    expect(countOpeningTags(html, "main")).toBe(1);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain(">Writer</h1>");
    expect(html).toMatch(/<a\b[^>]*href="\/writer"[^>]*aria-current="page"/);
  });

  it("navigates to Settings through owned route helpers without unmounting the sidebar", async () => {
    const { AppShell, createMemoryShellHistory, navigateShellRoute } =
      await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/writer" });
    const preferencesStore = createPreferencesStore();

    navigateShellRoute({
      history,
      preferencesStore,
      to: "/settings",
      focusRouteHeading: () => undefined,
    });
    const html = renderShell(AppShell, { history, preferencesStore });

    expect(history.location.pathname).toBe("/settings");
    expect(preferencesStore.get().lastRoutePath).toBe("/settings");
    expect(html).toContain(">Settings</h1>");
    expect(html).toMatch(/<a\b[^>]*href="\/settings"[^>]*aria-current="page"/);
    expect(textContent(html)).toContain("Writer");
    expect(textContent(html)).toContain("Voice");
    expect(textContent(html)).toContain("Post Library");
    expect(textContent(html)).toContain("Settings");
  });

  it("keeps collapsed route links accessible and exposes an expand control", async () => {
    const { AppShell, createMemoryShellHistory } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/writer" });
    const preferencesStore = createPreferencesStore({
      density: "comfortable",
      lastRoutePath: "/writer",
      sidebarCollapsed: true,
    });

    const html = renderShell(AppShell, { history, preferencesStore });

    expect(html).toMatch(/<a\b[^>]*href="\/writer"[^>]*aria-label="Writer"/);
    expect(html).toMatch(/<a\b[^>]*href="\/voice"[^>]*aria-label="Voice"/);
    expect(html).toMatch(
      /<a\b[^>]*href="\/library"[^>]*aria-label="Post Library"/,
    );
    expect(html).toMatch(/<a\b[^>]*href="\/settings"[^>]*aria-label="Settings"/);
    expect(html).toContain('aria-label="Expand sidebar"');
    expect(html).not.toContain('aria-label="Collapse sidebar"');
  });

  it("keeps shell navigation mounted when a route component fails", async () => {
    const { AppShell, createMemoryShellHistory } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/settings" });
    const preferencesStore = createPreferencesStore();
    const failingRoute = () => {
      throw new Error("raw settings route failure: database-password");
    };

    const html = renderShell(AppShell, {
      history,
      preferencesStore,
      routeComponents: {
        settings: failingRoute,
      },
    });

    expect(textContent(html)).toContain("Writer");
    expect(textContent(html)).toContain("Settings");
    expect(textContent(html)).toContain("This route could not render.");
    expect(textContent(html)).toContain("Retry");
    expect(textContent(html)).not.toContain("database-password");
  });

  it("moves focus to the destination route heading after navigation settles", async () => {
    const { AppShell, createMemoryShellHistory, navigateShellRoute } =
      await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/writer" });
    const preferencesStore = createPreferencesStore();
    let focusedHeading: RouteHeadingFocusTarget | undefined;

    navigateShellRoute({
      history,
      preferencesStore,
      to: "/settings",
      focusRouteHeading: (target) => {
        focusedHeading = target;
      },
    });
    const html = renderShell(AppShell, { history, preferencesStore });

    expect(focusedHeading).toEqual({
      routeId: "settings",
      headingId: "route-heading-settings",
      headingText: "Settings",
    });
    expect(html).toContain('id="route-heading-settings"');
    expect(html).toContain('tabIndex="-1"');
  });

  it("warns instead of mutating shell history when dirty Settings attempts to leave", async () => {
    const { guardSettingsNavigation } = await loadAppShell();
    const onNavigate = vi.fn();
    const onWarnUnsavedSettings = vi.fn();

    const result = guardSettingsNavigation({
      activeRouteId: "settings",
      isSettingsDirty: true,
      onNavigate,
      onWarnUnsavedSettings,
      to: "/voice",
    });

    expect(result).toBe("warned");
    expect(onWarnUnsavedSettings).toHaveBeenCalledWith("/voice");
    expect(onNavigate).not.toHaveBeenCalled();

    const cleanResult = guardSettingsNavigation({
      activeRouteId: "settings",
      isSettingsDirty: false,
      onNavigate,
      onWarnUnsavedSettings,
      to: "/writer",
    });

    expect(cleanResult).toBe("navigated");
    expect(onNavigate).toHaveBeenCalledWith("/writer");
  });

  it("wires the default Writer route to shell API generation and Settings recovery", async () => {
    const {
      AppShell,
      createAppShellPublicDriver,
      createMemoryShellHistory,
    } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/writer" });
    const preferencesStore = createPreferencesStore();
    const engineError = createApiError();
    const generateIdea = vi.fn(async () => throwApiError(engineError));
    const apiClient = createShellApiClient({
      generateIdea,
    });
    const idea = "The Writer route should use the shell-provided API client.";
    const driver = createAppShellPublicDriver({
      apiClient,
      history,
      preferencesStore,
      renderShell: AppShell,
    });

    driver.updateWriterIdea(idea);
    const html = await driver.generateWriterIdea();
    const text = textContent(html);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(generateIdea).toHaveBeenCalledWith({
      idea,
    });
    expect(html).toContain(escapeHtml(idea));
    expect(text).toContain("Could not reach the local engine. Your idea is still here.");
    expect(text).toContain("Retry");
    expect(text).toContain("Open Settings");
    expect(history.location.pathname).toBe("/writer");

    driver.openWriterErrorSettings();

    expect(history.location.pathname).toBe("/settings");
    expect(preferencesStore.get().lastRoutePath).toBe("/settings");
  });

  it("renders the Voice placeholder as normal shell content with active navigation", async () => {
    const { AppShell, createMemoryShellHistory } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/voice" });
    const preferencesStore = createPreferencesStore();
    const apiClient = createShellApiClient({
      getStatus: vi.fn(async () => {
        throw new Error("Status unavailable while opening Voice.");
      }),
    });

    const html = renderShell(AppShell, { apiClient, history, preferencesStore });
    const text = textContent(html);

    expect(history.location.pathname).toBe("/voice");
    expect(html).toContain(">Voice</h1>");
    expect(html).toMatch(/<a\b[^>]*href="\/voice"[^>]*aria-current="page"/);
    expect(text).toContain("Voice profile setup is not part of this shell pass.");
    expect(text).toContain("Back to Writer");
    expect(html).not.toContain('role="alert"');
    expect(text).not.toContain("Route unavailable");
    expect(text).not.toContain("This route could not render.");
    expect(apiClient.generateIdea).not.toHaveBeenCalled();
    expect(apiClient.getSettings).not.toHaveBeenCalled();
    expect(apiClient.saveSettings).not.toHaveBeenCalled();
  });

  it("renders the Post Library placeholder as normal shell content with active navigation", async () => {
    const { AppShell, createMemoryShellHistory } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/library" });
    const preferencesStore = createPreferencesStore();
    const apiClient = createShellApiClient({
      getStatus: vi.fn(async () => {
        throw new Error("Status unavailable while opening Post Library.");
      }),
    });

    const html = renderShell(AppShell, { apiClient, history, preferencesStore });
    const text = textContent(html);

    expect(history.location.pathname).toBe("/library");
    expect(html).toContain(">Post Library</h1>");
    expect(html).toMatch(/<a\b[^>]*href="\/library"[^>]*aria-current="page"/);
    expect(text).toContain("Post memory is reserved for the library feature pass.");
    expect(text).toContain("Back to Writer");
    expect(html).not.toContain('role="alert"');
    expect(text).not.toContain("Route unavailable");
    expect(text).not.toContain("This route could not render.");
    expect(apiClient.generateIdea).not.toHaveBeenCalled();
    expect(apiClient.getSettings).not.toHaveBeenCalled();
    expect(apiClient.saveSettings).not.toHaveBeenCalled();
  });

  it("navigates from the Voice placeholder primary action back to Writer", async () => {
    const {
      AppShell,
      createAppShellPublicDriver,
      createMemoryShellHistory,
    } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/voice" });
    const preferencesStore = createPreferencesStore();
    const driver = createAppShellPublicDriver({
      apiClient: createShellApiClient(),
      history,
      preferencesStore,
      renderShell: AppShell,
    });

    const html = driver.activatePlaceholderPrimaryAction();

    expect(history.location.pathname).toBe("/writer");
    expect(preferencesStore.get().lastRoutePath).toBe("/writer");
    expect(html).toContain(">Writer</h1>");
    expect(html).toMatch(/<a\b[^>]*href="\/writer"[^>]*aria-current="page"/);
  });

  it("navigates from the Post Library placeholder primary action back to Writer", async () => {
    const {
      AppShell,
      createAppShellPublicDriver,
      createMemoryShellHistory,
    } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/library" });
    const preferencesStore = createPreferencesStore();
    const driver = createAppShellPublicDriver({
      apiClient: createShellApiClient(),
      history,
      preferencesStore,
      renderShell: AppShell,
    });

    const html = driver.activatePlaceholderPrimaryAction();

    expect(history.location.pathname).toBe("/writer");
    expect(preferencesStore.get().lastRoutePath).toBe("/writer");
    expect(html).toContain(">Writer</h1>");
    expect(html).toMatch(/<a\b[^>]*href="\/writer"[^>]*aria-current="page"/);
  });
});
