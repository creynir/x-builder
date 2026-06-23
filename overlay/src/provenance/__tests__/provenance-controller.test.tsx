// @x-builder/overlay — ProvenanceController + provenance derived-model tests
// (RED). Browser-mode harness (Vitest browser / Playwright Chromium),
// real `textContent` and real timers, mirroring the highlight-layer discipline.
//
// WHY BROWSER MODE: the controller reads `composerEl.textContent` on a debounce
// and derives the two-state provenance model from a byte-for-byte comparison of
// the green anchor against the live composer text. The flip-on-edit AC needs a
// REAL contenteditable-like composer whose `textContent` we mutate and a REAL
// fake-timer debounce tick — jsdom's empty layout would make the fixture and the
// flip meaningless. We stub rAF to run synchronously (as the anchor/highlight suites do) so the
// debounced read is observable under fake timers regardless of whether the read
// rides a rAF or a bare setTimeout.
//
// THRESHOLD OWNERSHIP (load-bearing): the approval boundary is owned EXCLUSIVELY
// by `@x-builder/shared` — `deriveApproved` reads the verdict LABEL
// (post_now | slight_rework), and `deriveJudgeVerdict(overall)` maps the score
// band to that label. The overlay must NOT re-implement any threshold. The
// approval-parity tests therefore assert `approved === deriveApproved(verdict)`
// against the REAL imported function (never re-deriving 70/69 here), and the
// negative source-scan test asserts the provenance source files contain no
// threshold literal of their own.

import { deriveApproved, type JudgeAnnotation } from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

// --- Not-yet-existing modules — importing them is what drives the RED state. ---
import { deriveProvenanceState } from "../derive-provenance-state";
import {
  ProvenanceController,
  type ProvenanceRenderContext,
} from "../provenance-controller";
import { useProvenanceAnchor } from "../use-provenance-anchor";

// Raw source of the provenance modules, for the negative threshold scan. These
// `?raw` imports also fail to resolve until the Green agent creates the files,
// which is consistent with (and reinforces) the module-not-found RED state.
import deriveSrc from "../derive-provenance-state.ts?raw";
import controllerSrc from "../provenance-controller.tsx?raw";
import anchorSrc from "../use-provenance-anchor.ts?raw";
import composerTextSrc from "../use-composer-text.ts?raw";

import { buildComposerFixture, makeJudgeVerdict } from "../../testing/fixtures";
import { mountShadowHost, type ShadowHostHandle } from "../../testing/shadow-host";

// --------------------------------------------------------------------------
// Harness: real shadow host mount + fake timers + synchronous rAF, so the
// ~80ms debounced textContent read is observable. Composer fixtures are tracked
// for guaranteed teardown.
// --------------------------------------------------------------------------

const DEBOUNCE_MS = 80;

let harness: ShadowHostHandle | undefined;
const composers: HTMLDivElement[] = [];

/** Render UI into a real token-seeded shadow root; return the mount node. */
function mount(ui: Parameters<typeof render>[0]): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

/** Build + track a composer fixture for teardown. */
function composer(text: string): HTMLDivElement {
  const el = buildComposerFixture(text);
  composers.push(el);
  return el;
}

/** Replace the composer's text and notify, then flush past the debounce. */
function editComposerTo(el: HTMLElement, text: string): void {
  // Mutate the single Text node in place so the live element identity is kept.
  if (el.firstChild) {
    el.firstChild.textContent = text;
  } else {
    el.append(document.createTextNode(text));
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  flushDebounce();
}

/**
 * Simulate the real generate/apply flow: the candidate text is
 * WRITTEN to the composer, then `setAnchor` is called from the composer's
 * post-write `textContent`. The input event + debounce flush is what triggers
 * the controller to re-read composer text and re-derive — `setAnchor` alone
 * writes a ref and (per the DoD) does not re-render, so a co-occurring composer
 * signal is required for the derived state to update, exactly as in production.
 */
function applyGenerated(
  cap: { ctx(): ProvenanceRenderContext },
  el: HTMLElement,
  text: string,
): void {
  if (el.firstChild) {
    el.firstChild.textContent = text;
  } else {
    el.append(document.createTextNode(text));
  }
  cap.ctx().setAnchor(text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  flushDebounce();
}

/** Advance past the ~80ms debounce window; rAF runs synchronously via the stub. */
function flushDebounce(): void {
  vi.advanceTimersByTime(DEBOUNCE_MS * 2);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  harness?.cleanup();
  harness = undefined;
  while (composers.length > 0) {
    composers.pop()?.closest('[data-xb-fixture="composer"]')?.remove();
  }
  document.querySelectorAll('[data-xb-fixture="composer"]').forEach((n) => n.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --------------------------------------------------------------------------
// Render-prop capture helper: render the controller with a children render-prop
// that records the LATEST ProvenanceRenderContext into a test-scoped variable
// (the established `Probe`-capture pattern, see anchor-layer.test.tsx). Returns
// a getter for the latest context plus the mount node.
// --------------------------------------------------------------------------

interface Captured {
  ctx(): ProvenanceRenderContext;
  root: HTMLElement;
}

function mountController(
  props: Omit<
    Parameters<typeof ProvenanceController>[0],
    "children"
  >,
): Captured {
  let latest: ProvenanceRenderContext | undefined;
  const root = mount(
    <ProvenanceController {...props}>
      {(ctx) => {
        latest = ctx;
        return null;
      }}
    </ProvenanceController>,
  );
  // The controller reads textContent on a debounce; settle the first read.
  flushDebounce();
  return {
    ctx(): ProvenanceRenderContext {
      if (latest === undefined) {
        throw new Error("render prop never invoked");
      }
      return latest;
    },
    root,
  };
}

const annotation = (
  quote: string,
  recommendation: string,
  severity: JudgeAnnotation["severity"] = "warning",
): JudgeAnnotation => ({ quote, severity, recommendation });

// ==========================================================================
// 1. deriveProvenanceState — pure function (DoD: byte-for-byte `===` only).
// ==========================================================================

describe("deriveProvenanceState (pure fn)", () => {
  it("anchor byte-equal to composer text → 'generated'", () => {
    expect(deriveProvenanceState("hello world", "hello world")).toBe("generated");
  });

  it("anchor differs by one char → 'user_written'", () => {
    expect(deriveProvenanceState("hello world", "hello world!")).toBe("user_written");
  });

  it("null anchor → 'user_written' regardless of composer text", () => {
    expect(deriveProvenanceState(null, "anything at all")).toBe("user_written");
  });

  it("empty-equal strings ('','') → 'generated' (no crash on empty)", () => {
    expect(deriveProvenanceState("", "")).toBe("generated");
  });
});

// ==========================================================================
// 2. Controller: mounted, no anchor → user_written, showGreen false.
//    (AC: anchor === null ⇒ user_written regardless of composer text.)
// ==========================================================================

describe("ProvenanceController — no anchor set", () => {
  it("composer 'foo', no anchor → provenanceState 'user_written', showGreen false", () => {
    const el = composer("foo");
    const cap = mountController({ composerEl: el, annotations: [] });

    expect(cap.ctx().provenanceState).toBe("user_written");
    expect(cap.ctx().showGreen).toBe(false);
  });
});

// ==========================================================================
// 3. setAnchor("foo") + composer "foo" → generated, showGreen, !showBlue.
// ==========================================================================

describe("ProvenanceController — anchor byte-equal to composer", () => {
  it("setAnchor('foo') with composer 'foo' → generated, showGreen true, showBlue false", () => {
    // Seed an empty composer so the apply flow drives a real "" → "foo"
    // composer-text transition (and thus a controller re-derive).
    const el = composer("");
    const cap = mountController({ composerEl: el, annotations: [] });
    expect(cap.ctx().provenanceState).toBe("user_written");

    applyGenerated(cap, el, "foo");

    expect(cap.ctx().provenanceState).toBe("generated");
    expect(cap.ctx().showGreen).toBe(true);
    expect(cap.ctx().showBlue).toBe(false);
  });
});

// ==========================================================================
// 4. Edit-flip: after setAnchor('foo'), edit composer to 'foo!' + debounce →
//    flips to user_written, showGreen false (AC: flip on first diverging tick).
// ==========================================================================

describe("ProvenanceController — edit flips generated → user_written", () => {
  it("after setAnchor('foo'), editing composer to 'foo!' flips to user_written on the debounce tick", () => {
    const el = composer("");
    const cap = mountController({ composerEl: el, annotations: [] });

    applyGenerated(cap, el, "foo");
    // Sanity: in generated state before the edit.
    expect(cap.ctx().provenanceState).toBe("generated");

    editComposerTo(el, "foo!");

    expect(cap.ctx().provenanceState).toBe("user_written");
    expect(cap.ctx().showGreen).toBe(false);
  });
});

// ==========================================================================
// 5 & 6. showBlue gating by state with non-empty annotations.
//    (AC: user_written + annotations ⇒ showBlue; generated + annotations ⇒ !showBlue.)
// ==========================================================================

describe("ProvenanceController — showBlue gating", () => {
  it("annotations non-empty + user_written → showBlue true", () => {
    const el = composer("foo");
    const cap = mountController({
      composerEl: el,
      annotations: [annotation("foo", "soften", "warning")],
    });

    // No anchor ⇒ user_written.
    expect(cap.ctx().provenanceState).toBe("user_written");
    expect(cap.ctx().showBlue).toBe(true);
  });

  it("annotations non-empty + generated → showBlue false (blue hidden in generated)", () => {
    const el = composer("");
    const cap = mountController({
      composerEl: el,
      annotations: [annotation("foo", "soften", "warning")],
    });

    applyGenerated(cap, el, "foo");

    expect(cap.ctx().provenanceState).toBe("generated");
    expect(cap.ctx().showBlue).toBe(false);
  });
});

// ==========================================================================
// 7. approved parity — asserted against the REAL deriveApproved, never a
//    re-derived threshold. Labels come from makeJudgeVerdict (label-from-overall).
//    (AC: overall 70 ⇒ approved true; overall 69 ⇒ approved false.)
// ==========================================================================

describe("ProvenanceController — approved parity with shared deriveApproved", () => {
  it("overall 70 (label slight_rework) + generated → approved true === deriveApproved(verdict)", () => {
    const verdict = makeJudgeVerdict({ scores: { overall: 70 } });
    // Guard the fixture wiring: label must be the approving band, else the test
    // would be vacuous (deriveApproved reads the label, not the score).
    expect(verdict.verdict).toBe("slight_rework");

    const el = composer("");
    const cap = mountController({
      composerEl: el,
      annotations: [],
      latestVerdict: verdict,
    });

    applyGenerated(cap, el, "foo");

    expect(cap.ctx().provenanceState).toBe("generated");
    expect(cap.ctx().approved).toBe(true);
    expect(cap.ctx().approved).toBe(deriveApproved(verdict));
  });

  it("overall 69 (label major_rework) → approved false === deriveApproved(verdict)", () => {
    const verdict = makeJudgeVerdict({ scores: { overall: 69 } });
    expect(verdict.verdict).toBe("major_rework");

    const el = composer("");
    const cap = mountController({
      composerEl: el,
      annotations: [],
      latestVerdict: verdict,
    });

    applyGenerated(cap, el, "foo");

    expect(cap.ctx().approved).toBe(false);
    expect(cap.ctx().approved).toBe(deriveApproved(verdict));
  });
});

// ==========================================================================
// 8. Negative source-scan — no approval-threshold literal in provenance source.
//    The threshold is owned exclusively by shared's deriveApproved /
//    deriveJudgeVerdict (AC line 146 / DoD). Scoped to overlay/src/provenance/**.
// ==========================================================================

describe("ProvenanceController — no bespoke approval threshold in source", () => {
  const sources: ReadonlyArray<readonly [string, string]> = [
    ["derive-provenance-state.ts", deriveSrc],
    ["provenance-controller.tsx", controllerSrc],
    ["use-provenance-anchor.ts", anchorSrc],
    ["use-composer-text.ts", composerTextSrc],
  ];

  // Numeric score-threshold comparisons (>= 70 / > 69, any spacing).
  const NUMERIC_THRESHOLD = /[><]=?\s*(?:70|69)\b/;
  // Verdict-label literal comparisons that would re-implement deriveApproved.
  const LABEL_LITERAL = /===\s*["'](?:post_now|slight_rework)["']/;

  for (const [name, src] of sources) {
    it(`${name} contains no numeric approval threshold (>= 70 / > 69)`, () => {
      expect(NUMERIC_THRESHOLD.test(src)).toBe(false);
    });

    it(`${name} contains no verdict-label threshold literal (=== "post_now"/"slight_rework")`, () => {
      expect(LABEL_LITERAL.test(src)).toBe(false);
    });
  }
});

// ==========================================================================
// 9. Edge: composerEl becomes null mid-session → user_written even if anchor "".
//    (Edge case: null composer ⇒ no active compose session.)
// ==========================================================================

describe("ProvenanceController — null composer guard", () => {
  it("composerEl null with anchor set to '' → user_written (not a spurious 'generated')", () => {
    const cap = mountController({ composerEl: null, annotations: [] });

    // Even after setting the anchor to the empty string, a null composer means
    // no active session, so the state must not read as 'generated'.
    cap.ctx().setAnchor("");
    flushDebounce();

    expect(cap.ctx().provenanceState).toBe("user_written");
    expect(cap.ctx().showGreen).toBe(false);
  });
});

// ==========================================================================
// 10. useProvenanceAnchor — useRef-backed: set does NOT re-render, stable fn
//     refs, last-call-wins, clearAnchor resets to null.
// ==========================================================================

describe("useProvenanceAnchor (hook)", () => {
  it("setAnchor does not trigger a re-render (anchor lives in a ref)", () => {
    let renders = 0;
    let api: ReturnType<typeof useProvenanceAnchor> | undefined;

    function Probe(): null {
      renders += 1;
      api = useProvenanceAnchor();
      return null;
    }

    render(<Probe />);
    const rendersAfterMount = renders;

    api!.setAnchor("hello");
    flushDebounce();

    // A useRef-backed setter must not schedule a React update.
    expect(renders).toBe(rendersAfterMount);
  });

  it("setAnchor / clearAnchor are stable references across renders", () => {
    const setRefs: Array<(t: string) => void> = [];
    const clearRefs: Array<() => void> = [];

    function Probe({ tick }: { tick: number }): null {
      const { setAnchor, clearAnchor } = useProvenanceAnchor();
      // Reference `tick` so each rerender is a genuinely new render pass.
      void tick;
      setRefs.push(setAnchor);
      clearRefs.push(clearAnchor);
      return null;
    }

    const { rerender } = render(<Probe tick={0} />);
    rerender(<Probe tick={1} />);
    rerender(<Probe tick={2} />);

    expect(new Set(setRefs).size).toBe(1);
    expect(new Set(clearRefs).size).toBe(1);
  });

  it("rapid setAnchor calls → last call wins (no queue)", () => {
    let api: ReturnType<typeof useProvenanceAnchor> | undefined;

    // `tick` forces a genuine re-render so the freshly captured `api.anchor`
    // reflects the ref's CURRENT value — we assert the persisted ref value, not
    // a re-render-on-set (set itself must NOT re-render; see the test above).
    function Probe({ tick }: { tick: number }): null {
      void tick;
      api = useProvenanceAnchor();
      return null;
    }

    const { rerender } = render(<Probe tick={0} />);

    api!.setAnchor("first");
    api!.setAnchor("second");
    api!.setAnchor("third");

    rerender(<Probe tick={1} />);

    // No queue: the last call is the live anchor value.
    expect(api!.anchor).toBe("third");
  });

  it("clearAnchor resets the anchor to null", () => {
    let api: ReturnType<typeof useProvenanceAnchor> | undefined;

    function Probe({ tick }: { tick: number }): null {
      void tick;
      api = useProvenanceAnchor();
      return null;
    }

    const { rerender } = render(<Probe tick={0} />);

    api!.setAnchor("something");
    rerender(<Probe tick={1} />);
    expect(api!.anchor).toBe("something");

    api!.clearAnchor();
    rerender(<Probe tick={2} />);
    expect(api!.anchor).toBeNull();
  });
});
