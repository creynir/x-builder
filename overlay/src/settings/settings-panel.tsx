// @x-builder/overlay — SettingsPanel
//
// The anchored settings popover. It is `position: absolute` within the overlay's
// own layer (NOT a fixed Drawer — see XOB-020 scope boundary), `role="dialog"`
// `aria-modal="true"` `aria-label="X Builder settings"`, built from the Aurora
// Glass tokens (panel surface / glass blur / border edge / glow / radius), and
// it scrolls internally (`max-height: 80vh; overflow-y: auto`) so it never
// pushes the X UI. Collision-flip is signalled via `data-flip-x` / `data-flip-y`.
//
// It renders the readiness dots, the capture summary (as a KeyValueList), the
// judge-provider picker (read-current-then-send-FULL via onUpdateSettings) and
// the archive upload section. The active-context toggle is supplied by
// SettingsAffordance through `children`, since active context is archive state,
// not an AppSettings field. Loading / error envelopes degrade per section to a
// Skeleton / inline danger Alert.

import type {
  AppSettings,
  CaptureSummary,
  GetExternalXSignalsOverviewResponse,
  GetFeedbackLoopSummaryResponse,
  OverlayReadiness,
} from "@x-builder/shared";
import type { CSSProperties, ReactElement, ReactNode, RefObject } from "react";

import { Alert } from "../ui/v2/alert";
import { KeyValueList, type KeyValueItem } from "../ui/v2/key-value-list";
import { Skeleton } from "../ui/v2/skeleton";
import { ArchiveUploadSection, type ArchiveUploadState } from "./archive-upload-section";
import {
  ExternalXSignalsSettingsSection,
  type ExternalXSignalsActionState,
} from "./external-x-signals-section";
import { FeedbackLoopSettingsSection } from "./feedback-loop-section";
import { JudgeProviderSection } from "./judge-provider-section";
import { ReadinessIndicator } from "./readiness-indicator";

type Loadable<T> = T | "loading" | { error: unknown };

export interface SettingsPanelProps {
  open: boolean;
  onClose(): void;
  settings: Loadable<AppSettings>;
  readiness: Loadable<OverlayReadiness>;
  capture: Loadable<CaptureSummary>;
  feedback: Loadable<GetFeedbackLoopSummaryResponse>;
  externalXSignals: Loadable<GetExternalXSignalsOverviewResponse>;
  externalXSignalsAction: ExternalXSignalsActionState;
  onUpdateSettings(next: AppSettings): void;
  onUploadArchive(file: File): void;
  onRefreshFeedback(): void;
  onLinkFeedback(predictionId: string, platformPostId: string): Promise<void>;
  onAddExternalXSignalSource(screenName: string): Promise<void>;
  onRefreshExternalXSignalSource(sourceId: string): Promise<void>;
  onRemoveExternalXSignalSource(sourceId: string): Promise<void>;
  onRefreshExternalXSignals(): void;
  /** Affordance-supplied interactive controls (e.g. the active-context toggle). */
  children?: ReactNode;
  /** Upload feedback state, owned by the affordance. */
  uploadState?: ArchiveUploadState;
  /** Selector-miss count for the readiness layout-changed heuristic. */
  selectorMissCount?: number;
  /** Ref to the dialog element (focus management lives in the affordance). */
  dialogRef?: RefObject<HTMLDivElement | null>;
}

const PANEL_STYLE: CSSProperties = {
  position: "absolute",
  top: "var(--space-12)",
  left: "var(--space-2)",
  width: "var(--overlay-width-sm)",
  maxWidth: "calc(100vw - var(--space-4))",
  maxHeight: "80vh",
  overflowY: "auto",
  display: "grid",
  gap: "var(--gap-block-section)",
  padding: "var(--padding-panel-spacious)",
  color: "var(--xb-text)",
  font: "var(--type-body)",
  background: "var(--xb-surface-panel)",
  backdropFilter: "blur(var(--xb-glass-blur))",
  WebkitBackdropFilter: "blur(var(--xb-glass-blur))",
  border: "var(--border-width-thin) solid var(--xb-border-edge)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--xb-glow-md)",
  zIndex: "var(--xb-z-panel)",
};

const SECTION_STYLE: CSSProperties = { display: "grid", gap: "var(--space-2)" };

const HEADING_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-label)",
  color: "var(--xb-text-muted)",
  letterSpacing: "var(--tracking-wide)",
  textTransform: "uppercase",
};

function isLoading<T>(value: Loadable<T>): value is "loading" {
  return value === "loading";
}

function isError<T>(value: Loadable<T>): value is { error: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section style={SECTION_STYLE}>
      <h3 style={HEADING_STYLE}>{title}</h3>
      {children}
    </section>
  );
}

function captureItems(capture: CaptureSummary): KeyValueItem[] {
  const items: KeyValueItem[] = [
    { key: "Posts captured", value: String(capture.postsCaptured) },
  ];
  if (capture.lastCaptureAt) items.push({ key: "Last capture", value: capture.lastCaptureAt });
  if (capture.screenName) items.push({ key: "Account", value: capture.screenName });
  if (capture.followers !== undefined) {
    items.push({ key: "Followers", value: String(capture.followers) });
  }
  return items;
}

/** The settings dialog shell. */
export function SettingsPanel({
  open,
  settings,
  readiness,
  capture,
  feedback,
  externalXSignals,
  externalXSignalsAction,
  onUpdateSettings,
  onUploadArchive,
  onRefreshFeedback,
  onLinkFeedback,
  onAddExternalXSignalSource,
  onRefreshExternalXSignalSource,
  onRemoveExternalXSignalSource,
  onRefreshExternalXSignals,
  children,
  uploadState = "idle",
  selectorMissCount = 0,
  dialogRef,
}: SettingsPanelProps): ReactElement | null {
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="X Builder settings"
      style={PANEL_STYLE}
    >
      <Section title="Engine readiness">
        {isLoading(readiness) ? (
          <Skeleton />
        ) : isError(readiness) ? (
          <Alert variant="danger">Could not load engine readiness.</Alert>
        ) : (
          <ReadinessIndicator
            readiness={readiness}
            selectorMissCount={selectorMissCount}
          />
        )}
      </Section>

      <Section title="Captured posts">
        {isLoading(capture) ? (
          <Skeleton />
        ) : isError(capture) ? (
          <Alert variant="danger">Could not load capture summary.</Alert>
        ) : (
          <KeyValueList items={captureItems(capture)} />
        )}
      </Section>

      <Section title="Settings">
        {isLoading(settings) ? (
          <Skeleton />
        ) : isError(settings) ? (
          <Alert variant="danger">Could not load settings.</Alert>
        ) : (
          <div style={SECTION_STYLE}>
            {children}
            <JudgeProviderSection
              value={settings.judgeProvider}
              onCommit={(id) => onUpdateSettings({ ...settings, judgeProvider: id })}
            />
          </div>
        )}
      </Section>

      <Section title="Feedback loop">
        <FeedbackLoopSettingsSection
          summary={feedback}
          onRefresh={onRefreshFeedback}
          onLink={onLinkFeedback}
        />
      </Section>

      <Section title="External X signals">
        <ExternalXSignalsSettingsSection
          overview={externalXSignals}
          actionState={externalXSignalsAction}
          onAdd={onAddExternalXSignalSource}
          onRefreshSource={onRefreshExternalXSignalSource}
          onRemoveSource={onRemoveExternalXSignalSource}
          onRefreshOverview={onRefreshExternalXSignals}
        />
      </Section>

      <Section title="X archive">
        <ArchiveUploadSection onUpload={onUploadArchive} uploadState={uploadState} />
      </Section>
    </div>
  );
}
