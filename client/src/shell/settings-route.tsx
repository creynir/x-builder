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

import { judgeProviderIdSchema, judgeProviderLabels } from "@x-builder/shared";

import { ApiClientError } from "../api/engine-api-client";
import { Alert, Badge, Switch } from "../ui/foundation";

type TextSettingsFieldName = Extract<
  keyof AppSettings,
  | "engineBaseUrl"
  | "storagePath"
  | "codexModel"
  | "claudeModel"
  | "cursorModel"
  | "accountProfile"
>;

type SwitchSettingsFieldName = Extract<
  keyof AppSettings,
  "showDeterministicDetails"
>;

type SelectSettingsFieldName = Extract<keyof AppSettings, "judgeProvider">;

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
  updateSelect: (field: SelectSettingsFieldName, value: string) => string;
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
  accountProfile: "",
  claudeModel: "",
  codexModel: "",
  cursorModel: "",
  engineBaseUrl: "http://127.0.0.1:4173",
  judgeProvider: "codex-cli",
  showDeterministicDetails: true,
  storagePath: "~/.x-builder",
};

const localEngineUrlError = "Enter a valid local engine URL.";
const dirtyReadinessHelper = "Save settings before testing readiness.";
const judgeProviderHelper =
  "Save, then run Test readiness to verify the provider.";
const modelFieldHelper = "Leave empty to use the provider's default.";
const accountProfileHelper =
  "Describe your audience and niche. The judge uses this to score audience match.";

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
    left.engineBaseUrl === right.engineBaseUrl &&
    left.judgeProvider === right.judgeProvider &&
    left.codexModel === right.codexModel &&
    left.claudeModel === right.claudeModel &&
    left.cursorModel === right.cursorModel &&
    left.accountProfile === right.accountProfile &&
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

function updateSelectField(
  model: SettingsRouteModel,
  field: SelectSettingsFieldName,
  value: string,
): SettingsRouteModel {
  return {
    ...model,
    draft: {
      ...model.draft,
      // The select boundary speaks raw strings; the enum carries the value so
      // an out-of-catalog persisted id round-trips without being swapped.
      [field]: value as AppSettings[SelectSettingsFieldName],
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

function renderTextAreaField({
  helper,
  label,
  name,
  onChange,
  value,
}: {
  helper: string;
  label: string;
  name: TextSettingsFieldName;
  onChange: (field: TextSettingsFieldName, value: string) => void;
  value: string;
}): ReactElement {
  const id = fieldId(name);
  const helperId = `${id}-helper`;

  return (
    <label className="xb-settings-route__field" htmlFor={id}>
      <span className="xb-settings-route__label">{label}</span>
      <textarea
        aria-describedby={helperId}
        id={id}
        name={name}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          onChange(name, event.target.value);
        }}
        rows={3}
        value={value}
      />
      <span className="xb-settings-route__helper" id={helperId}>
        {helper}
      </span>
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
  return (
    <Switch
      checked={checked}
      id={fieldId(name)}
      label={label}
      name={name}
      onChange={(value) => {
        onChange(name, value);
      }}
    />
  );
}

function renderFieldHelper(text: string): ReactElement {
  return <span className="xb-settings-route__helper">{text}</span>;
}

function renderSelectField({
  helper,
  label,
  name,
  onChange,
  value,
}: {
  helper: string;
  label: string;
  name: SelectSettingsFieldName;
  onChange: (field: SelectSettingsFieldName, value: string) => void;
  value: string;
}): ReactElement {
  const id = fieldId(name);
  const options = judgeProviderIdSchema.options.map((optionId) => ({
    label: judgeProviderLabels[optionId],
    value: optionId as string,
  }));
  const inCatalog = options.some((option) => option.value === value);
  const renderedOptions = inCatalog
    ? options
    : [...options, { label: value, value }];

  return (
    <label className="xb-settings-route__field" htmlFor={id}>
      <span className="xb-settings-route__label">{label}</span>
      <select
        id={id}
        name={name}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          onChange(name, event.target.value);
        }}
        value={value}
      >
        {renderedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {renderFieldHelper(helper)}
    </label>
  );
}

function orderedSwitches(settings: AppSettings) {
  return [
    {
      checked: settings.showDeterministicDetails,
      label: "Show deterministic details",
      name: "showDeterministicDetails" as const,
    },
  ];
}

function readinessItems(status: AppStatus): SubsystemStatus[] {
  return [status.engine, status.storage, status.llm, status.deterministic];
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
  onUpdateSelect,
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
  onUpdateSelect: (field: SelectSettingsFieldName, value: string) => void;
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
          Back to Studio
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
        {renderSelectField({
          helper: judgeProviderHelper,
          label: "Judge provider",
          name: "judgeProvider",
          onChange: onUpdateSelect,
          value: model.draft.judgeProvider,
        })}
        {renderTextAreaField({
          helper: accountProfileHelper,
          label: "Account profile",
          name: "accountProfile",
          onChange: onUpdateField,
          value: model.draft.accountProfile ?? "",
        })}

        <div className="xb-settings-route__models">
          {renderTextField({
            label: "Codex model",
            name: "codexModel",
            onChange: onUpdateField,
            value: model.draft.codexModel ?? "",
          })}
          {renderTextField({
            label: "Claude model",
            name: "claudeModel",
            onChange: onUpdateField,
            value: model.draft.claudeModel ?? "",
          })}
          {renderTextField({
            label: "Cursor model",
            name: "cursorModel",
            onChange: onUpdateField,
            value: model.draft.cursorModel ?? "",
          })}
          {renderFieldHelper(modelFieldHelper)}
        </div>

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
      onUpdateSelect={(field, value) => {
        setModel((current) => updateSelectField(current, field, value));
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
    updateSelect: (field, value) => {
      model = updateSelectField(model, field, value);
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
