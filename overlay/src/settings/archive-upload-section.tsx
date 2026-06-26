// @x-builder/overlay — ArchiveUploadSection
//
// A file input + Button drop zone for an X archive (`tweets.js`). On selection
// it hands the File upward via `onUpload` — the parent (SettingsAffordance) runs
// validate→import. A rejected upload surfaces an inline danger Alert with the
// message (no ToastRegion — out of scope) and leaves the input re-enabled for
// retry. Progress is shown while validating / importing.

import { useRef, type ReactElement } from "react";

import { Alert } from "../ui/v2/alert";
import { Button } from "../ui/v2/button";

export type ArchiveUploadState =
  | "idle"
  | "validating"
  | "importing"
  | { status: "done" }
  | { status: "rejected"; message: string };

export interface ArchiveUploadSectionProps {
  onUpload(file: File): void;
  uploadState: ArchiveUploadState;
}

function isBusy(state: ArchiveUploadState): boolean {
  return state === "validating" || state === "importing";
}

function rejection(state: ArchiveUploadState): string | null {
  return typeof state === "object" && "status" in state && state.status === "rejected"
    ? state.message
    : null;
}

/** The archive upload drop zone with inline validation feedback. */
export function ArchiveUploadSection({
  onUpload,
  uploadState,
}: ArchiveUploadSectionProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = isBusy(uploadState);
  const rejectionMessage = rejection(uploadState);

  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <input
        ref={inputRef}
        type="file"
        accept=".js,application/javascript,application/json"
        aria-label="X archive file"
        disabled={busy}
        style={{ font: "var(--type-body-small)", color: "var(--xb-text)" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
      <Button
        variant="primary"
        loading={busy}
        onClick={() => inputRef.current?.click()}
      >
        Upload archive
      </Button>
      {rejectionMessage ? <Alert variant="danger">{rejectionMessage}</Alert> : null}
    </div>
  );
}
