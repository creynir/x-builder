import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ApiError,
  AppSettings,
  AppSettingsResponse,
  AppStatus,
  JudgeProviderId,
  RouteConfig,
} from "@x-builder/shared";
import { judgeProviderIdSchema, judgeProviderLabels } from "@x-builder/shared";

import {
  createShellPreferencesStore,
  type ShellPreferencesStore,
} from "../shell-preferences";

const settingsRouteModulePath = "../settings-route";
const appShellModulePath = "../app-shell";

type SettingsFieldName = keyof AppSettings;
type TextSettingsFieldName = Extract<
  SettingsFieldName,
  "engineBaseUrl" | "storagePath" | "codexModel" | "claudeModel" | "cursorModel"
>;
type SwitchSettingsFieldName = Extract<
  SettingsFieldName,
  "showDeterministicDetails"
>;
type SelectSettingsFieldName = Extract<SettingsFieldName, "judgeProvider">;

type SettingsApiClient = {
  getSettings: () => Promise<AppSettingsResponse>;
  getStatus: () => Promise<AppStatus>;
  saveSettings: (settings: AppSettings) => Promise<AppSettingsResponse>;
};

type SettingsRouteProps = {
  apiClient: SettingsApiClient;
  openedFrom?: RouteConfig["id"];
  onNavigate?: (to: RouteConfig["path"]) => void;
  onNavigateToWriter?: () => void;
  onStatusRefresh?: (status: AppStatus) => void;
};

type SettingsRoutePublicDriverOptions = SettingsRouteProps & {
  renderRoute?: (props: SettingsRouteProps) => ReactElement;
};

type SettingsRoutePublicDriver = {
  backToWriter: () => string;
  discardUnsavedNavigation: () => string;
  load: () => Promise<string>;
  retryLoad: () => Promise<string>;
  save: () => Promise<string>;
  stayOnSettings: () => string;
  testReadiness: () => Promise<string>;
  updateField: (field: TextSettingsFieldName, value: string) => string;
  updateSelect: (field: SelectSettingsFieldName, value: JudgeProviderId) => string;
  updateSwitch: (field: SwitchSettingsFieldName, value: boolean) => string;
  useDefaults: () => string;
  warnBeforeNavigateAway: (to: RouteConfig["path"]) => string;
};

type SettingsRouteModule = {
  SettingsRoute: (props: SettingsRouteProps) => ReactElement;
  createSettingsRoutePublicDriver: (
    options: SettingsRoutePublicDriverOptions,
  ) => SettingsRoutePublicDriver;
};

type ShellHistory = {
  location: {
    pathname: string;
  };
};

type AppShellProps = {
  apiClient: SettingsApiClient;
  history: ShellHistory;
  preferencesStore: ShellPreferencesStore;
};

type AppShellModule = {
  AppShell: (props: AppShellProps) => ReactElement;
  createMemoryShellHistory: (options: { initialPath: string }) => ShellHistory;
};

async function loadSettingsRoute() {
  return (await import(settingsRouteModulePath)) as SettingsRouteModule;
}

async function loadAppShell() {
  return (await import(appShellModulePath)) as AppShellModule;
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function expectInputValue(html: string, label: string, value: string) {
  expect(textContent(html)).toContain(label);
  expect(html).toContain(`value="${value.replaceAll('"', "&quot;")}"`);
}

const bannedJudgeJargon = /codex exec|raw llm|llm judge|judge retry|retry judge/i;

function selectMarkup(html: string): string {
  const match = html.match(/<select\b[\s\S]*?<\/select>/);

  if (match === null) {
    throw new Error("Expected a <select> element in the Settings markup.");
  }

  return match[0];
}

function optionLabel(selectHtml: string, value: string): string {
  const match = selectHtml.match(
    new RegExp(`<option\\b[^>]*value="${value}"[^>]*>([^<]*)</option>`),
  );

  if (match === null || match[1] === undefined) {
    throw new Error(`Expected an <option> for value "${value}".`);
  }

  return match[1];
}

function optionCount(selectHtml: string): number {
  return (selectHtml.match(/<option\b/g) ?? []).length;
}

function selectedOptionValue(selectHtml: string): string | null {
  const match = selectHtml.match(/<option\b[^>]*value="([^"]*)"[^>]*selected/);

  return match?.[1] ?? null;
}

function expectChecked(html: string, label: string, checked: boolean) {
  expect(textContent(html)).toContain(label);

  if (checked) {
    expect(html).toMatch(new RegExp(`${label}[\\s\\S]*checked=""`));
    return;
  }

  expect(html).not.toMatch(new RegExp(`${label}[\\s\\S]*checked=""`));
}

function createDefaultSettings(): AppSettings {
  return {
    claudeModel: "",
    codexModel: "",
    cursorModel: "",
    engineBaseUrl: "http://127.0.0.1:4173",
    judgeProvider: "codex-cli",
    showDeterministicDetails: true,
    storagePath: "/tmp/x-builder-test-storage",
  };
}

function createSavedSettings(): AppSettings {
  return {
    claudeModel: "",
    codexModel: "",
    cursorModel: "",
    engineBaseUrl: "http://localhost:5123",
    judgeProvider: "codex-cli",
    showDeterministicDetails: false,
    storagePath: "/tmp/x-builder-saved-storage",
  };
}

function settingsResponse(
  settings: AppSettings,
  source: AppSettingsResponse["source"],
): AppSettingsResponse {
  return {
    settings,
    source,
    updatedAt: source === "persisted" ? "2026-06-06T12:00:00.000Z" : undefined,
  };
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
    llm: subsystem("Codex judge", "ready"),
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
    code: "settings_persist_failed",
    message: "Settings could not be saved. Your edits are still here.",
    retryable: true,
    scope: "settings",
    status: 500,
    ...overrides,
  };
}

function createApiClient(
  overrides: Partial<SettingsApiClient> = {},
): SettingsApiClient {
  return {
    getSettings: vi.fn(async () =>
      settingsResponse(createDefaultSettings(), "defaults"),
    ),
    getStatus: vi.fn(async () => createReadyStatus()),
    saveSettings: vi.fn(async (settings: AppSettings) =>
      settingsResponse(settings, "persisted"),
    ),
    ...overrides,
  };
}

function createPreferencesStore() {
  const entries = new Map<string, string>();

  return createShellPreferencesStore({
    storage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        entries.set(key, value);
      },
    },
    storageKey: "x-builder:test-settings-route",
  });
}

function createDriver(
  createSettingsRoutePublicDriver: SettingsRouteModule["createSettingsRoutePublicDriver"],
  options: SettingsRoutePublicDriverOptions,
) {
  return createSettingsRoutePublicDriver(options);
}

describe("SettingsRoute public behavior", () => {
  it("loads default settings and renders clean field values", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const defaultSettings = createDefaultSettings();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () => settingsResponse(defaultSettings, "defaults")),
    });

    const html = await createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    }).load();
    const text = textContent(html);

    expect(apiClient.getSettings).toHaveBeenCalledOnce();
    expect(text).toContain("Settings");
    expect(text).toContain("Using defaults");
    expect(text).not.toContain("Unsaved changes");
    expect(html).toMatch(/<button\b[^>]*disabled=""[^>]*>Save settings/);
    expectInputValue(html, "Engine URL", defaultSettings.engineBaseUrl);
    expectInputValue(html, "Storage path", defaultSettings.storagePath);
    expect(text).not.toContain("Codex command label");
    expectChecked(
      html,
      "Show deterministic details",
      defaultSettings.showDeterministicDetails,
    );
  });

  it("retries settings load failures without saving defaults", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const loadError = createApiError({
      code: "settings_load_failed",
      message: "Settings could not be loaded. Try again.",
      retryable: true,
      scope: "settings",
      status: 500,
    });
    const savedSettings = createSavedSettings();
    const apiClient = createApiClient({
      getSettings: vi
        .fn<SettingsApiClient["getSettings"]>()
        .mockImplementationOnce(async () => {
          throw Object.assign(new Error(loadError.message), {
            apiError: loadError,
          });
        })
        .mockImplementationOnce(async () =>
          settingsResponse(savedSettings, "persisted"),
        ),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    const failedHtml = await driver.load();
    const failedText = textContent(failedHtml);

    expect(failedText).toContain("Settings could not be loaded. Try again.");
    expect(failedText).toContain("Retry");
    expect(failedText).toContain("Use defaults");
    expect(failedText).not.toContain("Retry save");

    const retriedHtml = await driver.retryLoad();

    expect(apiClient.getSettings).toHaveBeenCalledTimes(2);
    expect(apiClient.saveSettings).not.toHaveBeenCalled();
    expectInputValue(retriedHtml, "Engine URL", savedSettings.engineBaseUrl);
    expectInputValue(retriedHtml, "Storage path", savedSettings.storagePath);
    expect(textContent(retriedHtml)).toContain("Persisted settings");
  });

  it("lets a failed settings load continue with defaults without calling save", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const loadError = createApiError({
      code: "settings_load_failed",
      message: "Settings could not be loaded. Try again.",
      retryable: true,
      scope: "settings",
      status: 500,
    });
    const apiClient = createApiClient({
      getSettings: vi.fn(async () => {
        throw Object.assign(new Error(loadError.message), {
          apiError: loadError,
        });
      }),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    const defaultsHtml = driver.useDefaults();
    const defaultsText = textContent(defaultsHtml);

    expect(apiClient.saveSettings).not.toHaveBeenCalled();
    expect(defaultsText).toContain("Using defaults");
    expect(defaultsText).not.toContain("Settings could not be loaded");
    expect(defaultsText).not.toContain("Unsaved changes");
    expectInputValue(defaultsHtml, "Engine URL", createDefaultSettings().engineBaseUrl);
  });

  it("renders dirty valid edits and saves them through the backend settings boundary", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const savedSettings = createSavedSettings();
    const apiClient = createApiClient();
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("engineBaseUrl", savedSettings.engineBaseUrl);
    driver.updateField("storagePath", savedSettings.storagePath);
    const dirtyHtml = driver.updateSwitch(
      "showDeterministicDetails",
      savedSettings.showDeterministicDetails,
    );

    expect(textContent(dirtyHtml)).toContain("Unsaved changes");
    expect(dirtyHtml).toMatch(/<button\b(?![^>]*disabled)[^>]*>Save settings/);

    const savedHtml = await driver.save();

    expect(apiClient.saveSettings).toHaveBeenCalledWith(savedSettings);
    expect(textContent(savedHtml)).toContain("Settings saved");
    expect(textContent(savedHtml)).not.toContain("Unsaved changes");
    expect(savedHtml).toMatch(/<button\b[^>]*disabled=""[^>]*>Save settings/);
  });

  it("shows inline Engine URL validation and does not submit invalid settings", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const apiClient = createApiClient();
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("engineBaseUrl", "https://engine.example.com");
    const html = await driver.save();
    const text = textContent(html);

    expect(text).toContain("Enter a valid local engine URL.");
    expect(text).toContain("Unsaved changes");
    expect(apiClient.saveSettings).not.toHaveBeenCalled();
  });

  it("keeps edited values visible and shows recovery when save fails", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const saveError = createApiError();
    const apiClient = createApiClient({
      saveSettings: vi.fn(async () => {
        throw Object.assign(new Error(saveError.message), {
          apiError: saveError,
        });
      }),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("storagePath", "/tmp/x-builder-unsaved-storage");
    const html = await driver.save();
    const text = textContent(html);

    expectInputValue(html, "Storage path", "/tmp/x-builder-unsaved-storage");
    expect(text).toContain("Unsaved changes");
    expect(text).toContain("Settings could not be saved. Your edits are still here.");
    expect(text).toContain("Retry save");
    expect(html).toMatch(/<button\b(?![^>]*disabled)[^>]*>Save settings/);
  });

  it("tests readiness only for a clean saved form and publishes the refreshed status", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const readyStatus = createReadyStatus();
    const onStatusRefresh = vi.fn();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createSavedSettings(), "persisted"),
      ),
      getStatus: vi.fn(async () => readyStatus),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      onStatusRefresh,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    const html = await driver.testReadiness();
    const text = textContent(html);

    expect(apiClient.getStatus).toHaveBeenCalledOnce();
    expect(onStatusRefresh).toHaveBeenCalledWith(readyStatus);
    expect(text).toContain("Engine ready");
    expect(text).toContain("Storage ready");
    expect(text).toContain("Codex judge ready");
  });

  it("retries readiness failures through the readiness action, not save", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const readinessError = createApiError({
      code: "status_unavailable",
      message: "Readiness could not be checked. Try again.",
      retryable: true,
      scope: "status",
      status: 503,
    });
    const apiClient = createApiClient({
      getStatus: vi.fn(async () => {
        throw Object.assign(new Error(readinessError.message), {
          apiError: readinessError,
        });
      }),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    const html = await driver.testReadiness();
    const text = textContent(html);

    expect(text).toContain("Readiness could not be checked. Try again.");
    expect(text).toContain("Retry readiness");
    expect(text).not.toContain("Retry save");
    expect(apiClient.saveSettings).not.toHaveBeenCalled();
  });

  it("disables readiness testing for dirty settings with the required helper copy", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const apiClient = createApiClient();
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    const html = driver.updateField("storagePath", "/tmp/x-builder-dirty-storage");

    expect(textContent(html)).toContain("Save settings before testing readiness.");
    expect(html).toMatch(/<button\b[^>]*disabled=""[^>]*>Test readiness/);

    await driver.testReadiness();

    expect(apiClient.getStatus).not.toHaveBeenCalled();
  });

  it("refreshes status after a successful save without auto-returning to Studio", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const readyStatus = createReadyStatus();
    const onNavigateToWriter = vi.fn();
    const onStatusRefresh = vi.fn();
    const apiClient = createApiClient({
      getStatus: vi.fn(async () => readyStatus),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      onNavigateToWriter,
      onStatusRefresh,
      openedFrom: "writer",
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("storagePath", "/tmp/x-builder-saved-after-repair");
    const savedHtml = await driver.save();

    expect(apiClient.getStatus).toHaveBeenCalledOnce();
    expect(onStatusRefresh).toHaveBeenCalledWith(readyStatus);
    expect(textContent(savedHtml)).toContain("Back to Studio");
    expect(onNavigateToWriter).not.toHaveBeenCalled();

    driver.backToWriter();

    expect(onNavigateToWriter).toHaveBeenCalledOnce();
  });

  it("warns before discarding dirty settings during route navigation", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const onNavigateToWriter = vi.fn();
    const apiClient = createApiClient();
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      onNavigateToWriter,
      openedFrom: "writer",
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("storagePath", "/tmp/x-builder-unsaved-route-change");
    const warningHtml = driver.warnBeforeNavigateAway("/writer");
    const warningText = textContent(warningHtml);

    expect(warningText).toContain("You have unsaved settings changes.");
    expect(warningText).toContain("Save or discard them before leaving.");
    expect(warningText).toContain("Stay on Settings");
    expect(warningText).toContain("Discard changes");
    expect(onNavigateToWriter).not.toHaveBeenCalled();

    const stayedHtml = driver.stayOnSettings();

    expect(textContent(stayedHtml)).toContain("Unsaved changes");
    expect(onNavigateToWriter).not.toHaveBeenCalled();

    const discardedHtml = driver.warnBeforeNavigateAway("/writer");
    expect(textContent(discardedHtml)).toContain("Discard changes");

    driver.discardUnsavedNavigation();

    expect(onNavigateToWriter).toHaveBeenCalledOnce();
  });

  it("warns before Back to Studio discards dirty settings", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const onNavigateToWriter = vi.fn();
    const apiClient = createApiClient();
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      onNavigateToWriter,
      openedFrom: "writer",
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("storagePath", "/tmp/x-builder-unsaved-back-action");
    const warningHtml = driver.backToWriter();
    const warningText = textContent(warningHtml);

    expect(warningText).toContain("You have unsaved settings changes.");
    expect(warningText).toContain("Stay on Settings");
    expect(warningText).toContain("Discard changes");
    expect(onNavigateToWriter).not.toHaveBeenCalled();

    driver.discardUnsavedNavigation();

    expect(onNavigateToWriter).toHaveBeenCalledOnce();
  });

  it("discards dirty settings to the originally requested shell route", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const onNavigate = vi.fn();
    const onNavigateToWriter = vi.fn();
    const apiClient = createApiClient();
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      onNavigate,
      onNavigateToWriter,
      openedFrom: "writer",
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("storagePath", "/tmp/x-builder-unsaved-voice-route");
    driver.warnBeforeNavigateAway("/voice");
    driver.discardUnsavedNavigation();

    expect(onNavigate).toHaveBeenCalledWith("/voice");
    expect(onNavigateToWriter).not.toHaveBeenCalled();
  });
});

describe("SettingsRoute rendering", () => {
  it("renders the shell-owned Settings fields and explicit Back to Studio action", async () => {
    const { SettingsRoute } = await loadSettingsRoute();
    const html = renderToStaticMarkup(
      <SettingsRoute
        apiClient={createApiClient()}
        onNavigateToWriter={vi.fn()}
        openedFrom="writer"
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Back to Studio");
    expect(text).toContain("Engine URL");
    expect(text).toContain("Storage path");
    expect(text).not.toContain("Codex command label");
    expect(text).not.toContain("Run Codex judge after generation");
    expect(text).toContain("Show deterministic details");
    expect(text).toContain("Save settings");
    expect(text).toContain("Test readiness");
  });
});

describe("SettingsRoute judge provider selection", () => {
  it("renders the judge provider select with the saved value and one catalog-labeled option per id", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const savedSettings = createSavedSettings();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(savedSettings, "persisted"),
      ),
    });

    const html = await createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    }).load();
    const select = selectMarkup(html);

    expect(textContent(html)).toContain("Judge provider");
    expect(optionCount(select)).toBe(judgeProviderIdSchema.options.length);
    for (const id of judgeProviderIdSchema.options) {
      expect(optionLabel(select, id)).toBe(judgeProviderLabels[id]);
    }
    expect(selectedOptionValue(select)).toBe(savedSettings.judgeProvider);
  });

  it("dirties on a provider change and gates Test readiness behind a save", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createSavedSettings(), "persisted"),
      ),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    const html = driver.updateSelect("judgeProvider", "claude-cli");
    const text = textContent(html);

    expect(text).toContain("Unsaved changes");
    expect(text).toContain("Save settings before testing readiness.");
    expect(html).toMatch(/<button\b[^>]*disabled=""[^>]*>Test readiness/);
    expect(selectedOptionValue(selectMarkup(html))).toBe("claude-cli");

    await driver.testReadiness();

    expect(apiClient.getStatus).not.toHaveBeenCalled();
  });

  it("saves a provider change with the new id and publishes the refreshed status", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const readyStatus = createReadyStatus();
    const onStatusRefresh = vi.fn();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createSavedSettings(), "persisted"),
      ),
      getStatus: vi.fn(async () => readyStatus),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      onStatusRefresh,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateSelect("judgeProvider", "cursor-cli");
    const savedHtml = await driver.save();

    expect(apiClient.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ judgeProvider: "cursor-cli" }),
    );
    expect(onStatusRefresh).toHaveBeenCalledWith(readyStatus);
    expect(textContent(savedHtml)).toContain("Settings saved");
    expect(textContent(savedHtml)).not.toContain("Unsaved changes");
    expect(selectedOptionValue(selectMarkup(savedHtml))).toBe("cursor-cli");
  });

  it("preserves the drafted provider when save fails and re-issues it on retry", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const saveError = createApiError();
    const saveSettings = vi
      .fn<SettingsApiClient["saveSettings"]>()
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error(saveError.message), {
          apiError: saveError,
        });
      })
      .mockImplementationOnce(async (settings) =>
        settingsResponse(settings, "persisted"),
      );
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createSavedSettings(), "persisted"),
      ),
      saveSettings,
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateSelect("judgeProvider", "claude-cli");
    const failedHtml = await driver.save();
    const failedText = textContent(failedHtml);

    expect(failedText).toContain(
      "Settings could not be saved. Your edits are still here.",
    );
    expect(failedText).toContain("Retry save");
    expect(selectedOptionValue(selectMarkup(failedHtml))).toBe("claude-cli");

    const retriedHtml = await driver.save();

    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ judgeProvider: "claude-cli" }),
    );
    expect(textContent(retriedHtml)).toContain("Settings saved");
  });

  it("warns before discarding a dirty provider change and honors Stay then Discard", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const onNavigateToWriter = vi.fn();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createSavedSettings(), "persisted"),
      ),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      onNavigateToWriter,
      openedFrom: "writer",
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateSelect("judgeProvider", "claude-cli");
    const warningHtml = driver.warnBeforeNavigateAway("/writer");
    const warningText = textContent(warningHtml);

    expect(warningText).toContain("You have unsaved settings changes.");
    expect(warningText).toContain("Stay on Settings");
    expect(warningText).toContain("Discard changes");
    expect(onNavigateToWriter).not.toHaveBeenCalled();

    const stayedHtml = driver.stayOnSettings();

    expect(textContent(stayedHtml)).toContain("Unsaved changes");
    expect(onNavigateToWriter).not.toHaveBeenCalled();

    driver.warnBeforeNavigateAway("/writer");
    driver.discardUnsavedNavigation();

    expect(onNavigateToWriter).toHaveBeenCalledOnce();
  });

  it("renders the provider select and model fields without banned judge jargon", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const readyStatus = createReadyStatus();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createSavedSettings(), "persisted"),
      ),
      getStatus: vi.fn(async () => readyStatus),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    const html = await driver.testReadiness();
    const text = textContent(html);

    expect(text).toContain("Judge provider");
    expect(text).toContain("Codex model");
    expect(text).toContain("Claude model");
    expect(text).toContain("Cursor model");
    expect(text).toContain("Leave empty to use the provider's default.");
    for (const id of judgeProviderIdSchema.options) {
      expect(text).toContain(judgeProviderLabels[id]);
    }
    expect(text).not.toMatch(bannedJudgeJargon);
    expect(html).not.toMatch(bannedJudgeJargon);
  });

  it("clears dirty when a model field is reverted and rides the saved value through the PATCH", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const savedSettings = createSavedSettings();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(savedSettings, "persisted"),
      ),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    const dirtyHtml = driver.updateField("codexModel", "gpt-5.2-codex");

    expect(textContent(dirtyHtml)).toContain("Unsaved changes");
    expectInputValue(dirtyHtml, "Codex model", "gpt-5.2-codex");

    const revertedHtml = driver.updateField(
      "codexModel",
      savedSettings.codexModel ?? "",
    );

    expect(textContent(revertedHtml)).not.toContain("Unsaved changes");

    driver.updateField("codexModel", "gpt-5.2-codex");
    await driver.save();

    expect(apiClient.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codexModel: "gpt-5.2-codex" }),
    );
  });

  it("saves an empty model field so the provider runs its default", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const savedSettings = createSavedSettings();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(savedSettings, "persisted"),
      ),
    });
    const driver = createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    });

    await driver.load();
    driver.updateField("codexModel", "gpt-5.2-codex");
    const clearedHtml = driver.updateField("codexModel", "");

    expectInputValue(clearedHtml, "Codex model", "");

    driver.updateField("storagePath", "/tmp/x-builder-empty-model");
    await driver.save();

    const savedDraft = vi.mocked(apiClient.saveSettings).mock.calls.at(-1)?.[0];

    expect(savedDraft).toBeDefined();
    expect(savedDraft?.codexModel ?? "").toBe("");
  });

  it("renders an out-of-catalog persisted provider as a raw option without crashing", async () => {
    const { SettingsRoute, createSettingsRoutePublicDriver } =
      await loadSettingsRoute();
    const forcedSettings = {
      ...createSavedSettings(),
      judgeProvider: "ghost-cli" as JudgeProviderId,
    };
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(forcedSettings, "persisted"),
      ),
    });

    const html = await createDriver(createSettingsRoutePublicDriver, {
      apiClient,
      renderRoute: SettingsRoute,
    }).load();
    const select = selectMarkup(html);

    expect(textContent(html)).toContain("Judge provider");
    expect(selectedOptionValue(select)).toBe("ghost-cli");
  });
});

describe("AppShell Settings integration", () => {
  it("renders SettingsRoute for /settings instead of the placeholder route body", async () => {
    const { AppShell, createMemoryShellHistory } = await loadAppShell();
    const history = createMemoryShellHistory({ initialPath: "/settings" });
    const preferencesStore = createPreferencesStore();

    const html = renderToStaticMarkup(
      <AppShell
        apiClient={createApiClient()}
        history={history}
        preferencesStore={preferencesStore}
      />,
    );
    const text = textContent(html);

    expect(history.location.pathname).toBe("/settings");
    expect(text).toContain("Settings");
    expect(text).toContain("Engine URL");
    expect(text).toContain("Storage path");
    expect(text).not.toContain("Settings workspace");
  });
});
