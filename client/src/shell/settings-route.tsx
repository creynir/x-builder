import {
  useEffect,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ApiError,
  AppSettings,
  AppSettingsResponse,
  AppStatus,
  RouteConfig,
  SubsystemStatus,
} from "@x-builder/shared";

import { ApiClientError } from "../api/engine-api-client";
import { Alert, Badge } from "../ui/foundation";

type TextSettingsFieldName = Extract<
  keyof AppSettings,
  "codexCommandLabel" | "engineBaseUrl" | "storagePath"
>;

type SwitchSettingsFieldName = Extract<
  keyof AppSettings,
  "runCodexJudgeAfterGeneration" | "showDeterministicDetails"
>;

export type SettingsRouteApiClient = {
  getSettings: () => Promise<AppSettingsResponse>;
  getStatus: () => Promise<AppStatus>;
  saveSettings: (settings: AppSettings) => Promise<AppSettingsResponse>;
};

export type SettingsRouteProps = {
  apiClient: SettingsRouteApiClient;
  pendingNavigationPath?: RouteConfig["path"] | null;
  openedFrom?: RouteConfig["id"];
  onDirtyChange?: (dirty: boolean) => void;
  onDiscardNavigation?: (to: RouteConfig["path"]) => void;
  onNavigate?: (to: RouteConfig["path"]) => void;
  onNavigateToWriter?: () => void;
  onRequestNavigate?: (to: RouteConfig["path"]) => void;
  onStayOnSettings?: () => void;
  onStatusRefresh?: (status: AppStatus) => void;
};

type SettingsRouteInternalProps = SettingsRouteProps & {
  initialModel?: SettingsRouteModel;
};

export type SettingsRoutePublicDriverOptions = SettingsRouteProps & {
  renderRoute?: (props: SettingsRouteProps) => ReactElement;
};

export type SettingsRoutePublicDriver = {
  backToWriter: () => string;
  discardUnsavedNavigation: () => string;
  load: () => Promise<string>;
  retryLoad: () => Promise<string>;
  save: () => Promise<string>;
  stayOnSettings: () => string;
  testReadiness: () => Promise<string>;
  updateField: (field: TextSettingsFieldName, value: string) => string;
  updateSwitch: (field: SwitchSettingsFieldName, value: boolean) => string;
  useDefaults: () => string;
  warnBeforeNavigateAway: (to: RouteConfig["path"]) => string;
};

type SettingsErrorKind = "load" | "save" | "status";

type SettingsRouteModel = {
  draft: AppSettings;
  engineUrlError: string | null;
  error: ApiError | null;
  errorKind: SettingsErrorKind | null;
  isLoading: boolean;
  isSaving: boolean;
  isTesting: boolean;
  lastReadiness: AppStatus | null;
  pendingNavigationPath: RouteConfig["path"] | null;
  saved: AppSettings;
  source: AppSettingsResponse["source"];
  successMessage: string | null;
};

const defaultSettings: AppSettings = {
  codexCommandLabel: "Codex judge",
  engineBaseUrl: "http://127.0.0.1:4173",
  runCodexJudgeAfterGeneration: false,
  showDeterministicDetails: true,
  storagePath: "~/.x-builder",
};

const localEngineUrlError = "Enter a valid local engine URL.";
const dirtyReadinessHelper = "Save settings before testing readiness.";

function createInitialModel(): SettingsRouteModel {
  return {
    draft: defaultSettings,
    engineUrlError: null,
    error: null,
    errorKind: null,
    isLoading: true,
    isSaving: false,
    isTesting: false,
    lastReadiness: null,
    pendingNavigationPath: null,
    saved: defaultSettings,
    source: "defaults",
    successMessage: null,
  };
}

function modelFromResponse(response: AppSettingsResponse): SettingsRouteModel {
  return {
    ...createInitialModel(),
    draft: response.settings,
    isLoading: false,
    saved: response.settings,
    source: response.source,
  };
}

function modelFromDefaults(): SettingsRouteModel {
  return {
    ...createInitialModel(),
    isLoading: false,
  };
}

function settingsEqual(left: AppSettings, right: AppSettings): boolean {
  return (
    left.codexCommandLabel === right.codexCommandLabel &&
    left.engineBaseUrl === right.engineBaseUrl &&
    left.runCodexJudgeAfterGeneration === right.runCodexJudgeAfterGeneration &&
    left.showDeterministicDetails === right.showDeterministicDetails &&
    left.storagePath === right.storagePath
  );
}

function isLocalEngineUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function normalizeSettingsError(error: unknown, fallback: ApiError): ApiError {
  if (error instanceof ApiClientError) {
    return error.apiError;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "apiError" in error &&
    typeof error.apiError === "object" &&
    error.apiError !== null
  ) {
    return error.apiError as ApiError;
  }

  return fallback;
}

function settingsLoadError(): ApiError {
  return {
    code: "settings_load_failed",
    message: "Settings could not be loaded. Try again.",
    retryable: true,
    scope: "settings",
    status: 500,
  };
}

function settingsPersistError(): ApiError {
  return {
    code: "settings_persist_failed",
    message: "Settings could not be saved. Your edits are still here.",
    retryable: true,
    scope: "settings",
    status: 500,
  };
}

function statusError(): ApiError {
  return {
    code: "status_unavailable",
    message: "Readiness could not be checked. Try again.",
    retryable: true,
    scope: "status",
    status: 503,
  };
}

function withValidatedEngineUrl(model: SettingsRouteModel): SettingsRouteModel {
  return {
    ...model,
    engineUrlError: isLocalEngineUrl(model.draft.engineBaseUrl)
      ? null
      : localEngineUrlError,
  };
}

function updateTextField(
  model: SettingsRouteModel,
  field: TextSettingsFieldName,
  value: string,
): SettingsRouteModel {
  const nextModel = {
    ...model,
    draft: {
      ...model.draft,
      [field]: value,
    },
    error: null,
    errorKind: null,
    pendingNavigationPath: null,
    successMessage: null,
  };

  if (field !== "engineBaseUrl") {
    return nextModel;
  }

  return withValidatedEngineUrl(nextModel);
}

function updateSwitchField(
  model: SettingsRouteModel,
  field: SwitchSettingsFieldName,
  value: boolean,
): SettingsRouteModel {
  return {
    ...model,
    draft: {
      ...model.draft,
      [field]: value,
    },
    error: null,
    errorKind: null,
    pendingNavigationPath: null,
    successMessage: null,
  };
}

function isDirty(model: SettingsRouteModel): boolean {
  return !settingsEqual(model.draft, model.saved);
}

function sourceLabel(source: AppSettingsResponse["source"]): string {
  return source === "defaults" ? "Using defaults" : "Persisted settings";
}

function buttonClassName(variant: "primary" | "secondary" | "ghost" | "danger") {
  return `xb-button xb-button--${variant} xb-button--md`;
}

function fieldId(field: keyof AppSettings): string {
  return `settings-${field}`;
}

function renderTextField({
  error,
  label,
  name,
  onChange,
  value,
}: {
  error?: string | null;
  label: string;
  name: TextSettingsFieldName;
  onChange: (field: TextSettingsFieldName, value: string) => void;
  value: string;
}): ReactElement {
  const id = fieldId(name);
  const errorId = `${id}-error`;

  return (
    <label className="xb-settings-route__field" htmlFor={id}>
      <span className="xb-settings-route__label">{label}</span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
        name={name}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(name, event.target.value);
        }}
        type="text"
        value={value}
      />
      {error ? (
        <span className="xb-settings-route__field-error" id={errorId}>
          {error}
        </span>
      ) : null}
    </label>
  );
}

function renderSwitch({
  checked,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  label: string;
  name: SwitchSettingsFieldName;
  onChange: (field: SwitchSettingsFieldName, value: boolean) => void;
}): ReactElement {
  const id = fieldId(name);

  return (
    <label className="xb-settings-route__switch" htmlFor={id}>
      <span className="xb-settings-route__switch-label">{label}</span>
      <input
        checked={checked}
        id={id}
        name={name}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(name, event.target.checked);
        }}
        type="checkbox"
      />
    </label>
  );
}

function orderedSwitches(settings: AppSettings) {
  return [
    {
      checked: settings.runCodexJudgeAfterGeneration,
      label: "Run Codex judge after generation",
      name: "runCodexJudgeAfterGeneration" as const,
    },
    {
      checked: settings.showDeterministicDetails,
      label: "Show deterministic details",
      name: "showDeterministicDetails" as const,
    },
  ].sort((left, right) => Number(right.checked) - Number(left.checked));
}

function readinessItems(status: AppStatus): SubsystemStatus[] {
  return [status.engine, status.storage, status.codex, status.deterministic];
}

function SettingsRouteView({
  model,
  onBackToWriter,
  onDiscardNavigation,
  onRetryLoad,
  onSave,
  onStayOnSettings,
  onTestReadiness,
  onUpdateField,
  onUpdateSwitch,
  onUseDefaults,
}: {
  model: SettingsRouteModel;
  onBackToWriter: () => void;
  onDiscardNavigation: () => void;
  onRetryLoad: () => void;
  onSave: () => void;
  onStayOnSettings: () => void;
  onTestReadiness: () => void;
  onUpdateField: (field: TextSettingsFieldName, value: string) => void;
  onUpdateSwitch: (field: SwitchSettingsFieldName, value: boolean) => void;
  onUseDefaults: () => void;
}): ReactElement {
  const dirty = isDirty(model);
  const canSave = dirty && model.engineUrlError === null && !model.isSaving;
  const canTestReadiness = !dirty && !model.isTesting && !model.isLoading;
  const errorRecovery = model.error?.retryable ? (
    model.errorKind === "load" ? (
      <>
        <button
          className={buttonClassName("secondary")}
          onClick={onRetryLoad}
          type="button"
        >
          Retry
        </button>
        <button
          className={buttonClassName("ghost")}
          onClick={onUseDefaults}
          type="button"
        >
          Use defaults
        </button>
      </>
    ) : model.errorKind === "status" ? (
      <button
        className={buttonClassName("secondary")}
        onClick={onTestReadiness}
        type="button"
      >
        Retry readiness
      </button>
    ) : (
      <button
        className={buttonClassName("secondary")}
        onClick={onSave}
        type="button"
      >
        Retry save
      </button>
    )
  ) : null;

  return (
    <section className="xb-settings-route">
      <div className="xb-settings-route__header">
        <div className="xb-settings-route__heading">
          <h2>Settings</h2>
          <div className="xb-settings-route__meta">
            <Badge variant={model.source === "defaults" ? "warning" : "success"}>
              {sourceLabel(model.source)}
            </Badge>
            {dirty ? <Badge variant="warning">Unsaved changes</Badge> : null}
            {model.successMessage ? (
              <Badge variant="success">{model.successMessage}</Badge>
            ) : null}
          </div>
        </div>
        <button
          className={buttonClassName("ghost")}
          onClick={onBackToWriter}
          type="button"
        >
          Back to Writer
        </button>
      </div>

      {model.error ? (
        <Alert
          recovery={errorRecovery}
          title="Settings unavailable"
          variant="danger"
        >
          {model.error.message}
        </Alert>
      ) : null}

      {model.pendingNavigationPath ? (
        <Alert
          recovery={
            <>
              <button
                className={buttonClassName("secondary")}
                onClick={onStayOnSettings}
                type="button"
              >
                Stay on Settings
              </button>
              <button
                className={buttonClassName("danger")}
                onClick={onDiscardNavigation}
                type="button"
              >
                Discard changes
              </button>
            </>
          }
          title="You have unsaved settings changes."
          variant="warning"
        >
          Save or discard them before leaving.
        </Alert>
      ) : null}

      <div className="xb-settings-route__form" aria-busy={model.isLoading}>
        {renderTextField({
          error: model.engineUrlError,
          label: "Engine URL",
          name: "engineBaseUrl",
          onChange: onUpdateField,
          value: model.draft.engineBaseUrl,
        })}
        {renderTextField({
          label: "Storage path",
          name: "storagePath",
          onChange: onUpdateField,
          value: model.draft.storagePath,
        })}
        {renderTextField({
          label: "Codex command label",
          name: "codexCommandLabel",
          onChange: onUpdateField,
          value: model.draft.codexCommandLabel,
        })}

        <div className="xb-settings-route__switches">
          {orderedSwitches(model.draft).map((switchConfig) =>
            <div key={switchConfig.name}>
              {renderSwitch({
                ...switchConfig,
                onChange: onUpdateSwitch,
              })}
            </div>,
          )}
        </div>
      </div>

      <div className="xb-settings-route__actions">
        <button
          className={buttonClassName("primary")}
          disabled={!canSave}
          onClick={onSave}
          type="button"
        >
          Save settings
        </button>
        <button
          className={buttonClassName("secondary")}
          disabled={!canTestReadiness}
          onClick={onTestReadiness}
          type="button"
        >
          Test readiness
        </button>
        {dirty ? (
          <span className="xb-settings-route__helper">
            {dirtyReadinessHelper}
          </span>
        ) : null}
      </div>

      {model.lastReadiness ? (
        <div className="xb-settings-route__readiness" aria-live="polite">
          {readinessItems(model.lastReadiness).map((item) => (
            <Badge
              key={item.label}
              variant={item.state === "ready" ? "success" : "warning"}
            >
              {item.label} {item.state}
            </Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsRoute({
  apiClient,
  initialModel,
  onDirtyChange,
  onDiscardNavigation,
  onNavigate,
  onNavigateToWriter,
  onRequestNavigate,
  onStayOnSettings,
  onStatusRefresh,
  pendingNavigationPath,
}: SettingsRouteInternalProps): ReactElement {
  const [model, setModel] = useState(initialModel ?? createInitialModel);
  const dirty = isDirty(model);
  const visiblePendingNavigationPath =
    pendingNavigationPath ?? model.pendingNavigationPath;

  useEffect(() => {
    if (initialModel !== undefined) {
      return;
    }

    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await apiClient.getSettings();

        if (!cancelled) {
          setModel(modelFromResponse(response));
        }
      } catch (error) {
        if (!cancelled) {
          setModel({
            ...createInitialModel(),
            error: normalizeSettingsError(error, settingsLoadError()),
            errorKind: "load",
            isLoading: false,
          });
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [apiClient, initialModel]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleLoadSettings = async () => {
    setModel((current) => ({
      ...current,
      error: null,
      errorKind: null,
      isLoading: true,
      successMessage: null,
    }));

    try {
      const response = await apiClient.getSettings();

      setModel(modelFromResponse(response));
    } catch (error) {
      setModel({
        ...createInitialModel(),
        error: normalizeSettingsError(error, settingsLoadError()),
        errorKind: "load",
        isLoading: false,
      });
    }
  };

  const handleUseDefaults = () => {
    setModel(modelFromDefaults());
  };

  const navigateTo = (to: RouteConfig["path"]) => {
    onNavigate?.(to);

    if (to === "/writer") {
      onNavigateToWriter?.();
    }
  };

  const requestNavigation = (to: RouteConfig["path"]) => {
    if (onRequestNavigate !== undefined) {
      onRequestNavigate(to);
      return;
    }

    if (dirty) {
      setModel((current) => ({
        ...current,
        pendingNavigationPath: to,
      }));
      return;
    }

    navigateTo(to);
  };

  const handleSave = async () => {
    setModel((current) =>
      withValidatedEngineUrl({
        ...current,
        error: null,
        errorKind: null,
        isSaving: true,
      }),
    );

    if (!isLocalEngineUrl(model.draft.engineBaseUrl)) {
      setModel((current) => ({
        ...withValidatedEngineUrl(current),
        isSaving: false,
      }));
      return;
    }

    try {
      const response = await apiClient.saveSettings(model.draft);
      const status = await apiClient.getStatus();
      onStatusRefresh?.(status);
      setModel({
        ...modelFromResponse(response),
        lastReadiness: status,
        successMessage: "Settings saved",
      });
    } catch (error) {
      setModel((current) => ({
        ...current,
        error: normalizeSettingsError(error, settingsPersistError()),
        errorKind: "save",
        isSaving: false,
      }));
    }
  };

  const handleTestReadiness = async () => {
    if (isDirty(model)) {
      return;
    }

    setModel((current) => ({
      ...current,
      error: null,
      errorKind: null,
      isTesting: true,
    }));

    try {
      const status = await apiClient.getStatus();
      onStatusRefresh?.(status);
      setModel((current) => ({
        ...current,
        isTesting: false,
        lastReadiness: status,
      }));
    } catch (error) {
      setModel((current) => ({
        ...current,
        error: normalizeSettingsError(error, statusError()),
        errorKind: "status",
        isTesting: false,
      }));
    }
  };

  return (
    <SettingsRouteView
      model={{
        ...model,
        pendingNavigationPath: visiblePendingNavigationPath,
      }}
      onBackToWriter={() => {
        requestNavigation("/writer");
      }}
      onDiscardNavigation={() => {
        if (visiblePendingNavigationPath === null) {
          return;
        }

        if (onDiscardNavigation !== undefined) {
          onDiscardNavigation(visiblePendingNavigationPath);
          return;
        }

        setModel((current) => ({
          ...current,
          pendingNavigationPath: null,
        }));
        navigateTo(visiblePendingNavigationPath);
      }}
      onRetryLoad={() => {
        void handleLoadSettings();
      }}
      onSave={() => {
        void handleSave();
      }}
      onStayOnSettings={() => {
        onStayOnSettings?.();
        setModel((current) => ({ ...current, pendingNavigationPath: null }));
      }}
      onTestReadiness={() => {
        void handleTestReadiness();
      }}
      onUpdateField={(field, value) => {
        setModel((current) => updateTextField(current, field, value));
      }}
      onUpdateSwitch={(field, value) => {
        setModel((current) => updateSwitchField(current, field, value));
      }}
      onUseDefaults={handleUseDefaults}
    />
  );
}

function renderDriverRoute(
  options: SettingsRoutePublicDriverOptions,
  model: SettingsRouteModel,
): string {
  const renderRoute = options.renderRoute ?? SettingsRoute;
  const RouteComponent = renderRoute;
  const props = {
    apiClient: options.apiClient,
    initialModel: model,
    openedFrom: options.openedFrom,
    onNavigateToWriter: options.onNavigateToWriter,
    onNavigate: options.onNavigate,
    onStatusRefresh: options.onStatusRefresh,
  };

  return renderToStaticMarkup(
    <RouteComponent {...(props as SettingsRouteProps)} />,
  );
}

export function createSettingsRoutePublicDriver(
  options: SettingsRoutePublicDriverOptions,
): SettingsRoutePublicDriver {
  let model = createInitialModel();
  let pendingNavigationPath: RouteConfig["path"] | null = null;

  const render = () => renderDriverRoute(options, {
    ...model,
    pendingNavigationPath,
  });

  return {
    backToWriter: () => {
      if (isDirty(model)) {
        pendingNavigationPath = "/writer";
        return render();
      }

      options.onNavigate?.("/writer");
      options.onNavigateToWriter?.();
      return render();
    },
    discardUnsavedNavigation: () => {
      const target = pendingNavigationPath;

      if (target !== null) {
        options.onNavigate?.(target);
      }

      if (pendingNavigationPath === "/writer") {
        options.onNavigateToWriter?.();
      }

      pendingNavigationPath = null;
      return render();
    },
    load: async () => {
      try {
        const response = await options.apiClient.getSettings();
        model = modelFromResponse(response);
      } catch (error) {
        model = {
          ...createInitialModel(),
          error: normalizeSettingsError(error, settingsLoadError()),
          errorKind: "load",
          isLoading: false,
        };
      }
      return render();
    },
    retryLoad: async () => {
      try {
        const response = await options.apiClient.getSettings();
        model = modelFromResponse(response);
      } catch (error) {
        model = {
          ...createInitialModel(),
          error: normalizeSettingsError(error, settingsLoadError()),
          errorKind: "load",
          isLoading: false,
        };
      }
      return render();
    },
    save: async () => {
      model = withValidatedEngineUrl(model);

      if (model.engineUrlError !== null) {
        return render();
      }

      try {
        const response = await options.apiClient.saveSettings(model.draft);
        const status = await options.apiClient.getStatus();
        options.onStatusRefresh?.(status);
        model = {
          ...modelFromResponse(response),
          lastReadiness: status,
          successMessage: "Settings saved",
        };
      } catch (error) {
        model = {
          ...model,
          error: normalizeSettingsError(error, settingsPersistError()),
          errorKind: "save",
        };
      }

      return render();
    },
    stayOnSettings: () => {
      pendingNavigationPath = null;
      return render();
    },
    testReadiness: async () => {
      if (isDirty(model)) {
        return render();
      }

      try {
        const status = await options.apiClient.getStatus();
        options.onStatusRefresh?.(status);
        model = {
          ...model,
          error: null,
          lastReadiness: status,
        };
      } catch (error) {
        model = {
          ...model,
          error: normalizeSettingsError(error, statusError()),
          errorKind: "status",
        };
      }

      return render();
    },
    updateField: (field, value) => {
      model = updateTextField(model, field, value);
      return render();
    },
    updateSwitch: (field, value) => {
      model = updateSwitchField(model, field, value);
      return render();
    },
    useDefaults: () => {
      model = modelFromDefaults();
      return render();
    },
    warnBeforeNavigateAway: (to) => {
      if (isDirty(model)) {
        pendingNavigationPath = to;
      }

      return render();
    },
  };
}
