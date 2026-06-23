// @x-builder/overlay — compose-surface integration seam (Group B — VERIFY-ONLY).
//
// These exercise the cross-component integration of units that already shipped:
//   • AnchorLayer compose detection + reconcile (ComposeContext)   — XOB-029
//   • selectors.safeQuery / selectorMissCount silent degrade        — XOB-019
//   • ProvenanceController generated→user_written flip + approved   — XOB-023
// Passing here is EXPECTED (the units are built); this suite asserts that the
// composed seam behaves end-to-end against an X-shaped fixture DOM. It is NOT a
// new-build surface — see the matching Group-A runner integration suite for the
// transport binding adapter + RunnerApp wiring that must fail until built.
//
// Browser mode (Vitest browser / Playwright Chromium): real DOM, real
// contenteditable textContent, real MutationObserver, fake timers + synchronous
// rAF so the ~150ms reconcile debounce and the ~80ms composer-text debounce are
// observable (mirrors anchor-layer.test.tsx / provenance-controller.test.tsx).

import {
  deriveApproved,
  type JudgeVerdict,
} from "@x-builder/shared";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import {
  AnchorLayer,
  useAnchorMutation,
  useAnchorRegistry,
  useComposeContext,
  type AffordanceHandle,
} from "./anchor-layer";
import { selectorMissCount, XSelectors } from "./selectors";
import {
  ProvenanceController,
  type ProvenanceRenderContext,
} from "./provenance/provenance-controller";
import { makeJudgeVerdict } from "./testing/fixtures";

// ---------------------------------------------------------------------------
// X-shaped fixture DOM — owned by this suite. Mirrors X's composer modal:
// a [role="dialog"] wrapping div[data-testid="tweetTextarea_0"] and a
// div[data-testid="tweetButton"], plus several article[data-testid="tweet"]
// timeline cards. The selector-miss variant omits the textarea entirely.
// ---------------------------------------------------------------------------

const RECONCILE_MS = 150;
const COMPOSE_TEXT_MS = 350;

interface XFixture {
  root: HTMLElement;
  dialog: HTMLElement;
  composer: HTMLElement;
  cleanup(): void;
}

function buildXComposerFixture(opts?: { withTextarea?: boolean; tweetCount?: number }): XFixture {
  const withTextarea = opts?.withTextarea ?? true;
  const tweetCount = opts?.tweetCount ?? 3;

  const root = document.createElement("div");
  root.dataset.xbFixture = "x-shell";

  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");

  const composer = document.createElement("div");
  composer.setAttribute("data-testid", "tweetTextarea_0");
  composer.setAttribute("contenteditable", "true");
  composer.append(document.createTextNode(""));

  const button = document.createElement("div");
  button.setAttribute("data-testid", "tweetButton");

  if (withTextarea) {
    dialog.append(composer);
  }
  dialog.append(button);
  root.append(dialog);

  for (let i = 0; i < tweetCount; i += 1) {
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const text = document.createElement("div");
    text.setAttribute("data-testid", "tweetText");
    text.textContent = `timeline tweet ${i}`;
    article.append(text);
    root.append(article);
  }

  document.body.append(root);

  return {
    root,
    dialog,
    composer,
    cleanup() {
      root.remove();
    },
  };
}

/** Set composer textContent in place (keep element identity) + fire input. */
function typeInto(el: HTMLElement, text: string): void {
  if (el.firstChild) {
    el.firstChild.textContent = text;
  } else {
    el.append(document.createTextNode(text));
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Wait out both debounce windows under REAL timers, then yield so React flushes.
 * The compose-text read (~350ms) and the reconcile (~150ms) are real timers, and
 * the controller's composer-text debounce commits with `flushSync`, so a single
 * real-time wait settles every derived value.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RECONCILE_MS + COMPOSE_TEXT_MS + 80));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Poll a predicate under REAL timers until it holds (or time out). The
 * `AnchorLayer`'s reconcile is driven by a real `MutationObserver` (delivered on
 * a browser microtask, NOT a fake-timer tick) plus a ~150ms debounce, so the
 * observer-driven assertions settle by polling rather than by advancing time.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out before the predicate held");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let fixtures: XFixture[] = [];

afterEach(() => {
  cleanup();
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
  document.querySelectorAll('[data-xb-fixture="x-shell"]').forEach((n) => n.remove());
});

function fixture(opts?: { withTextarea?: boolean; tweetCount?: number }): XFixture {
  const f = buildXComposerFixture(opts);
  fixtures.push(f);
  return f;
}

// A render-prop capture of the live ComposeContext.
function ComposeProbe({ sink }: { sink: (v: ReturnType<typeof useComposeContext>) => void }): null {
  sink(useComposeContext());
  return null;
}

// ===========================================================================
// ComposeContext detection + reconcile against the X-shaped fixture.
// ===========================================================================

describe("AnchorLayer ComposeContext — detects X's composer modal", () => {
  it("marks the compose surface active and exposes the live composer when the dialog is present", async () => {
    const f = fixture();
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );

    await waitUntil(() => latest?.isActive === true);
    expect(latest?.composerEl).toBe(f.composer);
  });

  it("flips inactive (composerEl null) when the composer dialog is removed — no error", async () => {
    const f = fixture();
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );
    await waitUntil(() => latest?.isActive === true);

    // X closes the modal: remove the dialog node from the DOM.
    f.dialog.remove();

    await waitUntil(() => latest?.isActive === false);
    expect(latest?.composerEl).toBeNull();
  });

  it("re-detects a fresh composer after a simulated SPA navigation swaps the dialog", async () => {
    const f = fixture();
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );
    await waitUntil(() => latest?.composerEl === f.composer);
    const firstComposer = latest?.composerEl;

    // Simulate SPA navigation: remove the current dialog, mount a new one.
    f.dialog.remove();
    const next = fixture();

    await waitUntil(() => latest?.composerEl === next.composer);
    expect(latest?.isActive).toBe(true);
    expect(latest?.composerEl).not.toBe(firstComposer);
  });
});

// ===========================================================================
// Invariant #5 — selector misses pause, not crash.
// ===========================================================================

describe("AnchorLayer selector miss — pauses, does not crash (invariant #5)", () => {
  it("with no tweetTextarea_0 present: ComposeContext inactive, miss count climbs, registry empty, no throw", async () => {
    // A fixture with NO composer textarea anywhere (selector miss).
    fixture({ withTextarea: false, tweetCount: 0 });

    let composeActive: boolean | undefined;
    let registrySize = -1;
    function Probe(): null {
      composeActive = useComposeContext().isActive;
      registrySize = useAnchorRegistry().size;
      return null;
    }

    const before = selectorMissCount();

    let threw = false;
    try {
      render(
        <AnchorLayer>
          <Probe />
        </AnchorLayer>,
      );
      await settle();
    } catch {
      threw = true;
    }

    // safeQuery returned null (no composer) → the miss counter advanced, the
    // compose surface stayed inactive, and the registry never grew. No throw.
    expect(threw).toBe(false);
    expect(selectorMissCount()).toBeGreaterThan(before);
    expect(composeActive).toBe(false);
    expect(registrySize).toBe(0);
  });
});

// ===========================================================================
// Anchor registry reconcile — a registered pin whose anchor leaves the DOM is
// dropped on the next reconcile, with no orphan entry.
// ===========================================================================

describe("AnchorLayer registry reconcile — drops pins whose anchor left the DOM", () => {
  it("unmounts the entry for a removed composer dialog node with no orphan", async () => {
    const f = fixture();

    // Hold the live registry so the test can read its size before/after reconcile.
    let registry: ReturnType<typeof useAnchorRegistry> | undefined;
    function Registrar(): null {
      const mutation = useAnchorMutation();
      registry = useAnchorRegistry();
      const handle: AffordanceHandle = {
        anchorEl: f.composer,
        rect: f.composer.getBoundingClientRect(),
        type: "composer",
      };
      mutation.register(handle);
      return null;
    }

    render(
      <AnchorLayer>
        <Registrar />
      </AnchorLayer>,
    );
    await waitUntil(() => (registry?.size ?? 0) >= 1);

    // Remove the composer's dialog so its anchor element leaves the document.
    // The observer-driven reconcile prunes the disconnected anchor.
    f.dialog.remove();

    await waitUntil(() => registry!.size === 0);
    expect(f.composer.isConnected).toBe(false);
    expect(registry!.size).toBe(0);
  });
});

// ===========================================================================
// ProvenanceController flip — generated → user_written (invariant #3).
// The falsifiable sequence: pin "foo", confirm generated; set composer "foo",
// still generated; then change composer to "fo" → MUST flip to user_written.
// A stored-boolean provenance (set once on pin) would stay "generated".
// ===========================================================================

const COMPOSER_TESTID = "tweetTextarea_0";

function provComposer(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset.testid = COMPOSER_TESTID;
  el.setAttribute("contenteditable", "true");
  el.append(document.createTextNode(text));
  const holder = document.createElement("div");
  holder.dataset.xbFixture = "x-shell";
  holder.append(el);
  document.body.append(holder);
  fixtures.push({ root: holder, dialog: holder, composer: el, cleanup: () => holder.remove() });
  return el;
}

interface Captured {
  ctx(): ProvenanceRenderContext;
}

async function mountController(
  props: Omit<Parameters<typeof ProvenanceController>[0], "children">,
): Promise<Captured> {
  let latest: ProvenanceRenderContext | undefined;
  render(
    <ProvenanceController {...props}>
      {(ctx) => {
        latest = ctx;
        return null;
      }}
    </ProvenanceController>,
  );
  await settle();
  return {
    ctx() {
      if (latest === undefined) {
        throw new Error("render prop never invoked");
      }
      return latest;
    },
  };
}

describe("ProvenanceController — provenance is derived, not a stored boolean (invariant #3)", () => {
  it("pin 'foo' → generated; composer 'foo' → still generated; composer 'fo' → flips user_written", async () => {
    const el = provComposer("");
    const cap = await mountController({ composerEl: el, annotations: [] });

    // (a) pin anchor "foo" via the same setAnchor the apply flow uses, and (b)
    // write "foo" to the composer; (c) confirm generated.
    typeInto(el, "foo");
    cap.ctx().setAnchor("foo");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(cap.ctx().provenanceState).toBe("generated");

    // (d) composer text still equals the anchor byte-for-byte → still generated.
    typeInto(el, "foo");
    await settle();
    expect(cap.ctx().provenanceState).toBe("generated");

    // (f) change composer by one char → MUST flip to user_written.
    typeInto(el, "fo");
    await settle();
    expect(cap.ctx().provenanceState).toBe("user_written");
    expect(cap.ctx().showGreen).toBe(false);
  });

  it("no anchor → always user_written regardless of composer text", async () => {
    const el = provComposer("anything the user typed");
    const cap = await mountController({ composerEl: el, annotations: [] });

    expect(cap.ctx().provenanceState).toBe("user_written");
    expect(cap.ctx().showGreen).toBe(false);
  });
});

// ===========================================================================
// Invariant #4 — approved is derived through shared deriveApproved, not a
// bespoke overlay threshold.
// ===========================================================================

describe("ProvenanceController — approved parity with shared deriveApproved (invariant #4)", () => {
  it("generated candidate's approved equals deriveApproved(verdict) at the band boundary", async () => {
    const verdict: JudgeVerdict = makeJudgeVerdict({ scores: { overall: 70 } });
    expect(verdict.verdict).toBe("slight_rework");

    const el = provComposer("");
    const cap = await mountController({ composerEl: el, annotations: [], latestVerdict: verdict });

    typeInto(el, "approved draft");
    cap.ctx().setAnchor("approved draft");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    expect(cap.ctx().provenanceState).toBe("generated");
    expect(cap.ctx().approved).toBe(deriveApproved(verdict));
    expect(cap.ctx().approved).toBe(true);
  });

  it("a sub-threshold verdict's approved equals deriveApproved(verdict) (false)", async () => {
    const verdict: JudgeVerdict = makeJudgeVerdict({ scores: { overall: 69 } });
    expect(verdict.verdict).toBe("major_rework");

    const el = provComposer("");
    const cap = await mountController({ composerEl: el, annotations: [], latestVerdict: verdict });

    typeInto(el, "needs work");
    cap.ctx().setAnchor("needs work");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    expect(cap.ctx().approved).toBe(deriveApproved(verdict));
    expect(cap.ctx().approved).toBe(false);
  });
});
