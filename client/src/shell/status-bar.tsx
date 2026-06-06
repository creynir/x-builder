import { useEffect, useState, type ReactElement } from "react";
import type { ApiError, AppStatus, SubsystemStatus } from "@x-builder/shared";

import { ApiClientError } from "../api/engine-api-client";
import { Badge, Button } from "../ui/foundation";

export type StatusPhase =
  | "checking"
  | "ready"
  | "partial"
  | "unavailable"
  | "invalid"
  | "refreshing";

export type EngineStatusClient = {
  getStatus: () => Promise<AppStatus>;
};

export type AppStatusSnapshot = {
  status: AppStatus | null;
  error: ApiError | null;
  phase: StatusPhase;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
};

export type UseAppStatusOptions = {
  apiClient: EngineStatusClient;
  onStatusChange?: (status: AppStatus) => void;
};

export type TopStatusBarProps = {
  status: AppStatusSnapshot;
  onOpenSettings: () => void;
};

type StatusItem = {
  label: string;
  state: SubsystemStatus["state"] | "checking" | "invalid";
  message?: string;
};

const checkingItems: StatusItem[] = [
  { label: "Engine", state: "checking" },
  { label: "Deterministic scorer", state: "checking" },
  { label: "Codex judge", state: "checking" },
  { label: "Storage", state: "checking" },
];

function phaseForStatus(status: AppStatus): StatusPhase {
  return status.overall;
}

function phaseForError(error: ApiError): StatusPhase {
  if (error.code === "invalid_response") {
    return "invalid";
  }

  return "unavailable";
}

function normalizeStatusError(error: unknown): ApiError {
  if (error instanceof ApiClientError) {
    return error.apiError;
  }

  return {
    code: "engine_unreachable",
    message: "The local engine could not be reached. Try again.",
    retryable: true,
    scope: "status",
    status: 503,
  };
}

function statusItems(snapshot: AppStatusSnapshot): StatusItem[] {
  if (snapshot.status === null && snapshot.phase === "unavailable") {
    return [
      {
        label: "Engine",
        message: snapshot.error?.message ?? "The local engine is unavailable.",
        state: "unavailable",
      },
    ];
  }

  if (snapshot.status === null && snapshot.phase === "invalid") {
    return [
      {
        label: "Status",
        message:
          snapshot.error?.message ??
          "The local engine returned an invalid status response.",
        state: "invalid",
      },
    ];
  }

  if (snapshot.status === null) {
    return checkingItems;
  }

  return [
    snapshot.status.engine,
    snapshot.status.deterministic,
    snapshot.status.codex,
    snapshot.status.storage,
  ];
}

function badgeVariantForState(
  state: StatusItem["state"],
): "success" | "warning" | "danger" | "info" | "uncertain" {
  if (state === "ready") {
    return "success";
  }

  if (state === "checking") {
    return "info";
  }

  if (state === "failed" || state === "invalid" || state === "unavailable") {
    return "danger";
  }

  if (state === "partial" || state === "stale" || state === "unconfigured") {
    return "warning";
  }

  return "uncertain";
}

function labelForState(state: StatusItem["state"]): string {
  return state.replaceAll("-", " ");
}

function LastRun({ status }: { status: AppStatus | null }): ReactElement {
  if (status === null) {
    return (
      <span className="xb-status-bar__last-run">
        <span className="xb-status-bar__label">Last run</span>
        <span className="xb-status-bar__value">Checking</span>
      </span>
    );
  }

  if (status.lastRun.state !== "completed") {
    return (
      <span className="xb-status-bar__last-run">
        <span className="xb-status-bar__label">Last run</span>
        <span className="xb-status-bar__value">No runs yet</span>
      </span>
    );
  }

  return (
    <span className="xb-status-bar__last-run">
      <span className="xb-status-bar__label">Last run</span>
      <span className="xb-status-bar__value">
        {status.lastRun.ideaId ?? status.lastRun.completedAt ?? "Completed"}
      </span>
    </span>
  );
}

export function useAppStatus({
  apiClient,
  onStatusChange,
}: UseAppStatusOptions): AppStatusSnapshot {
  const [state, setState] = useState<
    Omit<AppStatusSnapshot, "refresh">
  >({
    error: null,
    isRefreshing: true,
    phase: "checking",
    status: null,
  });

  async function refresh(): Promise<void> {
    setState((current) => ({
      ...current,
      error: null,
      isRefreshing: true,
      phase: current.status === null ? "checking" : "refreshing",
    }));

    try {
      const nextStatus = await apiClient.getStatus();
      onStatusChange?.(nextStatus);
      setState({
        error: null,
        isRefreshing: false,
        phase: phaseForStatus(nextStatus),
        status: nextStatus,
      });
    } catch (error) {
      const apiError = normalizeStatusError(error);

      setState((current) => ({
        error: apiError,
        isRefreshing: false,
        phase: phaseForError(apiError),
        status: current.status,
      }));
    }
  }

  useEffect(() => {
    void refresh();
  }, [apiClient]);

  return {
    ...state,
    refresh,
  };
}

export function TopStatusBar({
  onOpenSettings,
  status,
}: TopStatusBarProps): ReactElement {
  const showSettingsAction =
    status.phase === "partial" ||
    status.phase === "unavailable" ||
    status.phase === "invalid" ||
    status.status?.overall === "partial";

  return (
    <section
      aria-live="polite"
      className="xb-status-bar"
      role="status"
    >
      <div className="xb-status-bar__systems">
        {statusItems(status).map((item) => (
          <span className="xb-status-bar__item" key={item.label}>
            <Badge variant={badgeVariantForState(item.state)}>
              {item.label} {labelForState(item.state)}
            </Badge>
            {item.message ? (
              <span className="xb-status-bar__message">{item.message}</span>
            ) : null}
          </span>
        ))}
        <LastRun status={status.status} />
      </div>
      <div className="xb-status-bar__actions">
        {status.isRefreshing ? (
          <span className="xb-status-bar__refreshing">Refreshing</span>
        ) : null}
        {showSettingsAction ? (
          <Button onClick={onOpenSettings} size="sm" variant="secondary">
            Open Settings
          </Button>
        ) : null}
        <Button
          aria-label="Refresh status"
          loading={status.isRefreshing}
          onClick={() => {
            void status.refresh();
          }}
          size="sm"
          variant="ghost"
        >
          {status.isRefreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>
    </section>
  );
}
