import type { ReactElement } from "react";
import type { ApiError } from "@x-builder/shared";

import { Alert, Button } from "../ui/foundation";

export type RouteErrorBannerProps = {
  error: ApiError | null;
  isRetrying?: boolean;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
};

function shouldShowSettingsAction(error: ApiError): boolean {
  if (
    error.scope === "app" ||
    error.scope === "settings" ||
    error.scope === "status"
  ) {
    return true;
  }

  if (
    error.code === "engine_unreachable" ||
    error.code === "request_timeout" ||
    error.code === "invalid_response" ||
    error.code === "settings_load_failed" ||
    error.code === "settings_persist_failed" ||
    error.code === "status_unavailable"
  ) {
    return true;
  }

  // AppShell route render failures are blocking; Settings is the shell escape
  // hatch required by the route recovery contract when retry is not enough.
  return error.scope === "route" && error.code === "internal_error";
}

export function RouteErrorBanner({
  error,
  isRetrying = false,
  onOpenSettings,
  onRetry,
}: RouteErrorBannerProps): ReactElement | null {
  if (error === null || error.scope === "field") {
    return null;
  }

  const showRetryAction = error.retryable;
  const showSettingsAction = shouldShowSettingsAction(error);
  const recovery =
    showRetryAction || showSettingsAction ? (
      <>
        {showRetryAction ? (
          <Button
            loading={isRetrying}
            onClick={() => {
              void onRetry();
            }}
            size="sm"
            variant="secondary"
          >
            Retry
          </Button>
        ) : null}
        {showSettingsAction ? (
          <Button onClick={onOpenSettings} size="sm" variant="ghost">
            Open Settings
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <Alert
      aria-live="assertive"
      recovery={recovery}
      title="Route unavailable"
      variant="danger"
    >
      {error.message}
    </Alert>
  );
}
