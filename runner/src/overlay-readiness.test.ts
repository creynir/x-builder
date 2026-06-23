/**
 * Failing tests for the getOverlayReadiness composer.
 *
 * The module under test (`./overlay-readiness`) does not exist yet, so the
 * import below resolves to nothing until the implementation lands. That is the
 * intended Red state: these tests fail on a missing module, not on a logic
 * error in the test itself.
 *
 * Subject:
 *   async function getOverlayReadiness(
 *     engineReadinessService: ReadinessLike,
 *     observer: ObserverLike,
 *   ): Promise<OverlayReadiness>
 *
 * Structural seams Green must expose:
 *   type ReadinessLike = {
 *     getSubsystems(): Promise<{ staticEngine: SubsystemStatus; llm: SubsystemStatus }>;
 *   };
 *   type ObserverLike = {
 *     state: "ok" | "paused" | "layout_changed";
 *     lastCaptureAt?: string;
 *   };
 * (GraphQlCaptureObserver is structurally assignable to ObserverLike; the engine
 *  readiness service must expose a getSubsystems() returning the two subsystems.)
 *
 * The composer builds the `capture` block from the observer's current health
 * using a fixed label/message map and stamps `checkedAt = new Date().toISOString()`,
 * then returns `overlayReadinessSchema.parse({ staticEngine, llm, capture })`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  overlayReadinessSchema,
  type OverlayReadiness,
  type SubsystemStatus,
} from "@x-builder/shared";

import { getOverlayReadiness } from "./overlay-readiness";

const NOW_ISO = "2026-06-21T12:00:00.000Z";
const CAPTURED_AT = "2026-06-21T11:59:30.000Z";

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function healthySubsystem(label: string): SubsystemStatus {
  return {
    state: "ready",
    label,
    retryable: true,
    checkedAt: NOW_ISO,
    details: {},
  };
}

/**
 * A mock engine readiness service that returns two distinct, healthy subsystem
 * statuses so the test can assert they are passed through unchanged.
 */
function createMockReadinessService() {
  const staticEngine = healthySubsystem("Static engine ready");
  const llm = healthySubsystem("LLM ready");
  const getSubsystems = vi.fn(async () => ({ staticEngine, llm }));
  return { service: { getSubsystems }, getSubsystems, staticEngine, llm };
}

/** A structural stand-in for GraphQlCaptureObserver. */
function observerStub(
  state: "ok" | "paused" | "layout_changed",
  lastCaptureAt?: string,
): { state: typeof state; lastCaptureAt?: string } {
  return { state, lastCaptureAt };
}

// ---------------------------------------------------------------------------
// state: ok
// ---------------------------------------------------------------------------

describe("getOverlayReadiness — state ok", () => {
  it("reports the active label, carries lastCaptureAt, and omits the message", async () => {
    const readiness = createMockReadinessService();
    const observer = observerStub("ok", CAPTURED_AT);

    const result: OverlayReadiness = await getOverlayReadiness(readiness.service, observer);

    expect(() => overlayReadinessSchema.parse(result)).not.toThrow();
    expect(result.capture.state).toBe("ok");
    expect(result.capture.label).toBe("Feed capture active");
    expect(result.capture.lastCaptureAt).toBe(CAPTURED_AT);
    expect(result.capture.message).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// state: paused (fresh observer)
// ---------------------------------------------------------------------------

describe("getOverlayReadiness — state paused", () => {
  it("reports the waiting label with a non-empty guidance message and no lastCaptureAt", async () => {
    const readiness = createMockReadinessService();
    const observer = observerStub("paused");

    const result: OverlayReadiness = await getOverlayReadiness(readiness.service, observer);

    expect(() => overlayReadinessSchema.parse(result)).not.toThrow();
    expect(result.capture.state).toBe("paused");
    expect(result.capture.label).toBe("Waiting for feed");
    expect(result.capture.message).toBeDefined();
    expect((result.capture.message ?? "").length).toBeGreaterThan(0);
    expect(result.capture.lastCaptureAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// state: layout_changed
// ---------------------------------------------------------------------------

describe("getOverlayReadiness — state layout_changed", () => {
  it("reports the layout-drift label and a non-empty explanatory message", async () => {
    const readiness = createMockReadinessService();
    const observer = observerStub("layout_changed");

    const result: OverlayReadiness = await getOverlayReadiness(readiness.service, observer);

    expect(() => overlayReadinessSchema.parse(result)).not.toThrow();
    expect(result.capture.state).toBe("layout_changed");
    expect(result.capture.label).toBe(
      "Feed capture paused — X layout may have changed",
    );
    expect(result.capture.message).toBeDefined();
    expect((result.capture.message ?? "").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// composition: checkedAt + subsystem pass-through
// ---------------------------------------------------------------------------

describe("getOverlayReadiness — composition", () => {
  it("stamps a valid ISO checkedAt and passes the engine subsystems through unchanged", async () => {
    const readiness = createMockReadinessService();
    const observer = observerStub("ok", CAPTURED_AT);

    const result: OverlayReadiness = await getOverlayReadiness(readiness.service, observer);

    expect(readiness.getSubsystems).toHaveBeenCalledTimes(1);

    expect(result.capture.checkedAt).toMatch(ISO_DATETIME);
    expect(Number.isNaN(Date.parse(result.capture.checkedAt))).toBe(false);

    expect(result.staticEngine).toEqual(readiness.staticEngine);
    expect(result.llm).toEqual(readiness.llm);
  });
});
