// @x-builder/overlay — SettingsAffordance (orchestrator)
//
// Renders the always-visible SettingsLauncherButton and, when open, the
// SettingsPanel. It drives ALL L1 data through useTransport() — fetching
// getSettings() (unwrapping the AppSettingsResponse envelope's `.settings`),
// getOverlayReadiness(), getCaptureSummary() and getActiveContext() on mount and
// on each open — and owns the open toggle (L4), focus management, and the
// optimistic-echo / rollback wiring for the active-context toggle and the
// judge-provider change.
//
// Focus: opening moves focus to the first interactive control inside the dialog;
// closing (Esc or click-outside detected via composedPath across the shadow
// boundary) returns focus to the launcher. Containment is soft — forward Tab
// wraps within the panel, but Shift-Tab is never force-trapped, so the user can
// escape back to x.com.

import type {
  ActiveArchiveContext,
  AppSettings,
  CaptureSummary,
  JudgeProviderId,
  OverlayReadiness,
} from "@x-builder/shared";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { useTransport } from "../transport/use-transport";
import { ActiveContextToggle } from "./active-context-toggle";
import type { ArchiveUploadState } from "./archive-upload-section";
import { SettingsLauncherButton } from "./settings-launcher-button";
import { SettingsPanel } from "./settings-panel";

type Loadable<T> = T | "loading" | { error: unknown };

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [role="switch"], [tabindex]:not([tabindex="-1"])';

/** Active-context is "checked" only in the active status. */
function contextChecked(context: ActiveArchiveContext | null): boolean {
  return context?.status === "active";
}

/** Narrow a loadable to its resolved value (not loading, not an error envelope). */
function isResolved<T>(value: Loadable<T>): value is T {
  return (
    value !== "loading" &&
    !(typeof value === "object" && value !== null && "error" in value)
  );
}

export function SettingsAffordance(): ReactElement {
  const transport = useTransport();

  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Loadable<AppSettings>>("loading");
  const [readiness, setReadiness] = useState<Loadable<OverlayReadiness>>("loading");
  const [capture, setCapture] = useState<Loadable<CaptureSummary>>("loading");
  const [activeContext, setActiveContext] = useState<ActiveArchiveContext | null>(null);
  // Optimistic override of the toggle's checked state while a transport call is
  // in flight; `null` means "defer to the resolved activeContext".
  const [pendingChecked, setPendingChecked] = useState<boolean | null>(null);
  const [uploadState, setUploadState] = useState<ArchiveUploadState>("idle");

  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Last-write-wins generation guards for rapid toggles.
  const contextGen = useRef(0);
  const settingsGen = useRef(0);

  /** Fetch every L1 source; envelope-unwrap settings. Tolerates rejection. */
  const refresh = useCallback((): void => {
    transport
      .getSettings()
      .then((response) => setSettings(response.settings))
      .catch((error: unknown) => setSettings({ error }));
    transport
      .getOverlayReadiness()
      .then((value) => setReadiness(value))
      .catch((error: unknown) => setReadiness({ error }));
    transport
      .getCaptureSummary()
      .then((value) => setCapture(value))
      .catch((error: unknown) => setCapture({ error }));
    transport
      .getActiveContext()
      .then((value) => setActiveContext(value))
      .catch(() => setActiveContext(null));
  }, [transport]);

  // Fetch on mount and on every open transition.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Move focus to the first interactive control once the panel is open.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
  }, [open, settings, readiness, capture, activeContext]);

  const close = useCallback((): void => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  // Esc to close + soft focus containment.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab" || event.shiftKey) return; // Shift-Tab escapes.
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) return;
      const active = (dialog.getRootNode() as ShadowRoot | Document).activeElement;
      const last = focusables[focusables.length - 1];
      if (active === last) {
        event.preventDefault();
        focusables[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, close]);

  // Click-outside via composedPath across the shadow boundary.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: Event): void => {
      const dialog = dialogRef.current;
      const launcher = launcherRef.current;
      if (!dialog) return;
      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const target = (path[0] as Node | undefined) ?? (event.target as Node | null);
      const inside =
        (dialog && target instanceof Node && dialog.contains(target)) ||
        (launcher && target instanceof Node && launcher.contains(target)) ||
        path.includes(dialog) ||
        (launcher !== null && path.includes(launcher));
      if (!inside) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onPointerDown, true);
    };
  }, [open, close]);

  /** Active-context toggle: optimistic echo + activate/deactivate + rollback. */
  const onToggleContext = useCallback(
    (next: boolean): void => {
      const generation = ++contextGen.current;
      setPendingChecked(next); // Optimistic echo: flip immediately.
      const call = next ? transport.activateContext() : transport.deactivateContext();
      call
        .then((response) => {
          if (generation !== contextGen.current) return; // Superseded.
          setActiveContext(response.activeContext);
          setPendingChecked(null); // Transport value is now authoritative.
        })
        .catch(() => {
          if (generation !== contextGen.current) return; // Superseded.
          setPendingChecked(null); // Rollback to the resolved context.
        });
    },
    [transport],
  );

  /** Judge-provider change: send the FULL merged AppSettings; rollback on reject. */
  const onUpdateSettings = useCallback(
    (nextSettings: AppSettings): void => {
      const generation = ++settingsGen.current;
      const previous = settings;
      setSettings(nextSettings); // Optimistic echo.
      transport
        .updateSettings(nextSettings)
        .then((response) => {
          if (generation !== settingsGen.current) return;
          setSettings(response.settings);
        })
        .catch(() => {
          if (generation !== settingsGen.current) return;
          setSettings(previous);
        });
    },
    [settings, transport],
  );

  /** Archive: validate → import; rejection surfaces a danger Alert, no import. */
  const onUploadArchive = useCallback(
    (file: File): void => {
      setUploadState("validating");
      void (async (): Promise<void> => {
        let contents: string;
        try {
          contents = await file.text();
        } catch (error: unknown) {
          setUploadState({ status: "rejected", message: messageOf(error) });
          return;
        }
        const request = {
          fileName: file.name,
          fileSizeBytes: file.size,
          contents,
        };
        try {
          await transport.validateArchive(request);
        } catch (error: unknown) {
          setUploadState({ status: "rejected", message: messageOf(error) });
          return;
        }
        setUploadState("importing");
        try {
          await transport.importArchive({ ...request, duplicatePolicy: "merge_update" });
          setUploadState({ status: "done" });
        } catch (error: unknown) {
          setUploadState({ status: "rejected", message: messageOf(error) });
        }
      })();
    },
    [transport],
  );

  const status: OverlayReadiness | "loading" = isResolved(readiness)
    ? readiness
    : "loading";

  return (
    <>
      <SettingsLauncherButton
        ref={launcherRef}
        status={status}
        open={open}
        onToggle={() => setOpen((value) => !value)}
      />
      <SettingsPanel
        open={open}
        onClose={close}
        settings={settings}
        readiness={readiness}
        capture={capture}
        onUpdateSettings={onUpdateSettings}
        onUploadArchive={onUploadArchive}
        uploadState={uploadState}
        dialogRef={dialogRef}
      >
        <ActiveContextToggle
          checked={pendingChecked ?? contextChecked(activeContext)}
          onChange={onToggleContext}
        />
      </SettingsPanel>
    </>
  );
}

/** Best-effort error message extraction for inline Alert copy. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Upload failed.";
}
