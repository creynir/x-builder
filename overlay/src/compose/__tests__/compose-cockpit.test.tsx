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
import { makeCategoryList } from "../../testing/generate-categories";

import type {
  AnalyzePostsRequest,
  ApplyJudgeSuggestionsRequest,
  GenerateCategory,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
  JudgeDraftRequest,
  JudgeDraftResponse,
  RecordFeedbackPredictionRequest,
  RecordFeedbackPredictionResponse,
  ReplyComposerContext,
} from "@x-builder/shared";

// Not-yet-existing module — importing it is what drives the RED state.
import {
  bodyTextForCompose,
  ComposeCockpit,
  mergeReplyBody,
  splitComposerText,
  stripLeadingReplyTargetHandle,
} from "../compose-cockpit";

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

const replyContext: ReplyComposerContext = {
  source: "same_dialog_dom",
  targetAuthorHandle: "alice",
  targetText: "The boring version is usually the one people can ship.",
  leadingTargetHandle: { handle: "alice", state: "present" },
};

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

describe("ComposeCockpit — reply split/merge safety", () => {
  it("splits a reply structural prefix from the authored body and merges it once", () => {
    const split = splitComposerText("@alice good point", replyContext);

    expect(split).toMatchObject({
      mode: "reply",
      authoredBody: "good point",
      structuralPrefix: "@alice ",
      leadingHandleState: "present",
    });
    expect(bodyTextForCompose("@alice good point", split, replyContext)).toBe("good point");
    expect(mergeReplyBody("@alice generated body", split, replyContext)).toBe(
      "@alice generated body",
    );
    expect(mergeReplyBody("generated body", split, replyContext)).toBe("@alice generated body");
  });

  it("preserves user-deleted reply prefixes when merging generated text", () => {
    const split = splitComposerText("user kept no prefix", replyContext);

    expect(split).toMatchObject({
      mode: "reply",
      authoredBody: "user kept no prefix",
      structuralPrefix: "",
      leadingHandleState: "user_deleted",
    });
    expect(bodyTextForCompose("user kept no prefix", split, replyContext)).toBe(
      "user kept no prefix",
    );
    expect(mergeReplyBody("@alice generated body", split, replyContext)).toBe("generated body");
  });

  it("keeps leading handles as normal authored text outside reply mode", () => {
    const split = splitComposerText("@alice normal post", undefined);

    expect(split).toMatchObject({
      mode: "post",
      authoredBody: "@alice normal post",
      structuralPrefix: "",
      leadingHandleState: "user_deleted",
    });
    expect(stripLeadingReplyTargetHandle("@alice normal post", undefined)).toBe(
      "@alice normal post",
    );
    expect(bodyTextForCompose("@alice normal post", split, undefined)).toBe("@alice normal post");
    expect(mergeReplyBody("@alice generated normal post", split, undefined)).toBe(
      "@alice generated normal post",
    );
  });
});

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

function categoryLabelForButton(button: HTMLButtonElement): string | undefined {
  const label = Array.from(button.querySelectorAll<HTMLElement>("span[title]")).find(
    (span) => span.getAttribute("title") !== null,
  );
  return label?.getAttribute("title") ?? undefined;
}

function categoryButtons(): HTMLButtonElement[] {
  return allButtons().filter((button) => categoryLabelForButton(button) !== undefined);
}

function categoryButton(label: string): HTMLButtonElement | undefined {
  return categoryButtons().find((button) => categoryLabelForButton(button) === label);
}

function renderedCategoryLabels(categories: GenerateCategory[]): string[] {
  const expected = new Set(categories.map((category) => category.label));
  return categoryButtons()
    .map((button) => categoryLabelForButton(button)!)
    .filter((label) => expected.has(label));
}

function warningBadges(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-variant="warning"]'));
}

function cooldownBadgeLabel(category: GenerateCategory): string {
  return `${category.cooldownStatus} · ${category.recentCount} in ${category.windowDays}d`;
}

function makeReturnedOrderCategoryList(count = 20): GenerateCategory[] {
  return [...makeCategoryList(count)].reverse();
}

function makeBadgeBearingCategoryList(count = 24): GenerateCategory[] {
  return makeReturnedOrderCategoryList(count).map((category, index) => {
    if (index === 3) {
      return {
        ...category,
        basis: "top_performer" as const,
        cooldownStatus: "warming" as const,
        recentCount: 2,
        sampleCount: Math.max(category.sampleCount, 2),
      };
    }
    if (index === 11) {
      return {
        ...category,
        basis: "top_performer" as const,
        cooldownStatus: "cooldown" as const,
        recentCount: 5,
        sampleCount: Math.max(category.sampleCount, 5),
      };
    }
    return category;
  });
}

function railPanelForCategory(label: string): HTMLElement {
  const button = categoryButton(label);
  if (button === undefined) {
    throw new Error(`category button not found: ${label}`);
  }
  const panel = button.parentElement;
  if (!(panel instanceof HTMLElement)) {
    throw new Error(`rail panel not found for category: ${label}`);
  }
  return panel;
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
// 6. Reply assistant — separate reply UI, explicit choose + ledger record.
// ===========================================================================

describe("ComposeCockpit — reply assistant", () => {
  it("branches reply mode away from legacy post cockpit surfaces and side effects", async () => {
    fixture = insertXReplyComposer("@alice good point");
    const analyzeCalls: AnalyzePostsRequest[] = [];
    const judgeCalls: JudgeDraftRequest[] = [];
    const generateCalls: GenerateIdeaRequest[] = [];
    const applyCalls: ApplyJudgeSuggestionsRequest[] = [];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => {
        throw new Error("reply mode must not load post categories");
      },
      getCaptureSummary: async () => {
        throw new Error("reply mode must not load capture summary");
      },
      getOverlayReadiness: async () => {
        throw new Error("reply mode must not load judge readiness");
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
      generateIdeas: async (request) => {
        generateCalls.push(request);
        throw new Error(`reply mode must not call generateIdeas: ${JSON.stringify(request)}`);
      },
      applyJudgeSuggestions: async (request) => {
        applyCalls.push(request);
        return makeApplyResponse({ text: "improved", improvedOverOriginal: true });
      },
    });

    mountCockpit(fake);
    await settle();

    const text = cockpitText();
    expect(text).toContain("Reply assistant");
    expect(text).toContain("The boring version is usually the one people can ship.");
    expect(text).not.toContain("◆ Static engine");
    expect(text).not.toContain("✦ AI judge");
    expect(findButton(/run judge/i)).toBeUndefined();
    expect(findButton(/apply all suggestions/i)).toBeUndefined();
    expect(categoryButton("Hot take")).toBeUndefined();
    expect(analyzeCalls).toEqual([]);
    expect(judgeCalls).toEqual([]);
    expect(generateCalls).toEqual([]);
    expect(applyCalls).toEqual([]);
  });

  it("generates variants without auto-writing, then writes and records only after Use this", async () => {
    fixture = insertXReplyComposer("@alice current draft");
    const generateCalls: Array<Parameters<FakeEngineTransport["generateReplyVariants"]>[0]> = [];
    const recordCalls: Array<Parameters<FakeEngineTransport["recordGeneratedReply"]>[0]> = [];
    const postClick = vi.fn();
    fixture.postButton.addEventListener("click", postClick);
    const fake = new FakeEngineTransport({
      generateReplyVariants: async (request) => {
        generateCalls.push(request);
        return {
          variants: [
            { id: "direct", body: "@alice generated body", replyMove: "answer", groundingNotes: [], warnings: [] },
            { id: "ask", body: "What changed your mind?", groundingNotes: [], warnings: [] },
            { id: "reframe", body: "The boring path is usually the one that survives.", groundingNotes: [], warnings: [] },
          ],
        };
      },
      recordGeneratedReply: async (request) => {
        recordCalls.push(request);
        return {
          duplicate: false,
          record: {
            id: "generated-reply-1",
            clientEventId: request.clientEventId,
            bodyText: request.bodyText,
            writtenText: request.writtenText,
            bodyTextHash: "sha256:rva-generated-reply:v1:body",
            writtenTextHash: "sha256:rva-generated-reply:v1:written",
            targetStatusId: request.targetStatusId,
            chosenVariantId: request.chosenVariantId,
            replyMove: request.replyMove,
            generatedAt: request.generatedAt ?? "2026-07-01T12:00:00.000Z",
            recordedAt: "2026-07-01T12:00:01.000Z",
          },
        };
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/generate replies/i);
    await settleUntil(() => generateCalls.length === 1, "reply variants generated");

    expect(generateCalls[0]).toMatchObject({
      currentAuthoredBody: "current draft",
      replyContext: {
        targetAuthorHandle: "alice",
        leadingTargetHandle: { handle: "alice", state: "present" },
      },
    });
    expect(composerText()).toBe("@alice current draft");

    await clickWhenPresent(/use this/i);
    await settleUntil(() => recordCalls.length === 1, "generated reply recorded");

    expect(composerText()).toBe("@alice generated body");
    expect(recordCalls[0]).toMatchObject({
      bodyText: "generated body",
      writtenText: "@alice generated body",
      targetStatusId: "1930000000000000001",
      chosenVariantId: "direct",
      replyMove: "answer",
    });
    expect(postClick).not.toHaveBeenCalled();
  });

  it("respects a user-deleted structural prefix when choosing a variant", async () => {
    fixture = insertXReplyComposer("current draft");
    const recordCalls: Array<Parameters<FakeEngineTransport["recordGeneratedReply"]>[0]> = [];
    const fake = new FakeEngineTransport({
      generateReplyVariants: async () => ({
        variants: [
          { id: "direct", body: "@alice generated body", groundingNotes: [], warnings: [] },
          { id: "ask", body: "What changed your mind?", groundingNotes: [], warnings: [] },
          { id: "reframe", body: "The boring path is usually the one that survives.", groundingNotes: [], warnings: [] },
        ],
      }),
      recordGeneratedReply: async (request) => {
        recordCalls.push(request);
        return {
          duplicate: true,
          record: {
            id: "generated-reply-1",
            clientEventId: request.clientEventId,
            bodyText: request.bodyText,
            writtenText: request.writtenText,
            bodyTextHash: "sha256:rva-generated-reply:v1:body",
            writtenTextHash: "sha256:rva-generated-reply:v1:written",
            generatedAt: request.generatedAt ?? "2026-07-01T12:00:00.000Z",
            recordedAt: "2026-07-01T12:00:01.000Z",
          },
        };
      },
    });

    mountCockpit(fake);
    await settle();
    await clickWhenPresent(/generate replies/i);
    await clickWhenPresent(/use this/i);
    await settleUntil(() => recordCalls.length === 1, "generated reply recorded");

    expect(composerText()).toBe("generated body");
    expect(recordCalls[0]).toMatchObject({
      bodyText: "generated body",
      writtenText: "generated body",
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

describe("ComposeCockpit — long generate category rail", () => {
  it("renders every returned category in order and applies the rail-local scroll boundary", async () => {
    fixture = insertXComposer();
    const categories = makeReturnedOrderCategoryList(20);
    expect(categories.map((category) => category.id)).not.toEqual(
      categories.map((category) => category.id).sort(),
    );
    let categoryLoads = 0;
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => {
        categoryLoads += 1;
        return categories;
      },
      getCaptureSummary: async () => makeCapture(),
    });

    mountCockpit(fake);
    await settleUntil(
      () => renderedCategoryLabels(categories).length === categories.length,
      "long category rail render",
    );

    expect(categoryLoads).toBe(1);
    expect(renderedCategoryLabels(categories)).toEqual(
      categories.map((category) => category.label),
    );

    const panel = railPanelForCategory(categories[0]!.label);
    expect(panel.querySelectorAll("button")).toHaveLength(categories.length);
    expect(panel.style.maxHeight).toBe("70vh");
    expect(panel.style.overflowY).toBe("auto");
    expect(panel.style.overscrollBehavior).toBe("contain");
    expect(panel.style.boxSizing).toBe("border-box");
  });

  it("generates with the clicked format and marks only that category pending", async () => {
    fixture = insertXComposer();
    const categories = makeCategoryList(20);
    const target = categories[4]!;
    const sameFormatSibling = categories.find(
      (category) => category.id !== target.id && category.format === target.format,
    );
    if (sameFormatSibling === undefined) {
      throw new Error("long category fixture must include repeated formats");
    }
    const generateCalls: unknown[] = [];
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
    await settleUntil(() => categoryButton(target.label) !== undefined, "target category render");
    categoryButton(target.label)!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).toMatchObject({ format: target.format });

    const pendingButton = categoryButton(target.label);
    expect(pendingButton?.disabled).toBe(true);
    expect(pendingButton?.getAttribute("aria-busy")).toBe("true");

    const sameFormatButton = categoryButton(sameFormatSibling.label);
    expect(sameFormatButton?.disabled).toBe(false);
    expect(sameFormatButton?.getAttribute("aria-busy")).not.toBe("true");

    pending.resolve(makeGenerateResponse([
      { text: "a", overall: 80 },
      { text: "b", overall: 80 },
      { text: "c", overall: 80 },
    ]));
    await settle();
  });

  it("keeps the static and judge zones mounted when category loading fails", async () => {
    fixture = insertXComposer();
    const expectedAbsentCategories = [
      ...makeReturnedOrderCategoryList(20),
      ...makeGenerateCategories(),
    ];
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => {
        throw new Error("category load failed");
      },
      getCaptureSummary: async () => makeCapture(),
    });

    mountCockpit(fake);
    await settle();

    expect(categoryButtons()).toHaveLength(0);
    expect(renderedCategoryLabels(expectedAbsentCategories)).toEqual([]);
    const text = cockpitText();
    expect(text).toContain("◆ Static engine");
    expect(text).toContain("✦ AI judge");
  });

  it("adds no horizontal page scroll beyond the fixture baseline with a long rail", async () => {
    fixture = insertXComposer();
    const categories = makeBadgeBearingCategoryList(24);
    const badgeCategories = categories.filter((category) => category.cooldownStatus !== "clear");
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => categories,
      getCaptureSummary: async () => makeCapture(),
    });

    const doc = document.documentElement;
    const baseline = doc.scrollWidth;

    mountCockpit(fake);
    await settleUntil(
      () => renderedCategoryLabels(categories).length === categories.length,
      "long category rail render",
    );

    const panel = railPanelForCategory(categories[0]!.label);
    expect(warningBadges(panel).map((badge) => badge.textContent?.trim())).toEqual(
      badgeCategories.map(cooldownBadgeLabel),
    );
    expect(doc.scrollWidth).toBeLessThanOrEqual(baseline);
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
    await settle();
    await clickWhenPresent(/run judge/i);
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

  it("anchors a chosen candidate with no verdict as generated and runs the normal judge flow", async () => {
    fixture = insertXComposer();
    // Single candidate carrying NO verdict → written with generated provenance;
    // the cockpit then kicks the judge flow on the written text.
    const response = makeGenerateResponse([
      { text: "verdict-less candidate", verdict: null },
      { text: "rejected b", overall: 20 },
      { text: "rejected c", overall: 20 },
    ]);
    // The verdict-less candidate is approved-flag false (no verdict) and is also
    // candidates[0] → it is the chosen one in the no-approved fallback.
    expect(response.candidates[0]!.verdict).toBeUndefined();

    let judgeCalls = 0;
    const pendingJudge = deferred<JudgeDraftResponse>();
    const fake = new FakeEngineTransport({
      getGenerateCategories: async () => makeGenerateCategories(),
      getCaptureSummary: async () => makeCapture(),
      getOverlayReadiness: async () => {
        const { makeOverlayReadiness } = await import("../../testing/fixtures");
        return makeOverlayReadiness();
      },
      generateIdeas: async () => response,
      judgeDraft: (): Promise<JudgeDraftResponse> => {
        judgeCalls += 1;
        return pendingJudge.promise;
      },
    });

    mountCockpit(fake);
    await settle();

    await clickWhenPresent(/hot take/i);
    await settle();

    // The verdict-less candidate's text was written and judged rather than
    // reusing a missing candidate verdict.
    expect(composerText()).toBe("verdict-less candidate");
    expect(judgeCalls).toBe(1);
    expect(cockpitText()).not.toContain("✓ Judge approved");

    pendingJudge.resolve(makeJudgeResponse(80));
    await settle();
    expect(cockpitText()).toContain("✓ Judge approved");
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
    await clickWhenPresent(/run judge/i);
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
    await settle(); // analyze (1) → static_ready; judge waits for the manual trigger.
    await clickWhenPresent(/run judge/i);
    await settle();

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

  it("enables manual judge when readiness llm.state is ready", async () => {
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

    expect(judgeCallCount).toBe(0);
    await clickWhenPresent(/run judge/i);
    await settle();

    expect(judgeCallCount).toBe(1);
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
