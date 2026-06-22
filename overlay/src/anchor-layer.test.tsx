import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { AnchorLayer, useAnchorRegistry } from "./anchor-layer";

/**
 * AnchorLayer is a skeleton at this ticket: it mounts a single rAF-batched,
 * ~150ms-debounced MutationObserver on document.body, keeps an (empty) node→pin
 * registry, and disconnects the observer on `visibilitychange` → hidden. Zero
 * matches is a valid, error-free state. These tests mock rAF to run
 * synchronously so the reconcile path is exercisable, and drive timers so the
 * debounce window elapses.
 */

const SCRATCH_ID = "xb-anchor-scratch";

/** Force document.visibilityState to a chosen value and fire the event. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  // Run any requestAnimationFrame callback synchronously so the batched
  // reconcile is observable in a unit test (JSDOM/Chromium headless rAF gate).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  document.getElementById(SCRATCH_ID)?.remove();
  setVisibility("visible");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AnchorLayer — mount with empty DOM", () => {
  it("renders nothing visible, throws nothing, and keeps an empty registry", () => {
    let registrySize = -1;

    function Probe(): null {
      registrySize = useAnchorRegistry().size;
      return null;
    }

    expect(() =>
      render(
        <AnchorLayer>
          <Probe />
        </AnchorLayer>,
      ),
    ).not.toThrow();

    expect(registrySize).toBe(0);
  });
});

describe("AnchorLayer — MutationObserver reconcile", () => {
  it("fires on document.body mutation, runs reconcile, and stays empty with no XSelectors targets", () => {
    let registrySize = -1;

    function Probe(): null {
      registrySize = useAnchorRegistry().size;
      return null;
    }

    render(
      <AnchorLayer>
        <Probe />
      </AnchorLayer>,
    );

    // Mutate document.body — add then remove a non-matching node.
    const node = document.createElement("div");
    node.id = SCRATCH_ID;
    expect(() => {
      document.body.appendChild(node);
      // Flush the ~150ms debounce so the scheduled reconcile tick runs.
      vi.advanceTimersByTime(200);
      node.remove();
      vi.advanceTimersByTime(200);
    }).not.toThrow();

    // No COMPOSER/TWEET targets exist → registry remains empty.
    expect(registrySize).toBe(0);
  });
});

describe("AnchorLayer — visibilitychange teardown", () => {
  it("disconnects its MutationObserver when document.visibilityState becomes hidden", () => {
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, "disconnect");

    render(<AnchorLayer />);

    const callsBefore = disconnectSpy.mock.calls.length;

    setVisibility("hidden");

    expect(disconnectSpy.mock.calls.length).toBeGreaterThan(callsBefore);

    disconnectSpy.mockRestore();
  });
});
