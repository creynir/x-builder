// @x-builder/overlay — settings-affordance fixture builders (test-only)
//
// Lightweight factory functions for the data the settings affordance consumes.
// They produce the REAL shared shapes from `@x-builder/shared` (no re-derived
// Zod, no invented fields): the settings panel reads/writes the real
// `AppSettings`, the readiness indicator reads `OverlayReadiness`, the capture
// summary card reads `CaptureSummary`, and the active-context toggle reads
// `ActiveArchiveContext`. Active context is the archive-context activation — NOT
// a settings field — and judge readiness is surfaced via OverlayReadiness.llm.

import type {
  ActiveArchiveContext,
  AppSettings,
  CaptureSummary,
  OverlayReadiness,
  ReadinessState,
  SubsystemStatus,
} from "@x-builder/shared";

const ISO_NOW = "2026-06-21T00:00:00.000Z";

/**
 * Build a real `AppSettings` object (the full shared shape). Defaults to a valid
 * persisted-style configuration: a Codex judge, local engine URL, a storage
 * path, deterministic details on. Override any field per test. There is no
 * `judgeReady` or `activeContext` field — those are readiness / archive-context
 * concerns, not settings.
 */
export function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    engineBaseUrl: "http://127.0.0.1:4319",
    storagePath: "/home/user/.x-builder",
    judgeProvider: "codex-cli",
    showDeterministicDetails: true,
    ...overrides,
  };
}

/** Build a `SubsystemStatus` with the real defaults filled in. */
export function subsystem(
  overrides: Partial<SubsystemStatus> & { state: ReadinessState; label: string },
): SubsystemStatus {
  return {
    retryable: true,
    checkedAt: ISO_NOW,
    details: {},
    ...overrides,
  };
}

/** Build an `OverlayReadiness` object. Defaults to all-green / capture ok. */
export function makeOverlayReadiness(
  overrides: Partial<OverlayReadiness> = {},
): OverlayReadiness {
  return {
    staticEngine: subsystem({ state: "ready", label: "Static engine ready" }),
    llm: subsystem({ state: "ready", label: "Judge ready" }),
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
    lastCaptureAt: ISO_NOW,
    ...overrides,
  };
}

/**
 * Build an `ActiveArchiveContext` in the "active" status (toggle on). The
 * toggle's `checked` derives from `status === "active"`.
 */
export function makeActiveContext(
  overrides: Partial<Extract<ActiveArchiveContext, { status: "active" }>> = {},
): ActiveArchiveContext {
  return {
    status: "active",
    sourceImportId: "import-1",
    activatedAt: ISO_NOW,
    scoringContextPatch: {},
    judgeHints: [],
    provenance: "archive-import",
    confidence: "high",
    counts: { posts: 42, originals: 30, replies: 12 },
    ...overrides,
  };
}

/** The empty (deactivated) archive context — toggle off. */
export function makeEmptyContext(): ActiveArchiveContext {
  return { status: "empty" };
}
