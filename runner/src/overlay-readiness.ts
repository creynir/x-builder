/**
 * getOverlayReadiness (XOB-017) — composes the live overlay readiness view from
 * the engine's subsystem health plus the GraphQlCaptureObserver's capture state.
 *
 * Pure composition: it reads `getSubsystems()` (the in-process engine readiness
 * service, structurally) and the observer's current `state` / `lastCaptureAt`,
 * maps the state to a fixed label/message pair, stamps `checkedAt`, and returns a
 * schema-validated `OverlayReadiness`. No network, no observer internals.
 *
 * The real RunnerApp wiring (wrapping the engine ReadinessService into a
 * `getSubsystems()` adapter and registering this composer into the binding
 * bundle) is deferred to XOB-030.
 */

import {
  overlayReadinessSchema,
  type OverlayReadiness,
  type SubsystemStatus,
} from "@x-builder/shared";

/** A real engine readiness service (wrapped) is structurally assignable. */
export type ReadinessLike = {
  getSubsystems(): Promise<{ staticEngine: SubsystemStatus; llm: SubsystemStatus }>;
};

/** GraphQlCaptureObserver is structurally assignable to this. */
export type ObserverLike = {
  state: "ok" | "paused" | "layout_changed";
  lastCaptureAt?: string;
};

type CaptureState = ObserverLike["state"];

const LABEL: Record<CaptureState, string> = {
  ok: "Feed capture active",
  paused: "Waiting for feed",
  layout_changed: "Feed capture paused — X layout may have changed",
};

const MESSAGE: Record<CaptureState, string | undefined> = {
  ok: undefined,
  paused: "Navigate to your X profile or home feed to capture posts.",
  layout_changed:
    "Posts were detected but could not be parsed. X may have updated its page structure.",
};

export async function getOverlayReadiness(
  engineReadinessService: ReadinessLike,
  observer: ObserverLike,
): Promise<OverlayReadiness> {
  const { staticEngine, llm } = await engineReadinessService.getSubsystems();

  const state = observer.state;
  const message = MESSAGE[state];

  const capture = {
    state,
    label: LABEL[state],
    ...(message ? { message } : {}),
    ...(observer.lastCaptureAt ? { lastCaptureAt: observer.lastCaptureAt } : {}),
    checkedAt: new Date().toISOString(),
  };

  return overlayReadinessSchema.parse({ staticEngine, llm, capture });
}
