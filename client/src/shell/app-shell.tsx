import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiError, AppStatus, RouteConfig } from "@x-builder/shared";

import { EngineApiClient } from "../api/engine-api-client";
import {
  WriterPage,
  createWriterPagePublicDriver,
  type WriterApiClient,
} from "../features/writer/writer-page";
import { Button, EmptyState } from "../ui/foundation";
import { appRoutes, resolveRoutePath } from "./route-registry";
import { RouteErrorBanner } from "./route-error-banner";
import {
  SettingsRoute,
  type SettingsRouteApiClient,
} from "./settings-route";
import {
  createShellPreferencesStore,
  type ShellPreferencesStore,
} from "./shell-preferences";
import type { EngineStatusClient } from "./status-bar";

export type ShellHistory = {
  location: {
    pathname: string;
  };
  push?: (path: RouteConfig["path"]) => void;
  replace?: (path: RouteConfig["path"]) => void;
  subscribe?: (listener: () => void) => () => void;
};

export type RouteHeadingFocusTarget = {
  routeId: RouteConfig["id"];
  headingId: string;
  headingText: string;
};

export type ShellRouteComponentProps = {
  route: RouteConfig;
};

export type ShellRouteComponents = Partial<
  Record<RouteConfig["id"], (props: ShellRouteComponentProps) => ReactElement>
>;

export type AppShellProps = {
  apiClient?: EngineStatusClient &
    Partial<SettingsRouteApiClient> &
    Partial<WriterApiClient>;
  history: ShellHistory;
  preferencesStore: ShellPreferencesStore;
  routeComponents?: ShellRouteComponents;
  onRouteHeadingFocus?: (target: RouteHeadingFocusTarget) => void;
};

export type AppShellPublicDriverOptions = AppShellProps & {
  renderShell?: (props: AppShellProps) => ReactElement;
};

export type AppShellPublicDriver = {
  activatePlaceholderPrimaryAction: () => string;
  generateWriterIdea: () => Promise<string>;
  openWriterErrorSettings: () => string;
  updateWriterIdea: (idea: string) => string;
};

export type CreateMemoryShellHistoryOptions = {
  initialPath: string;
};

export type NavigateShellRouteOptions = {
  history: ShellHistory;
  preferencesStore: ShellPreferencesStore;
  to: RouteConfig["path"];
  focusRouteHeading: (target: RouteHeadingFocusTarget) => void;
};

export type GuardSettingsNavigationOptions = {
  activeRouteId: RouteConfig["id"];
  isSettingsDirty: boolean;
  onNavigate: (to: RouteConfig["path"]) => void;
  onWarnUnsavedSettings: (to: RouteConfig["path"]) => void;
  to: RouteConfig["path"];
};

type ShellHistoryState = ShellHistory & {
  notify: () => void;
};

const browserStorageKey = "x-builder:shell-preferences";
const defaultEngineBaseUrl = "http://127.0.0.1:4173";

function createHistoryState(initialPath: string): ShellHistoryState {
  const listeners = new Set<() => void>();
  const initialResolution = resolveRoutePath(initialPath);
  const history: ShellHistoryState = {
    location: {
      pathname: initialResolution.canonicalPath,
    },
    notify: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    push: (path) => {
      history.location.pathname = path;
      history.notify();
    },
    replace: (path) => {
      history.location.pathname = path;
      history.notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };

  return history;
}

export function createMemoryShellHistory({
  initialPath,
}: CreateMemoryShellHistoryOptions): ShellHistory {
  return createHistoryState(initialPath);
}

export function createBrowserShellHistory(): ShellHistory {
  if (typeof window === "undefined") {
    return createMemoryShellHistory({ initialPath: "/writer" });
  }

  const initialResolution = resolveRoutePath(window.location.pathname);
  const history = createHistoryState(initialResolution.canonicalPath);
  const push = history.push;
  const replace = history.replace;

  if (initialResolution.shouldReplace) {
    window.history.replaceState(null, "", initialResolution.canonicalPath);
  }

  history.push = (path) => {
    window.history.pushState(null, "", path);
    push?.(path);
  };
  history.replace = (path) => {
    window.history.replaceState(null, "", path);
    replace?.(path);
  };

  window.addEventListener("popstate", () => {
    history.location.pathname = window.location.pathname;
    history.notify();
  });

  return history;
}

export function createBrowserShellPreferencesStore(): ShellPreferencesStore {
  if (typeof window === "undefined") {
    return createShellPreferencesStore({
      storage: createMemoryPreferenceStorage(),
      storageKey: browserStorageKey,
    });
  }

  return createShellPreferencesStore({
    storage: window.localStorage,
    storageKey: browserStorageKey,
  });
}

function createMemoryPreferenceStorage() {
  const entries = new Map<string, string>();

  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

function headingTargetForRoute(route: RouteConfig): RouteHeadingFocusTarget {
  return {
    routeId: route.id,
    headingId: `route-heading-${route.id}`,
    headingText: route.title,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setHistoryPath(
  history: ShellHistory,
  path: RouteConfig["path"],
  action: "push" | "replace",
) {
  const handler = action === "push" ? history.push : history.replace;

  if (handler !== undefined) {
    handler(path);
    return;
  }

  history.location.pathname = path;
}

export function navigateShellRoute({
  focusRouteHeading,
  history,
  preferencesStore,
  to,
}: NavigateShellRouteOptions): void {
  const resolution = resolveRoutePath(to);

  setHistoryPath(history, resolution.canonicalPath, "push");
  preferencesStore.set({
    ...preferencesStore.get(),
    lastRoutePath: resolution.canonicalPath,
  });
  focusRouteHeading(headingTargetForRoute(resolution.route));
}

export function guardSettingsNavigation({
  activeRouteId,
  isSettingsDirty,
  onNavigate,
  onWarnUnsavedSettings,
  to,
}: GuardSettingsNavigationOptions): "navigated" | "warned" {
  const resolution = resolveRoutePath(to);

  if (
    activeRouteId === "settings" &&
    isSettingsDirty &&
    resolution.route.id !== "settings"
  ) {
    onWarnUnsavedSettings(resolution.canonicalPath);
    return "warned";
  }

  onNavigate(resolution.canonicalPath);
  return "navigated";
}

function createRouteRenderError(): ApiError {
  return {
    code: "internal_error",
    message: "This route could not render.",
    retryable: true,
    scope: "route",
    status: 500,
  };
}

function useShellPath(history: ShellHistory): string {
  return useSyncExternalStore(
    history.subscribe ?? (() => () => undefined),
    () => history.location.pathname,
    () => history.location.pathname,
  );
}

function useShellPreferences(preferencesStore: ShellPreferencesStore) {
  return useSyncExternalStore(
    preferencesStore.subscribe,
    preferencesStore.get,
    preferencesStore.get,
  );
}

function focusRouteHeading(target: RouteHeadingFocusTarget): void {
  if (typeof document === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    document.getElementById(target.headingId)?.focus();
  });
}

function SidebarNav({
  activeRoute,
  onNavigatePath,
  preferences,
  preferencesStore,
}: {
  activeRoute: RouteConfig;
  onNavigatePath: (path: RouteConfig["path"]) => void;
  preferences: ReturnType<ShellPreferencesStore["get"]>;
  preferencesStore: ShellPreferencesStore;
}): ReactElement {
  const sidebarToggleLabel = preferences.sidebarCollapsed
    ? "Expand sidebar"
    : "Collapse sidebar";

  const handleToggleSidebar = () => {
    preferencesStore.set({
      ...preferences,
      sidebarCollapsed: !preferences.sidebarCollapsed,
    });
  };

  const handleNavigate =
    (path: RouteConfig["path"]) => (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      onNavigatePath(path);
    };

  const routeIcon = (routeId: RouteConfig["id"]): ReactElement => {
    const commonProps = {
      "aria-hidden": true,
      className: "xb-shell-sidebar__route-icon",
      focusable: "false",
      viewBox: "0 0 24 24",
    } as const;

    if (routeId === "writer") {
      return (
        <svg {...commonProps}>
          <path d="M5 5.5h14v13H5z" />
          <path d="M8 9h8" />
          <path d="M8 12h6" />
          <path d="M8 15h4" />
        </svg>
      );
    }

    if (routeId === "voice") {
      return (
        <svg {...commonProps}>
          <path d="M12 4v10" />
          <path d="M8 9v2a4 4 0 0 0 8 0V9" />
          <path d="M9 19h6" />
          <path d="M12 15v4" />
        </svg>
      );
    }

    if (routeId === "library") {
      return (
        <svg {...commonProps}>
          <path d="M6 5h11a2 2 0 0 1 2 2v12H8a2 2 0 0 1-2-2z" />
          <path d="M6 5v12a2 2 0 0 0 2 2" />
          <path d="M9 9h6" />
          <path d="M9 12h5" />
        </svg>
      );
    }

    return (
      <svg {...commonProps}>
        <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" />
        <path d="M12 3.5v2" />
        <path d="M12 18.5v2" />
        <path d="M4.6 7.8l1.7 1" />
        <path d="M17.7 15.2l1.7 1" />
        <path d="M19.4 7.8l-1.7 1" />
        <path d="M6.3 15.2l-1.7 1" />
      </svg>
    );
  };

  return (
    <nav aria-label="Primary" className="xb-shell-sidebar">
      <div className="xb-shell-sidebar__header">
        <span
          aria-hidden={preferences.sidebarCollapsed}
          className="xb-shell-sidebar__brand"
        >
          x-builder
        </span>
        <button
          aria-label={sidebarToggleLabel}
          className="xb-shell-sidebar__toggle"
          onClick={handleToggleSidebar}
          type="button"
        >
          <span aria-hidden="true">{preferences.sidebarCollapsed ? ">" : "<"}</span>
        </button>
      </div>
      <div className="xb-shell-sidebar__routes">
        {appRoutes.map((route) => (
          <a
            key={route.id}
            href={route.path}
            aria-current={route.id === activeRoute.id ? "page" : undefined}
            aria-label={route.label}
            className="xb-shell-sidebar__route"
            data-active={route.id === activeRoute.id ? "true" : undefined}
            onClick={handleNavigate(route.path)}
          >
            <span className="xb-shell-sidebar__route-marker" aria-hidden="true" />
            {routeIcon(route.id)}
            <span className="xb-shell-sidebar__route-label">{route.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

function hasSettingsApiClient(
  apiClient: EngineStatusClient & Partial<SettingsRouteApiClient>,
): apiClient is SettingsRouteApiClient {
  return (
    typeof apiClient.getSettings === "function" &&
    typeof apiClient.saveSettings === "function"
  );
}

function hasWriterApiClient(
  apiClient: EngineStatusClient & Partial<WriterApiClient>,
): apiClient is EngineStatusClient & WriterApiClient {
  return (
    typeof apiClient.analyzePosts === "function" &&
    typeof apiClient.generateIdea === "function"
  );
}

function DefaultRouteBody({
  onOpenSettings,
  settingsApiClient,
  writerApiClient,
  onDirtySettingsChange,
  onDiscardSettingsNavigation,
  onNavigateToWriter,
  onRequestShellNavigation,
  onStayOnSettings,
  onStatusRefresh,
  pendingSettingsNavigationPath,
  route,
}: ShellRouteComponentProps & {
  onOpenSettings: () => void;
  settingsApiClient: SettingsRouteApiClient;
  writerApiClient: WriterApiClient;
  onDirtySettingsChange: (dirty: boolean) => void;
  onDiscardSettingsNavigation: (to: RouteConfig["path"]) => void;
  onNavigateToWriter: () => void;
  onRequestShellNavigation: (to: RouteConfig["path"]) => void;
  onStayOnSettings: () => void;
  onStatusRefresh: (status: AppStatus) => void;
  pendingSettingsNavigationPath: RouteConfig["path"] | null;
}): ReactElement {
  if (route.id === "writer") {
    return <WriterPage apiClient={writerApiClient} onOpenSettings={onOpenSettings} />;
  }

  if (route.id === "settings") {
    return (
      <SettingsRoute
        apiClient={settingsApiClient}
        onDirtyChange={onDirtySettingsChange}
        onDiscardNavigation={onDiscardSettingsNavigation}
        onNavigateToWriter={onNavigateToWriter}
        onRequestNavigate={onRequestShellNavigation}
        onStayOnSettings={onStayOnSettings}
        onStatusRefresh={onStatusRefresh}
        openedFrom="writer"
        pendingNavigationPath={pendingSettingsNavigationPath}
      />
    );
  }

  return <PlaceholderRoute route={route} onNavigateToWriter={onNavigateToWriter} />;
}

function placeholderCopyForRoute(route: RouteConfig): string {
  if (route.id === "voice") {
    return "Voice profile setup is not part of this shell pass.";
  }

  if (route.id === "library") {
    return "Post memory is reserved for the library feature pass.";
  }

  return `${route.label} is reserved for a later feature pass.`;
}

function PlaceholderRoute({
  onNavigateToWriter,
  route,
}: {
  onNavigateToWriter: () => void;
  route: RouteConfig;
}): ReactElement {
  return (
    <EmptyState
      action={
        <Button onClick={onNavigateToWriter} variant="primary">
          Back to Studio
        </Button>
      }
      title={`${route.title} workspace`}
    >
      {placeholderCopyForRoute(route)}
    </EmptyState>
  );
}

type RouteErrorBoundaryProps = {
  children: ReactElement;
  onOpenSettings: () => void;
  routeId: RouteConfig["id"];
};

type RouteErrorBoundaryState = {
  error: ApiError | null;
  routeId: RouteConfig["id"];
  retrying: boolean;
};

class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    error: null,
    routeId: this.props.routeId,
    retrying: false,
  };

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): RouteErrorBoundaryState | null {
    if (props.routeId !== state.routeId) {
      return {
        error: null,
        routeId: props.routeId,
        retrying: false,
      };
    }

    return null;
  }

  static getDerivedStateFromError(): Partial<RouteErrorBoundaryState> {
    return {
      error: createRouteRenderError(),
      retrying: false,
    };
  }

  handleRetry = async (): Promise<void> => {
    this.setState({
      error: null,
      retrying: true,
      routeId: this.props.routeId,
    });
  }

  render(): ReactElement {
    if (this.state.error !== null) {
      return (
        <RouteErrorBanner
          error={this.state.error}
          isRetrying={this.state.retrying}
          onOpenSettings={this.props.onOpenSettings}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

function routeComponentFor(
  route: RouteConfig,
  routeComponents: ShellRouteComponents | undefined,
) {
  const RouteComponent = routeComponents?.[route.id];

  if (RouteComponent !== undefined) {
    return RouteComponent;
  }

  return null;
}

function renderStaticRouteBody(
  settingsApiClient: SettingsRouteApiClient,
  writerApiClient: WriterApiClient,
  onDirtySettingsChange: (dirty: boolean) => void,
  onDiscardSettingsNavigation: (to: RouteConfig["path"]) => void,
  onOpenSettings: () => void,
  onNavigateToWriter: () => void,
  onRequestShellNavigation: (to: RouteConfig["path"]) => void,
  onStayOnSettings: () => void,
  onStatusRefresh: (status: AppStatus) => void,
  pendingSettingsNavigationPath: RouteConfig["path"] | null,
  route: RouteConfig,
  RouteComponent: ((props: ShellRouteComponentProps) => ReactElement) | null,
): ReactElement {
  // React error boundaries do not catch server-render failures.
  try {
    if (RouteComponent === null) {
      return (
        <DefaultRouteBody
          onOpenSettings={onOpenSettings}
          settingsApiClient={settingsApiClient}
          writerApiClient={writerApiClient}
          onDirtySettingsChange={onDirtySettingsChange}
          onDiscardSettingsNavigation={onDiscardSettingsNavigation}
          onNavigateToWriter={onNavigateToWriter}
          onRequestShellNavigation={onRequestShellNavigation}
          onStayOnSettings={onStayOnSettings}
          onStatusRefresh={onStatusRefresh}
          pendingSettingsNavigationPath={pendingSettingsNavigationPath}
          route={route}
        />
      );
    }

    return RouteComponent({ route });
  } catch {
    return (
      <RouteErrorBanner
        error={createRouteRenderError()}
        onOpenSettings={onOpenSettings}
        onRetry={async () => undefined}
      />
    );
  }
}

function RouteBody({
  settingsApiClient,
  writerApiClient,
  onDirtySettingsChange,
  onDiscardSettingsNavigation,
  onOpenSettings,
  onNavigateToWriter,
  onRequestShellNavigation,
  onStayOnSettings,
  onStatusRefresh,
  pendingSettingsNavigationPath,
  route,
  routeComponents,
}: {
  settingsApiClient: SettingsRouteApiClient;
  writerApiClient: WriterApiClient;
  onDirtySettingsChange: (dirty: boolean) => void;
  onDiscardSettingsNavigation: (to: RouteConfig["path"]) => void;
  onOpenSettings: () => void;
  onNavigateToWriter: () => void;
  onRequestShellNavigation: (to: RouteConfig["path"]) => void;
  onStayOnSettings: () => void;
  onStatusRefresh: (status: AppStatus) => void;
  pendingSettingsNavigationPath: RouteConfig["path"] | null;
  route: RouteConfig;
  routeComponents: ShellRouteComponents | undefined;
}): ReactElement {
  const RouteComponent = routeComponentFor(route, routeComponents);

  if (typeof window === "undefined") {
    return renderStaticRouteBody(
      settingsApiClient,
      writerApiClient,
      onDirtySettingsChange,
      onDiscardSettingsNavigation,
      onOpenSettings,
      onNavigateToWriter,
      onRequestShellNavigation,
      onStayOnSettings,
      onStatusRefresh,
      pendingSettingsNavigationPath,
      route,
      RouteComponent,
    );
  }

  const routeElement =
    RouteComponent === null ? (
      <DefaultRouteBody
        onOpenSettings={onOpenSettings}
        settingsApiClient={settingsApiClient}
        writerApiClient={writerApiClient}
        onDirtySettingsChange={onDirtySettingsChange}
        onDiscardSettingsNavigation={onDiscardSettingsNavigation}
        onNavigateToWriter={onNavigateToWriter}
        onRequestShellNavigation={onRequestShellNavigation}
        onStayOnSettings={onStayOnSettings}
        onStatusRefresh={onStatusRefresh}
        pendingSettingsNavigationPath={pendingSettingsNavigationPath}
        route={route}
      />
    ) : (
      <RouteComponent route={route} />
    );

  return (
    <RouteErrorBoundary onOpenSettings={onOpenSettings} routeId={route.id}>
      {routeElement}
    </RouteErrorBoundary>
  );
}

function RouteHeading({ target }: { target: RouteHeadingFocusTarget }): ReactElement {
  return (
    <div
      className="xb-page-header__copy"
      dangerouslySetInnerHTML={{
        __html: `<h1 class="xb-page-header__title" id="${target.headingId}" tabIndex="-1">${escapeHtml(target.headingText)}</h1>`,
      }}
    />
  );
}

export function AppShell({
  apiClient,
  history,
  onRouteHeadingFocus,
  preferencesStore,
  routeComponents,
}: AppShellProps): ReactElement {
  const [defaultApiClient] = useState(
    () => new EngineApiClient({ baseUrl: defaultEngineBaseUrl }),
  );
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);
  const [pendingSettingsNavigationPath, setPendingSettingsNavigationPath] =
    useState<RouteConfig["path"] | null>(null);
  const shellApiClient = apiClient ?? defaultApiClient;
  const settingsApiClient = hasSettingsApiClient(shellApiClient)
    ? shellApiClient
    : defaultApiClient;
  const writerApiClient = hasWriterApiClient(shellApiClient)
    ? shellApiClient
    : defaultApiClient;
  const pathname = useShellPath(history);
  const preferences = useShellPreferences(preferencesStore);
  const resolution = resolveRoutePath(pathname);
  const shouldReplace = resolution.shouldReplace;
  const canonicalPath = resolution.canonicalPath;
  const lastAcceptedPathRef = useRef(canonicalPath);

  const route = resolution.route;
  const headingTarget = headingTargetForRoute(route);

  const performNavigation = useCallback(
    (to: RouteConfig["path"]) => {
      const resolution = resolveRoutePath(to);

      lastAcceptedPathRef.current = resolution.canonicalPath;
      navigateShellRoute({
        focusRouteHeading: (target) => {
          onRouteHeadingFocus?.(target);
          focusRouteHeading(target);
        },
        history,
        preferencesStore,
        to: resolution.canonicalPath,
      });
      setPendingSettingsNavigationPath(null);
    },
    [history, onRouteHeadingFocus, preferencesStore],
  );

  const requestShellNavigation = useCallback(
    (to: RouteConfig["path"]) => {
      guardSettingsNavigation({
        activeRouteId: route.id,
        isSettingsDirty,
        onNavigate: performNavigation,
        onWarnUnsavedSettings: setPendingSettingsNavigationPath,
        to,
      });
    },
    [isSettingsDirty, performNavigation, route.id],
  );

  const handleStayOnSettings = useCallback(() => {
    setPendingSettingsNavigationPath(null);
  }, []);

  const handleDiscardSettingsNavigation = useCallback(
    (to: RouteConfig["path"]) => {
      setIsSettingsDirty(false);
      setPendingSettingsNavigationPath(null);
      performNavigation(to);
    },
    [performNavigation],
  );

  useEffect(() => {
    if (shouldReplace) {
      setHistoryPath(history, canonicalPath, "replace");
    }
  }, [canonicalPath, history, shouldReplace]);

  useEffect(() => {
    const previousPath = lastAcceptedPathRef.current;

    if (previousPath === canonicalPath) {
      return;
    }

    const previousRoute = resolveRoutePath(previousPath).route;

    if (previousRoute.id === "settings" && isSettingsDirty) {
      setPendingSettingsNavigationPath(canonicalPath);
      setHistoryPath(history, previousPath, "replace");
      return;
    }

    lastAcceptedPathRef.current = canonicalPath;
  }, [canonicalPath, history, isSettingsDirty]);

  useEffect(() => {
    if (!isSettingsDirty) {
      setPendingSettingsNavigationPath(null);
    }
  }, [isSettingsDirty]);

  useEffect(() => {
    if (!isSettingsDirty || route.id !== "settings") {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isSettingsDirty, route.id]);

  const handleOpenSettings = () => {
    requestShellNavigation("/settings");
  };
  const handleNavigateToWriter = () => {
    requestShellNavigation("/writer");
  };

  return (
    <div
      className="xb-shell"
      data-sidebar-collapsed={preferences.sidebarCollapsed ? "true" : "false"}
    >
      <a className="xb-shell__skip-link" href="#main-content">
        Skip to content
      </a>
      <SidebarNav
        activeRoute={route}
        onNavigatePath={requestShellNavigation}
        preferences={preferences}
        preferencesStore={preferencesStore}
      />
      <main className="xb-shell__main" id="main-content">
        <header className="xb-page-header xb-shell__route-header">
          <div className="xb-page-header__main">
            <RouteHeading target={headingTarget} />
          </div>
        </header>
        <section aria-labelledby={headingTarget.headingId} className="xb-shell__route-outlet">
          <RouteBody
            settingsApiClient={settingsApiClient}
            writerApiClient={writerApiClient}
            onDirtySettingsChange={setIsSettingsDirty}
            onDiscardSettingsNavigation={handleDiscardSettingsNavigation}
            onOpenSettings={handleOpenSettings}
            onNavigateToWriter={handleNavigateToWriter}
            onRequestShellNavigation={requestShellNavigation}
            onStayOnSettings={handleStayOnSettings}
            onStatusRefresh={() => undefined}
            pendingSettingsNavigationPath={pendingSettingsNavigationPath}
            route={route}
            routeComponents={routeComponents}
          />
        </section>
      </main>
    </div>
  );
}

export function createAppShellPublicDriver(
  options: AppShellPublicDriverOptions,
): AppShellPublicDriver {
  const defaultApiClient = new EngineApiClient({ baseUrl: defaultEngineBaseUrl });
  const shellApiClient = options.apiClient ?? defaultApiClient;
  const writerApiClient = hasWriterApiClient(shellApiClient)
    ? shellApiClient
    : defaultApiClient;
  const renderShell = options.renderShell ?? AppShell;
  const ShellComponent = renderShell;
  const openSettings = () => {
    navigateShellRoute({
      focusRouteHeading: options.onRouteHeadingFocus ?? (() => undefined),
      history: options.history,
      preferencesStore: options.preferencesStore,
      to: "/settings",
    });
  };
  const writerDriver = createWriterPagePublicDriver({
    apiClient: writerApiClient,
    onOpenSettings: openSettings,
    renderPage: WriterPage,
  });

  const renderCurrentShell = () =>
    renderToStaticMarkup(
      <ShellComponent
        apiClient={options.apiClient}
        history={options.history}
        onRouteHeadingFocus={options.onRouteHeadingFocus}
        preferencesStore={options.preferencesStore}
        routeComponents={options.routeComponents}
      />,
    );

  return {
    activatePlaceholderPrimaryAction: () => {
      const route = resolveRoutePath(options.history.location.pathname).route;

      if (route.id === "voice" || route.id === "library") {
        navigateShellRoute({
          focusRouteHeading: options.onRouteHeadingFocus ?? (() => undefined),
          history: options.history,
          preferencesStore: options.preferencesStore,
          to: "/writer",
        });
      }

      return renderCurrentShell();
    },
    generateWriterIdea: async () => {
      const writerHtml = await writerDriver.generate();
      return `${renderCurrentShell()}${writerHtml}`;
    },
    openWriterErrorSettings: () => {
      writerDriver.openSettings();
      return renderCurrentShell();
    },
    updateWriterIdea: (idea: string) => {
      const writerHtml = writerDriver.updateIdea(idea);
      return `${renderCurrentShell()}${writerHtml}`;
    },
  };
}
