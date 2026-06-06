import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ApiError,
  AppSettings,
  AppSettingsResponse,
  AppStatus,
  RouteConfig,
} from "@x-builder/shared";

import {
  createShellPreferencesStore,
  type ShellPreferencesStore,
} from "../shell-preferences";

const settingsRouteModulePath = "../settings-route";
const appShellModulePath = "../app-shell";

type SettingsFieldName = keyof AppSettings;

type SettingsRouteSnapshot = {
  backActionLabel: string | null;
  dirty: boolean;
  fieldErrors: Partial<Record<SettingsFieldName, string>>;
  fields: AppSettings;
  readinessHelpText: string | null;
  saveAvailable: boolean;
  saveError: ApiError | null;
  source: AppSettingsResponse["source"] | null;
  status: AppStatus | null;
  testReadinessDisabled: boolean;
};

type SettingsApiClient = {
  getSettings: () => Promise<AppSettingsResponse>;
  getStatus: () => Promise<AppStatus>;
  saveSettings: (settings: AppSettings) => Promise<AppSettingsResponse>;
};

type SettingsRouteControllerOptions = {
  apiClient: SettingsApiClient;
  openedFrom?: RouteConfig["id"];
  onNavigateToWriter?: () => void;
  onStatusRefresh?: (status: AppStatus) => void;
};

type SettingsRouteController = {
  backToWriter: () => void;
  getSnapshot: () => SettingsRouteSnapshot;
  load: () => Promise<SettingsRouteSnapshot>;
  save: () => Promise<SettingsRouteSnapshot>;
  testReadiness: () => Promise<SettingsRouteSnapshot>;
  updateField: (
    field: Extract<SettingsFieldName, "codexCommandLabel" | "engineBaseUrl" | "storagePath">,
    value: string,
  ) => SettingsRouteSnapshot;
  updateSwitch: (
    field: Extract<
      SettingsFieldName,
      "runCodexJudgeAfterGeneration" | "showDeterministicDetails"
    >,
    value: boolean,
  ) => SettingsRouteSnapshot;
};

type SettingsRouteProps = {
  apiClient: SettingsApiClient;
  openedFrom?: RouteConfig["id"];
  onNavigateToWriter?: () => void;
  onStatusRefresh?: (status: AppStatus) => void;
};

type SettingsRouteModule = {
  SettingsRoute: (props: SettingsRouteProps) => ReactElement;
  createSettingsRouteController: (
    options: SettingsRouteControllerOptions,
  ) => SettingsRouteController;
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

function createDefaultSettings(): AppSettings {
  return {
    codexCommandLabel: "Codex judge",
    engineBaseUrl: "http://127.0.0.1:4173",
    runCodexJudgeAfterGeneration: false,
    showDeterministicDetails: true,
    storagePath: "/tmp/x-builder-test-storage",
  };
}

function createSavedSettings(): AppSettings {
  return {
    codexCommandLabel: "Local judge",
    engineBaseUrl: "http://localhost:5123",
    runCodexJudgeAfterGeneration: true,
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

describe("SettingsRoute controller", () => {
  it("loads default settings and exposes clean field values", async () => {
    const { createSettingsRouteController } = await loadSettingsRoute();
    const defaultSettings = createDefaultSettings();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () => settingsResponse(defaultSettings, "defaults")),
    });

    const controller = createSettingsRouteController({ apiClient });
    const snapshot = await controller.load();

    expect(apiClient.getSettings).toHaveBeenCalledOnce();
    expect(snapshot.fields).toEqual(defaultSettings);
    expect(snapshot.source).toBe("defaults");
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.saveAvailable).toBe(false);
    expect(snapshot.testReadinessDisabled).toBe(false);
  });

  it("marks valid edits dirty and saves through the backend settings boundary", async () => {
    const { createSettingsRouteController } = await loadSettingsRoute();
    const savedSettings = createSavedSettings();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createDefaultSettings(), "defaults"),
      ),
    });
    const controller = createSettingsRouteController({ apiClient });

    await controller.load();
    let snapshot = controller.updateField("engineBaseUrl", savedSettings.engineBaseUrl);
    snapshot = controller.updateField("storagePath", savedSettings.storagePath);
    snapshot = controller.updateField(
      "codexCommandLabel",
      savedSettings.codexCommandLabel,
    );
    snapshot = controller.updateSwitch(
      "runCodexJudgeAfterGeneration",
      savedSettings.runCodexJudgeAfterGeneration,
    );
    snapshot = controller.updateSwitch(
      "showDeterministicDetails",
      savedSettings.showDeterministicDetails,
    );

    expect(snapshot.dirty).toBe(true);
    expect(snapshot.saveAvailable).toBe(true);
    expect(snapshot.fieldErrors).toEqual({});

    const savedSnapshot = await controller.save();

    expect(apiClient.saveSettings).toHaveBeenCalledWith(savedSettings);
    expect(savedSnapshot.fields).toEqual(savedSettings);
    expect(savedSnapshot.dirty).toBe(false);
    expect(savedSnapshot.source).toBe("persisted");
  });

  it("shows inline Engine URL validation and does not submit invalid settings", async () => {
    const { createSettingsRouteController } = await loadSettingsRoute();
    const apiClient = createApiClient();
    const controller = createSettingsRouteController({ apiClient });

    await controller.load();
    const dirtySnapshot = controller.updateField(
      "engineBaseUrl",
      "https://engine.example.com",
    );
    const submittedSnapshot = await controller.save();

    expect(dirtySnapshot.dirty).toBe(true);
    expect(submittedSnapshot.fieldErrors.engineBaseUrl).toBe(
      "Enter a valid local engine URL.",
    );
    expect(submittedSnapshot.saveAvailable).toBe(false);
    expect(apiClient.saveSettings).not.toHaveBeenCalled();
  });

  it("keeps edited values visible and shows recovery when save fails", async () => {
    const { createSettingsRouteController } = await loadSettingsRoute();
    const saveError = createApiError();
    const apiClient = createApiClient({
      saveSettings: vi.fn(async () => {
        throw Object.assign(new Error(saveError.message), {
          apiError: saveError,
        });
      }),
    });
    const controller = createSettingsRouteController({ apiClient });

    await controller.load();
    controller.updateField("storagePath", "/tmp/x-builder-unsaved-storage");
    const snapshot = await controller.save();

    expect(snapshot.fields.storagePath).toBe("/tmp/x-builder-unsaved-storage");
    expect(snapshot.dirty).toBe(true);
    expect(snapshot.saveAvailable).toBe(true);
    expect(snapshot.saveError).toEqual(saveError);
  });

  it("tests readiness only for a clean saved form and publishes the refreshed status", async () => {
    const { createSettingsRouteController } = await loadSettingsRoute();
    const readyStatus = createReadyStatus();
    const onStatusRefresh = vi.fn();
    const apiClient = createApiClient({
      getSettings: vi.fn(async () =>
        settingsResponse(createSavedSettings(), "persisted"),
      ),
      getStatus: vi.fn(async () => readyStatus),
    });
    const controller = createSettingsRouteController({
      apiClient,
      onStatusRefresh,
    });

    await controller.load();
    const snapshot = await controller.testReadiness();

    expect(apiClient.getStatus).toHaveBeenCalledOnce();
    expect(onStatusRefresh).toHaveBeenCalledWith(readyStatus);
    expect(snapshot.status).toEqual(readyStatus);
    expect(snapshot.testReadinessDisabled).toBe(false);
  });

  it("disables readiness testing for dirty settings with the required helper copy", async () => {
    const { createSettingsRouteController } = await loadSettingsRoute();
    const apiClient = createApiClient();
    const controller = createSettingsRouteController({ apiClient });

    await controller.load();
    controller.updateField("storagePath", "/tmp/x-builder-dirty-storage");
    const snapshot = await controller.testReadiness();

    expect(snapshot.testReadinessDisabled).toBe(true);
    expect(snapshot.readinessHelpText).toBe(
      "Save settings before testing readiness.",
    );
    expect(apiClient.getStatus).not.toHaveBeenCalled();
  });

  it("refreshes status after a successful save without auto-returning to Writer", async () => {
    const { createSettingsRouteController } = await loadSettingsRoute();
    const readyStatus = createReadyStatus();
    const onNavigateToWriter = vi.fn();
    const onStatusRefresh = vi.fn();
    const apiClient = createApiClient({
      getStatus: vi.fn(async () => readyStatus),
    });
    const controller = createSettingsRouteController({
      apiClient,
      onNavigateToWriter,
      onStatusRefresh,
      openedFrom: "writer",
    });

    await controller.load();
    controller.updateField("storagePath", "/tmp/x-builder-saved-after-repair");
    const snapshot = await controller.save();

    expect(apiClient.getStatus).toHaveBeenCalledOnce();
    expect(onStatusRefresh).toHaveBeenCalledWith(readyStatus);
    expect(snapshot.dirty).toBe(false);
    expect(snapshot.backActionLabel).toBe("Back to Writer");
    expect(onNavigateToWriter).not.toHaveBeenCalled();

    controller.backToWriter();

    expect(onNavigateToWriter).toHaveBeenCalledOnce();
  });
});

describe("SettingsRoute rendering", () => {
  it("renders the shell-owned Settings fields and explicit Back to Writer action", async () => {
    const { SettingsRoute } = await loadSettingsRoute();
    const html = renderToStaticMarkup(
      <SettingsRoute
        apiClient={createApiClient()}
        onNavigateToWriter={vi.fn()}
        openedFrom="writer"
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Back to Writer");
    expect(text).toContain("Engine URL");
    expect(text).toContain("Storage path");
    expect(text).toContain("Codex command label");
    expect(text).toContain("Run Codex judge after generation");
    expect(text).toContain("Show deterministic details");
    expect(text).toContain("Save settings");
    expect(text).toContain("Test readiness");
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
