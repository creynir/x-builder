// @x-builder/overlay — settings-affordance fixture builders (test-only)
//
// Lightweight factory functions for the data the settings affordance consumes.
// They mirror the shapes the feature spec pins down in its Data Models block
// (the overlay UI layer's view of AppSettings / OverlayReadiness / CaptureSummary)
// rather than re-deriving the full Zod schemas from `@x-builder/shared` — the
// spec's settings panel reads a trimmed `AppSettings` carrying `judgeProvider`,
// `judgeReady`, and `activeContext`. Keeping the type local to the overlay test
// suite avoids Zod duplication and keeps the fixtures self-contained.

/**
 * The settings shape the affordance reads/writes. This is the UI-layer view the
 * feature spec prescribes: the `updateSettings` read-current-then-send-FULL
 * pattern round-trips exactly this object. Distinct from the broader engine
 * `AppSettings` — the overlay only surfaces these three fields plus an optional
 * account profile.
 */
export interface AppSettings {
  judgeProvider: string;
  judgeReady: boolean;
  activeContext: boolean;
  accountProfile?: string;
}

/** A subsystem readiness state as surfaced to the readiness indicator. */
export type ReadinessState =
  | "ready"
  | "warming"
  | "degraded"
  | "unavailable"
  | "unknown";

export interface SubsystemStatus {
  state: ReadinessState;
  label: string;
  message?: string;
  retryable: boolean;
  checkedAt: string;
  details?: unknown;
}

export type CaptureReadinessState = "ok" | "paused" | "layout_changed";

export interface OverlayReadiness {
  staticEngine: SubsystemStatus;
  llm: SubsystemStatus;
  capture: {
    state: CaptureReadinessState;
    label: string;
    message?: string;
    lastCaptureAt?: string;
    checkedAt: string;
  };
}

export interface CaptureSummary {
  postsCaptured: number;
  lastCaptureAt?: string;
  followers?: number;
  screenName?: string;
  profileCapturedAt?: string;
}

const ISO_NOW = "2026-06-21T00:00:00.000Z";

/**
 * Build an `AppSettings` view object. Defaults to the "ideal" state: an OpenAI
 * judge, ready, with active context on. Override any field per test.
 */
export function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    judgeProvider: "openai",
    judgeReady: true,
    activeContext: true,
    ...overrides,
  };
}

/** Build an `OverlayReadiness` object. Defaults to all-green / capture ok. */
export function makeOverlayReadiness(
  overrides: Partial<OverlayReadiness> = {},
): OverlayReadiness {
  return {
    staticEngine: {
      state: "ready",
      label: "Static engine ready",
      retryable: false,
      checkedAt: ISO_NOW,
    },
    llm: {
      state: "ready",
      label: "Judge ready",
      retryable: true,
      checkedAt: ISO_NOW,
    },
    capture: {
      state: "ok",
      label: "Capture ok",
      checkedAt: ISO_NOW,
    },
    ...overrides,
  };
}

/** Build a `CaptureSummary` object. Defaults to a populated summary. */
export function makeCaptureSummary(
  overrides: Partial<CaptureSummary> = {},
): CaptureSummary {
  return {
    postsCaptured: 42,
    lastCaptureAt: "2026-06-21",
    ...overrides,
  };
}
