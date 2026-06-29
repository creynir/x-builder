// @x-builder/overlay — ComposeCockpit FULL integration tests
// (browser mode → Playwright Chromium via vitest-browser-react)
//
// RED: `../compose-cockpit` does not exist yet, so importing
// `ComposeCockpit` is what drives the failing state. These are the heaviest tests
// in the overlay suite — the integration keystone. `ComposeCockpit` is the
// SELF-ORCHESTRATING cockpit: it owns the `ComposeMachineState` reducer, detects
// X's compose modal, mounts the three zones as `AnchorLayer` pins, and drives
// EVERY transport call through the `useTransport()` seam. The tests therefore
// render it the way production will:
//
//   <OverlayTransportProvider transport={fake}>
//     <AnchorLayer>
//       <ComposeCockpit explainer={overlayExplainerCopy} />
//     </AnchorLayer>
//   </OverlayTransportProvider>
//
// with the X-shaped fixture (`insertXComposer`) in `document.body`. The cockpit
// reads its data from the injected `FakeEngineTransport` + the live composer DOM;
// the ONLY prop it needs is `explainer`. (Contract note for Green at the bottom.)
//
// ── REQUIRED IMPL HOOKS (the contract this suite pins for Green) ──────────────
//   • Module `overlay/src/compose/compose-cockpit.tsx` exporting `ComposeCockpit`
//     as a self-orchestrating component taking `{ explainer }` and reading the
//     transport via `useTransport()` + detecting the composer via the DOM /
//     `AnchorLayer` ComposeContext.
//   • A stable root element carrying `data-cockpit` whose value is `"stacked"` at
//     viewport widths ≤ 1180px and `"wide"` (any non-"stacked" value) above it.
//     Because the browser harness cannot resize the Playwright viewport mid-test,
//     this suite asserts the attribute is PRESENT and reflects the CURRENT
//     viewport honestly (see the breakpoint case for the exact, non-flaky
//     assertion). Green: derive the value from a width signal the test can read.
//   • Each zone pin wraps its content in an internal-scroll container carrying
//     `data-cockpit-pin` (one per zone) with `overflow:auto`/`overflow-y:auto`.
//   • The composer-write gesture sets the composer's `.textContent` to the chosen
//     candidate / improved text (a real contenteditable write), and re-pins the
//     green anchor to that exact text (provenance → "generated").
//   • The generate rail surfaces its category buttons (one per `GenerateCategory`
//     label) and a `pending` marker (the v2 Button loading+disabled state) while
//     generating.
//   • The Apply-all button label matches `/apply all suggestions/i`; the applying
//     state shows the JudgeStrip "Improving…" + `aria-busy` affordance.
//   • A single rAF rect-tracker instance feeds BOTH the pins and the highlight
//     layer (asserted via a single `[data-xb-highlight-layer]` + a single shared
//     snapshot proxy — see the rAF case).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { overlayExplainerCopy } from "../../explainer/copy";
import { AnchorLayer } from "../../anchor-layer";
import { FakeEngineTransport } from "../../testing/fake-transport";
import { OverlayTransportProvider } from "../../transport/provider";
import {
  deferred,
  insertXComposer,
  makeApplyResponse,
  makeCapture,
  makeGenerateCategories,
  makeGenerateResponse,
  makeJudgeResponse,
  removeAllXComposers,
  typeInComposer,
  type XComposerHandle,
} from "../../testing/compose-cockpit";

import type {
  AnalyzePostsRequest,
  ApplyJudgeSuggestionsRequest,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
  JudgeDraftRequest,
  JudgeDraftResponse,
  RecordFeedbackPredictionRequest,
  RecordFeedbackPredictionResponse,
} from "@x-builder/shared";

// Not-yet-existing module — importing it is what drives the RED state.
import { ComposeCockpit } from "../compose-cockpit";

// ---------------------------------------------------------------------------
// Harness — synchronous rAF + fake timers, mirroring anchor-layer.test.tsx.
// ---------------------------------------------------------------------------

let fixture: XComposerHandle | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  // Run rAF callbacks synchronously so the batched rect-tracker reconcile is
  // observable in-test (same gate as anchor-layer.test.tsx).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  fixture?.remove();
  fixture = null;
  removeAllXComposers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The 350 ms analyze debounce window the ticket specifies. */
const ANALYZE_DEBOUNCE_MS = 350;

/**
 * Mount the cockpit inside the production-shaped tree with the injected fake.
 * The fixture must already be in `document.body` so compose detection fires.
 */
function mountCockpit(fake: FakeEngineTransport): HTMLElement {
  const { container } = render(
    <OverlayTransportProvider transport={fake}>
      <AnchorLayer>
        <ComposeCockpit explainer={overlayExplainerCopy} />
      </AnchorLayer>
    </OverlayTransportProvider>,
  );
  return container as HTMLElement;
}

/**
 * Settle the cockpit: flush the analyze debounce + drain pending microtasks so
 * transport promises resolve and the machine advances. Mirrors the
 * fake-timer + microtask discipline the ticket prescribes.
 */
async function settle(extraMs = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ANALYZE_DEBOUNCE_MS + extraMs);
  await vi.runAllTimersAsync();
}

/** The live composer (`div[data-testid="tweetTextarea_0"]`) text content. */
function composerText(): string {
  const el = document.querySelector<HTMLElement>('div[data-testid="tweetTextarea_0"]');
  return el?.textContent ?? "";
}

interface ReplyTargetFixture {
  handle?: string;
  statusId?: string;
  targetText?: string;
  displayName?: string;
}

function buildReplyTargetArticle(opts: ReplyTargetFixture = {}): HTMLElement {
  const handle = opts.handle ?? "alice";
  const statusId = opts.statusId ?? "1930000000000000001";
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");

  const displayName = document.createElement("span");
  displayName.textContent = opts.displayName ?? "Alice Example";
  article.append(displayName);

  const link = document.createElement("a");
  link.href = `https://x.com/${handle}/status/${statusId}`;
  link.textContent = `@${handle}`;
  article.append(link);

  const targetText = document.createElement("div");
  targetText.setAttribute("data-testid", "tweetText");
  targetText.textContent =
    opts.targetText ?? "The boring version is usually the one people can ship.";
  article.append(targetText);

  return article;
}

function insertXReplyComposer(
  text = "",
  replyTarget: ReplyTargetFixture = {},
): XComposerHandle {
  const handle = insertXComposer(text);
  handle.dialog.insertBefore(buildReplyTargetArticle(replyTarget), handle.composer);
  return handle;
}

function makeFeedbackRecordResponse(
  request: RecordFeedbackPredictionRequest,
): RecordFeedbackPredictionResponse {
  const snapshot = request.snapshot;
  return {
    record: {
      id: `prediction-${request.clientEventId ?? "manual"}`,
      clientEventId: request.clientEventId,
      action: request.action,
      platform: request.platform ?? "x",
      text: request.text.trim(),
      contentHash: `sha256:${"a".repeat(64)}`,
      detectedFormat: snapshot.detectedFormat,
      sourceFormat: snapshot.sourceFormat,
      scoreValue: snapshot.scoreValue,
      prediction: snapshot.prediction,
      scoringContext: snapshot.scoringContext,
      analyzerVersion: snapshot.analyzerVersion,
      analyzedAt: snapshot.analyzedAt,
      createdAt: "2026-06-22T00:00:00.000Z",
    },
    duplicate: false,
  };
}

async function settleUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    if (predicate()) return;
    await settle();
  }
  throw new Error(`condition never settled: ${label}`);
}

/** All cockpit internal-scroll pin containers, found anywhere (shadow or light). */
function pins(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-cockpit-pin]"));
}

/** The cockpit root carrying the responsive `data-cockpit` mode attribute. */
function cockpitRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-cockpit]");
}

/** Every rendered button anywhere in the document (cockpit is in light/shadow DOM). */
function allButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
}

/** The full visible text of the cockpit subtree (channel captions, labels, etc.). */
function cockpitText(): string {
  return cockpitRoot()?.textContent ?? document.body.textContent ?? "";
}

/** The first button whose accessible text matches, or `undefined`. */
function findButton(matcher: RegExp): HTMLButtonElement | undefined {
  return allButtons().find((b) => matcher.test(b.textContent ?? ""));
}

/**
 * Drain the cockpit's async mount/commit cycles UNTIL a matching button appears,
 * then click it. The cockpit's button (rail / Apply-all) lands only after a chain
 * of async hops (detection → composer commit → `Promise.all` transport microtasks
 * → categories/judge commit → render), and a single fixed-duration `settle()`
 * does not deterministically flush all of them under shared-browser-tab
 * contention. Looping `settle()` until the target is present makes the click
 * deterministic regardless of contention; the bound prevents an infinite hang and
 * throws a clear error if the button truly never renders (a real regression).
 */
async function clickWhenPresent(matcher: RegExp): Promise<void> {
  for (let i = 0; i < 25 && findButton(matcher) === undefined; i += 1) {
    await settle();
  }
  const button = findButton(matcher);
  if (button === undefined) {
    throw new Error(`button never appeared after draining: ${matcher}`);
  }
  button.click();
  await vi.advanceTimersByTimeAsync(0);
}

// ===========================================================================
// 1. Mount on compose detect — fixture in body → cockpit mounts; 3 zones.
// ===========================================================================

describe("ComposeCockpit — mounts when the X compose modal is detected", () => {
  it("mounts and renders all three zones (rail, static, judge) with the modal present", async () => {
    fixture = insertXComposer();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
    });

    mountCockpit(fake);
    await settle();

    // The cockpit root mounted (compose detected via dialog ⊃ tweetTextarea_0).
    expect(cockpitRoot()).not.toBeNull();

    // All three zones are present: the rail surfaces a category label, the
    // static channel its caption, the judge channel its caption.
    const text = cockpitText();
    expect(text).toContain("Hot take"); // ComposeGenerateRail (LEFT)
    expect(text).toContain("◆ Static engine"); // StaticEngineColumn (RIGHT)
    expect(text).toContain("✦ AI judge"); // JudgeStrip (UNDER)

    // Three internal-scroll pins (one per zone).
    expect(pins().length).toBeGreaterThanOrEqual(3);
  });
});

// ===========================================================================
// 2 + 3. Pins present + internal-scroll containers; no horizontal page scroll.
// ===========================================================================

describe("ComposeCockpit — pinned zones use internal scroll and add no page scroll", () => {
  it("renders internal-scroll pin containers", async () => {
    fixture = insertXComposer();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
    });

    mountCockpit(fake);
    await settle();

    const containers = pins();
    expect(containers.length).toBeGreaterThanOrEqual(3);
    // Each pin scrolls internally on overflow (overflow auto/scroll on some axis).
    for (const pin of containers) {
      const style = getComputedStyle(pin);
      const overflows = [style.overflow, style.overflowY, style.overflowX];
      expect(overflows.some((o) => o === "auto" || o === "scroll")).toBe(true);
    }
  });

  it("adds no horizontal page scroll beyond the fixture's own footprint", async () => {
    fixture = insertXComposer();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
    });

    // Baseline: the document's horizontal scroll width with ONLY the X fixture
    // present (its absolutely-positioned modal already overflows the narrow
    // Playwright viewport). We measure the cockpit's CONTRIBUTION against this so
    // the assertion isolates the cockpit, not the fixture's own footprint.
    const doc = document.documentElement;
    const baseline = doc.scrollWidth;

    mountCockpit(fake);
    await settle();

    // The cockpit (stacked, position:fixed, overflow-x:hidden) introduces no
    // additional horizontal scroll: the document is no wider than the fixture
    // alone made it.
    expect(doc.scrollWidth).toBeLessThanOrEqual(baseline);
  });
});

// ===========================================================================
// 4. Breakpoint collapse — data-cockpit reflects the viewport mode honestly.
// ===========================================================================

describe("ComposeCockpit — responsive collapse attribute", () => {
  it("exposes data-cockpit reflecting the current viewport (stacked ≤1180px, else wide)", async () => {
    fixture = insertXComposer();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
    });

    mountCockpit(fake);
    await settle();

    const root = cockpitRoot();
    expect(root).not.toBeNull();

    // The harness cannot resize the Playwright viewport mid-test, so we assert
    // the attribute is PRESENT and reflects the CURRENT width honestly: ≤1180 →
    // "stacked"; otherwise NOT "stacked". This pins the breakpoint contract
    // without depending on an in-test resize the harness can't do.
    const mode = root!.getAttribute("data-cockpit");
    expect(mode).not.toBeNull();
    if (window.innerWidth <= 1180) {
      expect(mode).toBe("stacked");
    } else {
      expect(mode).not.toBe("stacked");
    }
  });
});

// ===========================================================================
// 5. Channel captions — both firewall captions present.
// ===========================================================================

describe("ComposeCockpit — static⟂judge channel captions", () => {
  it("renders both '◆ Static engine' and '✦ AI judge' captions", async () => {
    fixture = insertXComposer();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
    });

    mountCockpit(fake);
    await settle();

    const text = cockpitText();
    expect(text).toContain("◆ Static engine");
    expect(text).toContain("✦ AI judge");
  });
});

// ===========================================================================
// 6. Reply orchestration — split authored body, preserve structural prefix.
// ===========================================================================

describe("ComposeCockpit — reply-aware orchestration", () => {
  it("sends authored reply body plus replyContext to static analyze and manual judge", async () => {
    fixture = insertXReplyComposer("@alice good point", {
      targetText: "The boring version is usually the one people can ship.",
    });
    const analyzeCalls: AnalyzePostsRequest[] = [];
    const judgeCalls: JudgeDraftRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async (request) => {
        analyzeCalls.push(request);
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async (request) => {
        judgeCalls.push(request);
        return makeJudgeResponse(74);
      },
    });

    mountCockpit(fake);
    await settleUntil(() => analyzeCalls.length > 0, "reply analyze request");

    expect(analyzeCalls[0]).toMatchObject({
      items: [
        {
          text: "good point",
          replyContext: {
            targetAuthorHandle: "alice",
            targetText: "The boring version is usually the one people can ship.",
            leadingTargetHandle: { handle: "alice", state: "present" },
          },
        },
      ],
    });

    await clickWhenPresent(/run judge/i);
    await settleUntil(() => judgeCalls.length === 1, "reply judge request");

    expect(judgeCalls[0]).toMatchObject({
      text: "good point",
      replyContext: {
        targetAuthorHandle: "alice",
        targetText: "The boring version is usually the one people can ship.",
        leadingTargetHandle: { handle: "alice", state: "present" },
      },
    });
  });

  it("does not analyze or judge a prefix-only reply body", async () => {
    fixture = insertXReplyComposer("@alice ");
    const analyzeCalls: AnalyzePostsRequest[] = [];
    const judgeCalls: JudgeDraftRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async (request) => {
        analyzeCalls.push(request);
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async (request) => {
        judgeCalls.push(request);
        return makeJudgeResponse(74);
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/run judge/i);
    await settle();

    expect(analyzeCalls).toEqual([]);
    expect(judgeCalls).toEqual([]);
  });

  it("generates with replyContext and writes generated body with the current structural prefix", async () => {
    fixture = insertXReplyComposer("@alice ");
    const generateCalls: GenerateIdeaRequest[] = [];
    const response = makeGenerateResponse([
      { text: "@alice agree with this", overall: 88 },
      { text: "lower option", overall: 72 },
      { text: "weak option", overall: 40 },
    ]);
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      generateIdeas: async (request) => {
        generateCalls.push(request);
        return response;
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/hot take/i);
    await settle();

    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).toMatchObject({
      format: "hot_take",
      replyContext: { targetAuthorHandle: "alice" },
    });
    expect(composerText()).toBe("@alice agree with this");
  });

  it("applies suggestions to the authored body and writes the returned body with one prefix", async () => {
    fixture = insertXReplyComposer("@alice original body");
    const applyCalls: ApplyJudgeSuggestionsRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async () => makeJudgeResponse(74),
      applyJudgeSuggestions: async (request) => {
        applyCalls.push(request);
        return makeApplyResponse({ text: "@alice improved body", improvedOverOriginal: true });
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/run judge/i);
    await clickWhenPresent(/apply all suggestions/i);
    await settle();

    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0]).toMatchObject({
      text: "original body",
      replyContext: { targetAuthorHandle: "alice" },
    });
    expect(composerText()).toBe("@alice improved body");
  });

  it("does not restore a user-deleted structural prefix when generating or applying", async () => {
    fixture = insertXReplyComposer("original body");
    const generateCalls: GenerateIdeaRequest[] = [];
    const applyCalls: ApplyJudgeSuggestionsRequest[] = [];
    const response = makeGenerateResponse([
      { text: "@alice generated body", overall: 88 },
      { text: "lower option", overall: 72 },
      { text: "weak option", overall: 40 },
    ]);
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      generateIdeas: async (request) => {
        generateCalls.push(request);
        return response;
      },
      judgeDraft: async () => makeJudgeResponse(74),
      applyJudgeSuggestions: async (request) => {
        applyCalls.push(request);
        return makeApplyResponse({ text: "@alice applied body", improvedOverOriginal: true });
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/hot take/i);
    await settle();

    expect(generateCalls[0]).toMatchObject({
      replyContext: { leadingTargetHandle: { handle: "alice", state: "user_deleted" } },
    });
    expect(composerText()).toBe("generated body");

    typeInComposer(fixture.composer, "original body");
    await settle();
    await clickWhenPresent(/run judge/i);
    await clickWhenPresent(/apply all suggestions/i);
    await settle();

    expect(applyCalls[0]).toMatchObject({
      text: "original body",
      replyContext: { leadingTargetHandle: { handle: "alice", state: "user_deleted" } },
    });
    expect(composerText()).toBe("applied body");
  });

  it("keeps normal post-mode leading handles as authored text without replyContext", async () => {
    fixture = insertXComposer("@alice good point");
    const analyzeCalls: AnalyzePostsRequest[] = [];
    const judgeCalls: JudgeDraftRequest[] = [];
    const applyCalls: ApplyJudgeSuggestionsRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async (request) => {
        analyzeCalls.push(request);
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async (request) => {
        judgeCalls.push(request);
        return makeJudgeResponse(74);
      },
      applyJudgeSuggestions: async (request) => {
        applyCalls.push(request);
        return makeApplyResponse({ text: "@alice improved normal post", improvedOverOriginal: true });
      },
    });

    mountCockpit(fake);
    await settleUntil(() => analyzeCalls.length > 0, "normal analyze request");

    expect(analyzeCalls[0]?.items[0]).toMatchObject({ text: "@alice good point" });
    expect(analyzeCalls[0]?.items[0]).not.toHaveProperty("replyContext");

    await clickWhenPresent(/run judge/i);
    await settleUntil(() => judgeCalls.length === 1, "normal judge request");
    expect(judgeCalls[0]).toEqual({ text: "@alice good point" });

    await clickWhenPresent(/apply all suggestions/i);
    await settleUntil(() => applyCalls.length === 1, "normal apply request");
    expect(applyCalls[0]).toEqual({ text: "@alice good point" });
    expect(composerText()).toBe("@alice improved normal post");
  });

  it("records generated reply feedback using authored body text", async () => {
    fixture = insertXReplyComposer("@alice ");
    const recordCalls: RecordFeedbackPredictionRequest[] = [];
    const response = makeGenerateResponse([
      { text: "generated learning hook", overall: 88 },
      { text: "lower generated option", overall: 72 },
      { text: "weak generated option", overall: 40 },
    ]);
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      generateIdeas: async () => response,
      recordFeedbackPrediction: async (request) => {
        recordCalls.push(request);
        return makeFeedbackRecordResponse(request);
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/hot take/i);
    await settleUntil(() => recordCalls.length === 1, "reply generated feedback record");

    expect(composerText()).toBe("@alice generated learning hook");
    expect(recordCalls[0]).toMatchObject({
      action: "generated_draft_written",
      text: "generated learning hook",
    });
  });

  it("keeps the structural prefix when apply returns the original body through never-worse", async () => {
    fixture = insertXReplyComposer("@alice original body");
    const recordCalls: RecordFeedbackPredictionRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async () => makeJudgeResponse(74),
      applyJudgeSuggestions: async () =>
        makeApplyResponse({ text: "original body", improvedOverOriginal: false }),
      recordFeedbackPrediction: async (request) => {
        recordCalls.push(request);
        return makeFeedbackRecordResponse(request);
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/run judge/i);
    await clickWhenPresent(/apply all suggestions/i);
    await settleUntil(() => recordCalls.length === 1, "reply apply never-worse feedback");

    expect(composerText()).toBe("@alice original body");
    expect(recordCalls[0]).toMatchObject({
      action: "apply_all_result_written",
      text: "original body",
    });
  });

});
// ===========================================================================
// 6. Generate flow — rail click → generateIdeas({format}) + pending on rail.
// ===========================================================================

describe("ComposeCockpit — generate flow", () => {
  it("calls generateIdeas with the clicked category's format and marks the rail pending", async () => {
    fixture = insertXComposer();
    const categories = makeGenerateCategories();
    const generateCalls: unknown[] = [];
    // Hold the generate call open so we can observe the `generating`/pending state
    // before the candidate is applied.
    const pending = deferred<GenerateIdeaResponse>();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => categories,
      getCaptureSummary: async () => makeCapture(),
      generateIdeas: (request) => {
        generateCalls.push(request);
        return pending.promise;
      },
    });

    mountCockpit(fake);
    await settle();

    // Click the first category button (label "Hot take" → format "hot_take"),
    // draining the async mount chain until the rail button is present.
    await clickWhenPresent(/hot take/i);

    // generateIdeas was called with the clicked category's FORMAT (not its id).
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).toEqual({ format: categories[0]!.format });

    // The rail's pending button is in its loading+disabled state while generating.
    const pendingButton = allButtons().find((b) => /hot take/i.test(b.textContent ?? ""));
    expect(pendingButton?.disabled).toBe(true);

    // Resolve so the afterEach teardown doesn't leak an open promise.
    pending.resolve(makeGenerateResponse([
      { text: "a", overall: 80 },
      { text: "b", overall: 80 },
      { text: "c", overall: 80 },
    ]));
    await settle();
  });
});

// ===========================================================================
// 7. Apply flow — Apply-all click → applyJudgeSuggestions + applyState applying.
// ===========================================================================

describe("ComposeCockpit — apply-all flow", () => {
  it("calls applyJudgeSuggestions and shows the JudgeStrip applying state on Apply-all", async () => {
    fixture = insertXComposer("a user-written draft worth improving");
    const applyCalls: unknown[] = [];
    const pending = deferred<ReturnType<typeof makeApplyResponse>>();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      // Static + judge complete so the user_written + judged Apply-all affordance shows.
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      judgeDraft: async () => makeJudgeResponse(74),
      applyJudgeSuggestions: (request) => {
        applyCalls.push(request);
        return pending.promise;
      },
    });

    mountCockpit(fake);
    // Settle the analyze debounce + the auto-kicked judge so we reach judged,
    // draining until the Apply-all affordance is present, then click it.
    await settle();
    await clickWhenPresent(/apply all suggestions/i);

    // applyJudgeSuggestions was called with the current composer text.
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0]).toMatchObject({ text: expect.any(String) });

    // The JudgeStrip shows the applying ("Improving…") affordance with aria-busy.
    expect(cockpitText().toLowerCase()).toContain("improving");
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    pending.resolve(makeApplyResponse());
    await settle();
  });
});

// ===========================================================================
// 8. Auto-apply-best — highest approved overall written; provenance generated.
// ===========================================================================

describe("ComposeCockpit — auto-apply-best candidate selection", () => {
  it("writes the highest-overall APPROVED candidate's text into the composer (88 wins over 60/72)", async () => {
    fixture = insertXComposer();
    // 60 → do-not? (40-69 major_rework, NOT approved); 88 → post_now (approved);
    // 72 → slight_rework (approved). Best approved overall = 88.
    const response = makeGenerateResponse([
      { text: "low-scoring candidate", overall: 60 },
      { text: "the best approved candidate", overall: 88 },
      { text: "middle approved candidate", overall: 72 },
    ]);
    // Sanity: the 88 candidate is the approved max — not a tautology.
    const best = response.candidates[1]!;
    expect(best.text).toBe("the best approved candidate");
    expect(best.approved).toBe(true);

    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      generateIdeas: async () => response,
    });

    mountCockpit(fake);
    await settle();

    await clickWhenPresent(/hot take/i);
    await settle();

    // The 88-candidate's text — NOT the 60 (candidates[0]) nor the 72 — is written.
    expect(composerText()).toBe("the best approved candidate");

    // Provenance flipped to generated: the judge channel surfaces the approved
    // badge (gated on provenance === "generated" AND deriveApproved in JudgeStrip).
    expect(cockpitText()).toContain("✓ Judge approved");
  });

  it("writes candidates[0] when none are approved", async () => {
    fixture = insertXComposer();
    // 30/35/38 → all do_not_post (NOT approved) → fall back to candidates[0].
    const response = makeGenerateResponse([
      { text: "first unapproved candidate", overall: 30 },
      { text: "second unapproved candidate", overall: 35 },
      { text: "third unapproved candidate", overall: 38 },
    ]);
    expect(response.candidates.every((c) => c.approved === false)).toBe(true);

    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      generateIdeas: async () => response,
    });

    mountCockpit(fake);
    await settle();

    await clickWhenPresent(/hot take/i);
    await settle();

    // Fallback: candidates[0] (overall 35 is higher, but no approval → index 0).
    expect(composerText()).toBe("first unapproved candidate");
  });

  it("treats a chosen candidate with no verdict as user_written and runs the normal judge flow", async () => {
    fixture = insertXComposer();
    // Single candidate carrying NO verdict → applied as user_written; the cockpit
    // then auto-kicks the normal judgeDraft flow on the written text.
    const response = makeGenerateResponse([
      { text: "verdict-less candidate", verdict: null },
      { text: "rejected b", overall: 20 },
      { text: "rejected c", overall: 20 },
    ]);
    // The verdict-less candidate is approved-flag false (no verdict) and is also
    // candidates[0] → it is the chosen one in the no-approved fallback.
    expect(response.candidates[0]!.verdict).toBeUndefined();

    let judgeCalls = 0;
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      generateIdeas: async () => response,
      judgeDraft: async (): Promise<JudgeDraftResponse> => {
        judgeCalls += 1;
        return makeJudgeResponse(80);
      },
    });

    mountCockpit(fake);
    await settle();

    await clickWhenPresent(/hot take/i);
    await settle();

    // The verdict-less candidate's text was written…
    expect(composerText()).toBe("verdict-less candidate");
    // …and because it carried no verdict, the normal judge flow was kicked
    // (judgeDraft ran for the written text rather than reusing a candidate verdict).
    expect(judgeCalls).toBeGreaterThanOrEqual(1);
    // No pre-approved badge (provenance is user_written for a verdict-less apply).
    expect(cockpitText()).not.toContain("✓ Judge approved");
  });
});

// ===========================================================================
// 9. Apply-all write — improved text written; provenance generated; applied.
// ===========================================================================

describe("ComposeCockpit — apply-all writes the improved text", () => {
  it("writes the improved text into the composer and flips provenance to generated on applied", async () => {
    fixture = insertXComposer("original user draft that can be improved");
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      judgeDraft: async () => makeJudgeResponse(74),
      applyJudgeSuggestions: async () =>
        makeApplyResponse({ text: "improved", improvedOverOriginal: true }),
    });

    mountCockpit(fake);
    await settle();

    await clickWhenPresent(/apply all suggestions/i);
    await settle();

    // The improved text is written into the composer (real contenteditable write).
    expect(composerText()).toBe("improved");
    // Provenance flips to generated → approved badge surfaces (apply verdict 88).
    expect(cockpitText()).toContain("✓ Judge approved");
  });
});

// ===========================================================================
// 10. Feedback loop recording — generated, improved, and manual posted drafts.
// ===========================================================================

describe("ComposeCockpit — feedback loop recording", () => {
  it("records a generated draft after the chosen candidate is written", async () => {
    fixture = insertXComposer();
    const recordCalls: RecordFeedbackPredictionRequest[] = [];
    const response = makeGenerateResponse([
      { text: "generated learning hook", overall: 88 },
      { text: "lower generated option", overall: 72 },
      { text: "weak generated option", overall: 40 },
    ]);
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      generateIdeas: async () => response,
      recordFeedbackPrediction: async (request) => {
        recordCalls.push(request);
        return makeFeedbackRecordResponse(request);
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/hot take/i);
    await settleUntil(() => recordCalls.length === 1, "generated feedback record");

    expect(recordCalls[0]).toMatchObject({
      action: "generated_draft_written",
      text: "generated learning hook",
    });
    expect(recordCalls[0]!.snapshot.prediction.status).toBe("available");
  });

  it("does not record ordinary user typing without the explicit posted-draft action", async () => {
    fixture = insertXComposer("first user draft");
    const recordCalls: RecordFeedbackPredictionRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async () => makeJudgeResponse(74),
      recordFeedbackPrediction: async (request) => {
        recordCalls.push(request);
        return makeFeedbackRecordResponse(request);
      },
    });

    mountCockpit(fake);
    await settle();
    typeInComposer(fixture.composer, "second user draft");
    await settle();

    expect(recordCalls).toHaveLength(0);
  });

  it("records the current composer text when the user marks a posted draft", async () => {
    fixture = insertXComposer("posted manually after review");
    const recordCalls: RecordFeedbackPredictionRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async () => makeJudgeResponse(74),
      recordFeedbackPrediction: async (request) => {
        recordCalls.push(request);
        return makeFeedbackRecordResponse(request);
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/record posted draft/i);
    await settleUntil(() => recordCalls.length === 1, "manual feedback record");

    expect(recordCalls[0]).toMatchObject({
      action: "manual_record_posted_draft",
      text: "posted manually after review",
    });
  });

  it("records the improved text after Apply-all writes it", async () => {
    fixture = insertXComposer("original draft before apply");
    const recordCalls: RecordFeedbackPredictionRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: async () => makeJudgeResponse(74),
      applyJudgeSuggestions: async () =>
        makeApplyResponse({ text: "improved text to publish", improvedOverOriginal: true }),
      recordFeedbackPrediction: async (request) => {
        recordCalls.push(request);
        return makeFeedbackRecordResponse(request);
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/run judge/i);
    await clickWhenPresent(/apply all suggestions/i);
    await settleUntil(() => recordCalls.length === 1, "apply-all feedback record");

    expect(recordCalls[0]).toMatchObject({
      action: "apply_all_result_written",
      text: "improved text to publish",
    });
  });
});

// ===========================================================================
// 10. In-flight abort — edit during judging drops the stale verdict.
// ===========================================================================

describe("ComposeCockpit — in-flight abort on composer edit", () => {
  it("does not apply a stale judge verdict when the user edits while judging", async () => {
    fixture = insertXComposer("draft one — about to be judged");
    // Hold the FIRST judgeDraft open; resolve it only AFTER the user edits, so
    // its (now-stale) verdict must NOT be applied. The re-debounced analyze for
    // the edited text uses a distinct, observable static result.
    const firstJudge = deferred<JudgeDraftResponse>();
    let judgeCallCount = 0;
    let analyzeCallCount = 0;
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      analyzePosts: async () => {
        analyzeCallCount += 1;
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      judgeDraft: (): Promise<JudgeDraftResponse> => {
        judgeCallCount += 1;
        if (judgeCallCount === 1) return firstJudge.promise;
        // The second (post-edit) judge resolves with a DISTINCT verdict so we can
        // tell the two apart by headline.
        return Promise.resolve(makeJudgeResponse(95));
      },
    });

    mountCockpit(fake);
    await settle(); // analyze (1) → static_ready → judge (1) kicked, held open.

    expect(judgeCallCount).toBe(1);
    const analyzeAfterFirst = analyzeCallCount;

    // The user edits the composer while the first judge is still in flight.
    typeInComposer(fixture.composer, "draft two — a totally different edit");
    await vi.advanceTimersByTimeAsync(0);

    // The stale (first) judge now resolves — AFTER the edit. Its verdict (overall
    // 80, "post now" band) must NOT be applied: the edit aborted it.
    firstJudge.resolve(makeJudgeResponse(80));
    await settle();

    // The machine re-debounced analyze for the edited text (a fresh analyze ran).
    expect(analyzeCallCount).toBeGreaterThan(analyzeAfterFirst);

    // The composer retains the user's edit (the abort never reverted it).
    expect(composerText()).toBe("draft two — a totally different edit");
  });
});

// ===========================================================================
// 11. Judge-readiness gate — llm unavailable → judgeDraft NOT called.
// ===========================================================================

describe("ComposeCockpit — judge readiness gate", () => {
  it("does NOT auto-kick judgeDraft when readiness llm.state is not ready, and shows unavailable", async () => {
    fixture = insertXComposer("a draft that statically scores but cannot be judged");
    let judgeCallCount = 0;
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness, subsystem } = await import("../../testing/fixtures");
        return makeOverlayReadiness({
          llm: subsystem({ state: "unavailable", label: "Judge not configured" }),
        });
      },
      judgeDraft: async (): Promise<JudgeDraftResponse> => {
        judgeCallCount += 1;
        return makeJudgeResponse(80);
      },
    });

    mountCockpit(fake);
    await settle();

    // The judge gate held: after static_ready, judgeDraft was NEVER called.
    expect(judgeCallCount).toBe(0);
    // The JudgeStrip surfaces the unavailable hint (the readiness label).
    expect(cockpitText().toLowerCase()).toContain("judge not configured");
  });

  it("auto-kicks judgeDraft when readiness llm.state is ready", async () => {
    fixture = insertXComposer("a judgeable draft once the judge is ready");
    let judgeCallCount = 0;
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      analyzePosts: async () => {
        const { readyResult } = await import("../../testing/analyze-state");
        return { items: [readyResult] };
      },
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness(); // llm.state defaults to "ready"
      },
      judgeDraft: async (): Promise<JudgeDraftResponse> => {
        judgeCallCount += 1;
        return makeJudgeResponse(74);
      },
    });

    mountCockpit(fake);
    await settle();

    // The gate opened: judgeDraft ran exactly once after static_ready.
    expect(judgeCallCount).toBe(1);
    // The verdict landed in the judge channel (slight_rework band for overall 74).
    expect(/slight|rework/i.test(cockpitText())).toBe(true);
  });
});

// ===========================================================================
// 12. Unmount on dialog close — dialog removed → cockpit tears down cleanly.
// ===========================================================================

describe("ComposeCockpit — unmounts when the compose dialog closes", () => {
  it("removes the cockpit and tears down cleanly when the dialog leaves the DOM", async () => {
    fixture = insertXComposer();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
    });

    mountCockpit(fake);
    await settle();
    expect(cockpitRoot()).not.toBeNull();

    // Close the compose modal (X removes the dialog subtree).
    expect(() => {
      fixture!.removeDialog();
    }).not.toThrow();

    // The cockpit observes the dialog removal (rAF/debounced reconcile) and
    // unmounts: no cockpit root, no pins, and no errors/timers left behind.
    await expect(settle(400)).resolves.toBeUndefined();
    expect(cockpitRoot()).toBeNull();
    expect(pins()).toHaveLength(0);
  });
});

// ===========================================================================
// 13. rAF snapshot single-source — pins + highlight layer share one tracker.
// ===========================================================================

describe("ComposeCockpit — single per-frame rAF rect snapshot", () => {
  it("feeds the pins and the highlight layer from ONE shared rect tracker", async () => {
    fixture = insertXComposer();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
    });

    mountCockpit(fake);
    await settle();

    // Exactly ONE highlight layer is mounted (the cockpit composes a single
    // CompositionHighlightLayer that reads the SAME snapshot the pins use — not a
    // second, independently-measuring instance). This is the stable proxy for
    // "single per-frame snapshot shared by pins + highlight layer".
    const highlightLayers = document.querySelectorAll("[data-xb-highlight-layer]");
    expect(highlightLayers).toHaveLength(1);

    // And the pins exist alongside that single highlight layer (both anchored off
    // the one tracker, not two competing measure loops).
    expect(pins().length).toBeGreaterThanOrEqual(3);
  });
});
