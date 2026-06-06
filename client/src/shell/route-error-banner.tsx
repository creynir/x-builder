import type { ReactElement } from "react";
import type { ApiError } from "@x-builder/shared";

import { Alert, Button } from "../ui/foundation";

export type RouteErrorBannerProps = {
  error: ApiError | null;
  isRetrying?: boolean;
  onOpenSettings: () => void;
  onRetry: () => Promise<void>;
};

export function RouteErrorBanner({
  error,
  isRetrying = false,
  onOpenSettings,
  onRetry,
}: RouteErrorBannerProps): ReactElement | null {
  if (error === null || error.scope === "field") {
    return null;
  }

  return (
    <Alert
      aria-live="assertive"
      recovery={
        <>
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
          <Button onClick={onOpenSettings} size="sm" variant="ghost">
            Open Settings
          </Button>
        </>
      }
      title="Route unavailable"
      variant="danger"
    >
      {error.message}
    </Alert>
  );
}
