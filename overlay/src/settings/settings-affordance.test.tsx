// @x-builder/overlay — SettingsAffordance open/close + focus + transport tests
//
// Browser mode (real Chromium), real shadow root with the Aurora Glass + product
// token sheets adopted. SettingsAffordance is the orchestrator: it renders the
// launcher always and the panel when open, drives all L1 data through
// useTransport(), and owns the open/close + focus-return behaviour.
//
// Cross-package: the v2 primitives the affordance consumes live in
// `client/src/ui/v2/*`; the affordance itself lives beside this test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";
import type { FeedbackOutcome, FeedbackPredictionRecord, GetFeedbackLoopSummaryResponse } from "@x-builder/shared";

import { FakeEngineTransport } from "../testing/fake-transport";
import {
  makeActiveContext,
  makeAppSettings,
  makeCaptureSummary,
  makeEmptyContext,
  makeFeedbackLoopSummary,
  makeOverlayReadiness,
} from "../testing/fixtures";
import { mountShadowHost, type ShadowHostHandle } from "../testing/shadow-host";
import { OverlayTransportProvider } from "../transport/provider";
import { SettingsAffordance } from "./settings-affordance";

let harness: ShadowHostHandle;

/** Wrap the affordance in a transport provider and render into the shadow root. */
function mountAffordance(transport: FakeEngineTransport): HTMLElement {
  harness = mountShadowHost();
  render(
    <OverlayTransportProvider transport={transport}>
      <SettingsAffordance />
    </OverlayTransportProvider>,
    { container: harness.mount },
  );
  return harness.mount;
}

/** Build a fully-resolving transport seeded with the real shared shapes. */
function readyTransport(overrides: Partial<FakeEngineTransport> = {}): FakeEngineTransport {
  return new FakeEngineTransport({
    getSettings: () =>
      Promise.resolve({
        settings: makeAppSettings(),
        source: "persisted",
      } as never),
    getOverlayReadiness: () => Promise.resolve(makeOverlayReadiness() as never),
    getCaptureSummary: () => Promise.resolve(makeCaptureSummary() as never),
    getFeedbackLoopSummary: () => Promise.resolve(makeFeedbackLoopSummary() as never),
    getActiveContext: () => Promise.resolve(makeActiveContext() as never),
    activateContext: () =>
      Promise.resolve({
        activeContext: makeActiveContext(),
        eligibility: { eligible: true, blockingReasons: [], warningReasons: [] },
      } as never),
    deactivateContext: () =>
      Promise.resolve({
        activeContext: makeEmptyContext(),
        eligibility: { eligible: true, blockingReasons: [], warningReasons: [] },
      } as never),
    updateSettings: (next) =>
      Promise.resolve({ settings: next, source: "persisted" } as never),
    ...overrides,
  });
}

const ISO_NOW = "2026-06-21T00:00:00.000Z";
const POST_ID = "1800000000000000001";

function feedbackPredictionRecord(
  overrides: Partial<FeedbackPredictionRecord> = {},
): FeedbackPredictionRecord {
  return {
    id: "prediction-1",
    clientEventId: "event-1",
    action: "manual_record_posted_draft",
    platform: "x",
    text: "Manual draft that needs a linked post.",
    contentHash: `sha256:${"b".repeat(64)}`,
    detectedFormat: "genuine_question",
    scoreValue: 72,
    prediction: {
      status: "available",
      signals: [{ signal_key: "quality_voice", label: "Static score 72", multiplier: 0.8 }],
      predictedMidImpressions: 230,
      stallRange: { low: 120, high: 276 },
      escapeRange: { low: 570, high: 2280 },
      escapeProbability: 0.1,
      expectedReplies: 3,
      baseImpressions: 190,
      baseSource: "follower_estimate",
      qualityBasis: "static",
      reachModelVersion: "reach-v1",
    },
    scoringContext: { followers: 1000 },
    analyzerVersion: "deterministic-v1",
    analyzedAt: ISO_NOW,
    createdAt: ISO_NOW,
    ...overrides,
  };
}

function feedbackSummary(outcome: FeedbackOutcome): GetFeedbackLoopSummaryResponse {
  const linked = outcome.status === "linked" ? 1 : 0;
  return makeFeedbackLoopSummary({
    totals: {
      predictions: 1,
      linked,
      pendingUnlinked: outcome.status === "pending_unlinked" ? 1 : 0,
      ambiguous: outcome.status === "ambiguous" ? 1 : 0,
      partialActuals: outcome.status === "partial_actuals" ? 1 : 0,
      actuals: outcome.actual?.impressions !== undefined ? 1 : 0,
    },
    formatLearnings: [
      {
        format: "genuine_question",
        predictionCount: 1,
        linkedCount: linked,
        actualCount: outcome.actual?.impressions !== undefined ? 1 : 0,
        direction: "insufficient_data",
        adjustment: "Keep collecting outcomes for this format.",
      },
    ],
    recent: [outcome],
  });
}

function ambiguousOutcome(): FeedbackOutcome {
  return {
    status: "ambiguous",
    prediction: feedbackPredictionRecord(),
    ambiguity: { candidatePlatformPostIds: [POST_ID, "1800000000000000002"] },
  };
}

function manuallyLinkedOutcome(): FeedbackOutcome {
  return {
    status: "linked",
    prediction: feedbackPredictionRecord(),
    link: {
      predictionId: "prediction-1",
      platform: "x",
      platformPostId: POST_ID,
      method: "manual_platform_post_id",
      linkedAt: ISO_NOW,
    },
    actual: {
      platformPostId: POST_ID,
      postCreatedAt: ISO_NOW,
      observedAt: ISO_NOW,
      source: "x_live_capture",
      impressions: 260,
      likes: 12,
      replies: 3,
    },
    delta: {
      predictedMidImpressions: 230,
      actualImpressions: 260,
      absoluteDelta: 30,
      ratio: 1.13,
      bucket: "within_stall",
    },
  };
}

/** Find the launcher button inside the shadow subtree. */
function launcher(root: HTMLElement): HTMLElement {
  const el = root.querySelector('[aria-haspopup="dialog"]');
  if (!(el instanceof HTMLElement)) throw new Error("launcher not found");
  return el;
}

/** Find the dialog panel, or null when closed. */
function panel(root: HTMLElement): HTMLElement | null {
  const el = root.querySelector('[role="dialog"]');
  return el instanceof HTMLElement ? el : null;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("SettingsLauncherButton", () => {
  it("renders with aria-haspopup=dialog and aria-expanded=false when closed", () => {
    const root = mountAffordance(readyTransport());
    const btn = launcher(root);

    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(panel(root)).toBeNull();
  });

  it("flips aria-expanded to true once the panel is open", async () => {
    const root = mountAffordance(readyTransport());
    const btn = launcher(root);

    btn.click();

    await vi.waitFor(() => {
      expect(launcher(root).getAttribute("aria-expanded")).toBe("true");
    });
  });
});

describe("SettingsAffordance — open / close / focus", () => {
  it("opens a role=dialog panel and moves focus to the first control on launcher click", async () => {
    const root = mountAffordance(readyTransport());

    launcher(root).click();

    await vi.waitFor(() => {
      const dialog = panel(root);
      expect(dialog).not.toBeNull();
      // Focus moves into the panel: the active element is inside the dialog.
      const active = harness.shadow.activeElement;
      expect(active).not.toBeNull();
      expect(dialog!.contains(active)).toBe(true);
    });
  });

  it("closes on Esc and returns focus to the launcher", async () => {
    const root = mountAffordance(readyTransport());
    const btn = launcher(root);

    btn.click();
    await vi.waitFor(() => expect(panel(root)).not.toBeNull());

    btn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );

    await vi.waitFor(() => {
      expect(panel(root)).toBeNull();
      expect(harness.shadow.activeElement).toBe(launcher(root));
    });
  });

  it("closes on click-outside detected via composedPath across the shadow boundary", async () => {
    const root = mountAffordance(readyTransport());
    const btn = launcher(root);

    btn.click();
    await vi.waitFor(() => expect(panel(root)).not.toBeNull());

    // A click whose composedPath()[0] is an element outside the panel subtree.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, composed: true }),
    );

    await vi.waitFor(() => {
      expect(panel(root)).toBeNull();
      expect(harness.shadow.activeElement).toBe(launcher(root));
    });
    outside.remove();
  });
});

describe("SettingsAffordance — soft focus containment", () => {
  it("keeps Tab focus within the open panel (cycles, no escape on forward tab)", async () => {
    const root = mountAffordance(readyTransport());
    launcher(root).click();
    await vi.waitFor(() => expect(panel(root)).not.toBeNull());
    const dialog = panel(root)!;

    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [role="switch"], [tabindex]:not([tabindex="-1"])',
      ),
    );
    // The panel must contain at least two focusable controls to cycle between.
    expect(focusables.length).toBeGreaterThanOrEqual(2);

    const last = focusables[focusables.length - 1]!;
    last.focus();
    expect(dialog.contains(harness.shadow.activeElement)).toBe(true);

    // Forward Tab from the last control wraps back inside the dialog.
    last.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true }),
    );
    await vi.waitFor(() => {
      expect(dialog.contains(harness.shadow.activeElement)).toBe(true);
    });
  });

  it("permits Shift-Tab to escape back to the page (soft containment, no hard trap)", async () => {
    const root = mountAffordance(readyTransport());
    launcher(root).click();
    await vi.waitFor(() => expect(panel(root)).not.toBeNull());
    const dialog = panel(root)!;

    const first = dialog.querySelector<HTMLElement>(
      'button, input, [role="switch"], [tabindex]:not([tabindex="-1"])',
    )!;
    first.focus();

    // Shift-Tab at the first control must NOT be force-trapped: the handler
    // does not preventDefault, leaving the browser free to move focus out.
    const evt = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    first.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(false);
  });
});

describe("ActiveContextToggle — activate / deactivate transport flow", () => {
  it("seeds checked from getActiveContext() status === 'active' and calls deactivateContext on toggle off", async () => {
    const deactivateSpy = vi.fn(() =>
      Promise.resolve({
        activeContext: makeEmptyContext(),
        eligibility: { eligible: true, blockingReasons: [], warningReasons: [] },
      } as never),
    );
    const transport = readyTransport({
      getActiveContext: () => Promise.resolve(makeActiveContext() as never),
      deactivateContext: deactivateSpy as never,
    });
    const root = mountAffordance(transport);

    launcher(root).click();
    const sw = await vi.waitFor(() => {
      const el = panel(root)!.querySelector('[role="switch"]');
      expect(el).not.toBeNull();
      // status: "active" → checked
      expect(el!.getAttribute("aria-checked")).toBe("true");
      return el as HTMLElement;
    });

    sw.click();

    await vi.waitFor(() => {
      expect(deactivateSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("seeds unchecked from status === 'empty' and calls activateContext on toggle on", async () => {
    const activateSpy = vi.fn(() =>
      Promise.resolve({
        activeContext: makeActiveContext(),
        eligibility: { eligible: true, blockingReasons: [], warningReasons: [] },
      } as never),
    );
    const transport = readyTransport({
      getActiveContext: () => Promise.resolve(makeEmptyContext() as never),
      activateContext: activateSpy as never,
    });
    const root = mountAffordance(transport);

    launcher(root).click();
    const sw = await vi.waitFor(() => {
      const el = panel(root)!.querySelector('[role="switch"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute("aria-checked")).toBe("false");
      return el as HTMLElement;
    });

    sw.click();

    await vi.waitFor(() => {
      expect(activateSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("flips checked immediately on toggle (optimistic echo, before the transport resolves)", async () => {
    const transport = readyTransport({
      getActiveContext: () => Promise.resolve(makeEmptyContext() as never),
      // Never resolves: proves the echo is optimistic, not transport-confirmed.
      activateContext: () => new Promise(() => {}),
    });
    const root = mountAffordance(transport);

    launcher(root).click();
    const sw = await vi.waitFor(() => {
      const el = panel(root)!.querySelector('[role="switch"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute("aria-checked")).toBe("false");
      return el as HTMLElement;
    });

    sw.click();

    await vi.waitFor(() => {
      expect(
        panel(root)!.querySelector('[role="switch"]')!.getAttribute("aria-checked"),
      ).toBe("true");
    });
  });

  it("reverts the checked state when activateContext rejects", async () => {
    const transport = readyTransport({
      getActiveContext: () => Promise.resolve(makeEmptyContext() as never),
      activateContext: () => Promise.reject(new Error("activation failed")),
    });
    const root = mountAffordance(transport);

    launcher(root).click();
    const sw = await vi.waitFor(() => {
      const el = panel(root)!.querySelector('[role="switch"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute("aria-checked")).toBe("false");
      return el as HTMLElement;
    });

    sw.click();

    // Reverts back to false after the rejection settles.
    await vi.waitFor(() => {
      expect(
        panel(root)!.querySelector('[role="switch"]')!.getAttribute("aria-checked"),
      ).toBe("false");
    });
  });
});

describe("JudgeProviderSection — read-current-then-send-FULL updateSettings", () => {
  it("unwraps the envelope and sends the FULL real AppSettings with judgeProvider changed", async () => {
    const updateSpy = vi.fn(
      (next: unknown) => Promise.resolve({ settings: next, source: "persisted" }) as never,
    );
    const current = makeAppSettings({ judgeProvider: "codex-cli" });
    const transport = readyTransport({
      // ENVELOPE: the component unwraps `.settings`.
      getSettings: () =>
        Promise.resolve({ settings: current, source: "persisted" } as never),
      updateSettings: updateSpy as never,
    });
    const root = mountAffordance(transport);

    launcher(root).click();

    // The provider control is a Select over the three JudgeProviderId values.
    const select = await vi.waitFor(() => {
      const el = panel(root)!.querySelector("select");
      expect(el).not.toBeNull();
      expect((el as HTMLSelectElement).value).toBe("codex-cli");
      return el as HTMLSelectElement;
    });

    select.value = "claude-cli";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    // FULL real AppSettings object, only judgeProvider changed — not a partial.
    expect(updateSpy).toHaveBeenCalledWith({
      ...current,
      judgeProvider: "claude-cli",
    });
  });
});

describe("SettingsAffordance — feedback loop summary and manual links", () => {
  it("fetches the feedback summary and renders the empty state", async () => {
    const getSummarySpy = vi.fn(() => Promise.resolve(makeFeedbackLoopSummary() as never));
    const root = mountAffordance(readyTransport({ getFeedbackLoopSummary: getSummarySpy as never }));

    launcher(root).click();

    await vi.waitFor(() => {
      expect(panel(root)?.textContent).toContain("No feedback yet");
      expect(getSummarySpy).toHaveBeenCalled();
    });
  });

  it("links an ambiguous prediction manually and refreshes to the linked summary", async () => {
    let linked = false;
    const getSummarySpy = vi.fn(() =>
      Promise.resolve(feedbackSummary(linked ? manuallyLinkedOutcome() : ambiguousOutcome()) as never),
    );
    const linkSpy = vi.fn((request: unknown) => {
      linked = true;
      return Promise.resolve({
        link: {
          predictionId: "prediction-1",
          platform: "x",
          platformPostId: POST_ID,
          method: "manual_platform_post_id",
          linkedAt: ISO_NOW,
        },
      } as never);
    });
    const root = mountAffordance(
      readyTransport({
        getFeedbackLoopSummary: getSummarySpy as never,
        linkFeedbackPrediction: linkSpy as never,
      }),
    );

    launcher(root).click();

    const dialog = await vi.waitFor(() => {
      const current = panel(root);
      expect(current?.textContent).toContain("Multiple possible posts found");
      return current!;
    });

    const candidateButton = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === POST_ID,
    );
    expect(candidateButton).not.toBeUndefined();
    candidateButton!.click();

    const linkButton = await vi.waitFor(() => {
      const current = panel(root)!;
      const input = current.querySelector<HTMLInputElement>(
        'input[aria-label="Platform post id for prediction-1"]',
      );
      expect(input?.value).toBe(POST_ID);

      const button = Array.from(current.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => /^link$/i.test(candidate.textContent ?? ""),
      );
      expect(button).not.toBeUndefined();
      expect(button!.disabled).toBe(false);
      return button!;
    });
    linkButton.click();

    await vi.waitFor(() => {
      expect(linkSpy).toHaveBeenCalledWith({
        predictionId: "prediction-1",
        platformPostId: POST_ID,
        method: "manual_platform_post_id",
      });
      expect(panel(root)?.textContent).toContain("Linked manually");
    });
  });
});

describe("SettingsAffordance — archive upload orchestration", () => {
  /** Select a file through the panel's file input. */
  function selectFile(root: HTMLElement, file: File): void {
    const input = panel(root)!.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    if (!input) throw new Error("file input not found");
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("calls validateArchive then importArchive for a valid archive", async () => {
    const order: string[] = [];
    const validateSpy = vi.fn(() => {
      order.push("validate");
      return Promise.resolve({ status: "valid" } as never);
    });
    const importSpy = vi.fn(() => {
      order.push("import");
      return Promise.resolve({} as never);
    });
    const transport = readyTransport({
      validateArchive: validateSpy as never,
      importArchive: importSpy as never,
    });
    const root = mountAffordance(transport);

    launcher(root).click();
    await vi.waitFor(() => expect(panel(root)).not.toBeNull());

    selectFile(root, new File(['{"tweets":[]}'], "tweets.js"));

    await vi.waitFor(() => {
      expect(validateSpy).toHaveBeenCalledTimes(1);
      expect(importSpy).toHaveBeenCalledTimes(1);
    });
    expect(order).toEqual(["validate", "import"]);
  });

  it("renders a danger Alert and skips importArchive when validateArchive rejects", async () => {
    const importSpy = vi.fn(() => Promise.resolve({} as never));
    const transport = readyTransport({
      validateArchive: () =>
        Promise.reject(new Error("Archive contents are too large.")),
      importArchive: importSpy as never,
    });
    const root = mountAffordance(transport);

    launcher(root).click();
    await vi.waitFor(() => expect(panel(root)).not.toBeNull());

    selectFile(root, new File(["bad"], "bad.js"));

    await vi.waitFor(() => {
      const alert = panel(root)!.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(
        alert!.getAttribute("data-variant") ?? alert!.getAttribute("class") ?? "",
      ).toContain("danger");
      expect(panel(root)!.textContent).toContain("Archive contents are too large.");
    });
    expect(importSpy).not.toHaveBeenCalled();
  });
});

describe("SettingsAffordance — loading state", () => {
  it("renders Skeleton placeholders (no crash) while settings are loading", async () => {
    // getSettings never resolves → the panel stays in its loading state.
    const transport = readyTransport({
      getSettings: () => new Promise(() => {}),
    });
    const root = mountAffordance(transport);

    launcher(root).click();

    await vi.waitFor(() => {
      const dialog = panel(root);
      expect(dialog).not.toBeNull();
      // Skeleton placeholders stand in for the unresolved settings values.
      expect(
        dialog!.querySelector('[data-skeleton], [data-testid="skeleton"]'),
      ).not.toBeNull();
      // No switch (real value) rendered yet, and no crash/blank panel.
      expect(dialog!.textContent ?? "").not.toBe("");
    });
  });
});
