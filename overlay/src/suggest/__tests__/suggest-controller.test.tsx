// @x-builder/overlay — SuggestController tests (browser mode → Playwright Chromium)
//
// The parent that resolves the orphaned `SuggestAffordance`: it owns `open`,
// loads via `transport.suggestPost()` on the open-when-idle edge, maps the
// `SuggestPostResponse` into a `SuggestState`, performs the explicit-gesture
// composer-write on "Use this", and renders only while X's compose modal is NOT
// active. These tests pin those four contracts against the production-shaped
// tree (`OverlayTransportProvider` ⊃ `AnchorLayer` ⊃ controller), driving the
// compose gate honestly through the presence/absence of an X composer fixture in
// `document.body` — the same mechanism the cockpit integration suite uses.
//
// Real shapes only: `suggestPost` resolves a genuine `SuggestPostResponse`
// (status/suggestions/cooldown/minimumCorpusSize) from `@x-builder/shared`, so
// the response→state mapping is exercised against the exact bytes the engine
// emits.

import type { SuggestPostResponse } from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { AnchorLayer } from "../../anchor-layer";
import { insertXComposer, removeAllXComposers } from "../../testing/compose-cockpit";
import { FakeEngineTransport } from "../../testing/fake-transport";
import { OverlayTransportProvider } from "../../transport/provider";
import { SuggestController } from "../suggest-controller";

// ---------------------------------------------------------------------------
// Harness — synchronous rAF (the AnchorLayer reconcile is rAF-gated).
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  removeAllXComposers();
  vi.unstubAllGlobals();
});

/** Mount the controller in the production-shaped tree with the injected fake. */
function mountController(fake: FakeEngineTransport): HTMLElement {
  const { container } = render(
    <OverlayTransportProvider transport={fake}>
      <AnchorLayer>
        <SuggestController />
      </AnchorLayer>
    </OverlayTransportProvider>,
  );
  return container as HTMLElement;
}

/** Yield to the event loop so React commits and pending microtasks settle. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Drain commit/async cycles UNTIL `predicate` holds (open re-render → load →
 * suggestPost microtask → map → re-render is a chain of async hops that a single
 * fixed tick does not deterministically flush). Bounded so a genuine regression
 * throws rather than hangs.
 */
async function drainUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !predicate(); i += 1) {
    await tick();
  }
}

/** A ready `SuggestPostResponse` whose chosen lane carries a warming signal. */
const READY_TEXT = "Here's a hot take worth posting about TypeScript inference.";

function makeReadyResponse(): SuggestPostResponse {
  return {
    status: "ready",
    suggestions: [
      {
        id: "s1",
        format: "hot_take",
        angle: "caution",
        text: READY_TEXT,
        rationale: "You haven't posted a hot take in 3 days.",
        cooldownStatus: "warming",
        sourceExamplePostIds: ["p1"],
        generatedBy: "llm",
      },
    ],
    cooldown: {
      windowDays: 7,
      generatedAt: "2026-06-22T00:00:00.000Z",
      corpusSource: "live",
      signals: [
        {
          format: "hot_take",
          countInWindow: 2,
          windowDays: 7,
          status: "warming",
          message: "2 hot takes this week",
        },
      ],
    },
    minimumCorpusSize: 10,
  };
}

function buttons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
}

/** The launcher (the only button while closed). */
function launcher(root: ParentNode): HTMLButtonElement {
  const btn = buttons(root)[0];
  if (btn === undefined) throw new Error("launcher not found");
  return btn;
}

function useThisButton(root: ParentNode): HTMLButtonElement | undefined {
  return buttons(root).find((b) => /use this/i.test(b.textContent ?? ""));
}

// ===========================================================================
// 1. Loads on the open-when-idle edge — clicking the launcher calls suggestPost.
// ===========================================================================

describe("SuggestController — loads on open-when-idle", () => {
  it("calls suggestPost() exactly once when the launcher opens the idle card", async () => {
    const suggestPost = vi.fn(async () => makeReadyResponse());
    const fake = new FakeEngineTransport({ suggestPost });
    const root = mountController(fake);

    // Closed + idle: nothing loaded yet, so no transport call on mount.
    expect(suggestPost).not.toHaveBeenCalled();

    launcher(root).click();
    await drainUntil(() => suggestPost.mock.calls.length > 0);

    expect(suggestPost).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 2. Maps the response → ready state (text + rationale + "Use this" surface).
// ===========================================================================

describe("SuggestController — maps SuggestPostResponse → ready state", () => {
  it("renders the suggestion text, rationale, and a 'Use this' affordance", async () => {
    const fake = new FakeEngineTransport({
      suggestPost: async () => makeReadyResponse(),
    });
    const root = mountController(fake);

    launcher(root).click();
    await drainUntil(() => useThisButton(root) !== undefined);

    expect(root.textContent).toContain(READY_TEXT);
    expect(root.textContent).toContain("You haven't posted a hot take in 3 days.");
    expect(useThisButton(root)).toBeDefined();
  });
});

// ===========================================================================
// 3. "Use this" → the explicit-gesture composer write with the EXACT text.
// ===========================================================================

describe("SuggestController — 'Use this' performs the composer write", () => {
  it("writes the exact suggestion text into X's composer and fires input", async () => {
    // The inline (non-modal) X composer present on the home/profile route. It is
    // NOT wrapped in a [role=dialog], so ComposeContext stays inactive and the
    // suggest surface remains mounted.
    const composer = document.createElement("div");
    composer.dataset.testid = "tweetTextarea_0";
    composer.setAttribute("contenteditable", "true");
    document.body.append(composer);

    let inputFired = false;
    composer.addEventListener("input", () => {
      inputFired = true;
    });

    try {
      const fake = new FakeEngineTransport({
        suggestPost: async () => makeReadyResponse(),
      });
      const root = mountController(fake);

      launcher(root).click();
      await drainUntil(() => useThisButton(root) !== undefined);

      const useThis = useThisButton(root);
      expect(useThis).toBeDefined();
      useThis!.click();

      // The EXACT suggestion text was written into the composer, and an input
      // event fired so X/React notice the programmatic edit. No auto-post.
      expect(composer.textContent).toBe(READY_TEXT);
      expect(inputFired).toBe(true);
    } finally {
      composer.remove();
    }
  });
});

// ===========================================================================
// 4. Does NOT render while the compose modal is active (the gate).
// ===========================================================================

describe("SuggestController — hidden while ComposeContext is active", () => {
  it("renders nothing while X's compose modal is present in the DOM", async () => {
    // The compose modal fixture: a [role=dialog] ⊃ tweetTextarea_0 makes
    // ComposeContext.isActive true, so the suggest surface must stay unmounted.
    insertXComposer();

    const suggestPost = vi.fn(async () => makeReadyResponse());
    const fake = new FakeEngineTransport({ suggestPost });
    const root = mountController(fake);

    /** The suggest launcher inside the render container, by its aria-label. */
    const launcherButton = (): HTMLButtonElement | undefined =>
      buttons(root).find((b) => b.getAttribute("aria-label") === "Suggest a post");

    // The AnchorLayer's initial reconcile detects the modal in an effect (after
    // first commit), so drain until the gate has unmounted the surface.
    await drainUntil(() => launcherButton() === undefined);

    // No suggest launcher renders while compose is active.
    expect(launcherButton()).toBeUndefined();
    // And it never loads while gated off.
    expect(suggestPost).not.toHaveBeenCalled();
  });
});
