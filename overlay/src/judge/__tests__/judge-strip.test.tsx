// @x-builder/overlay — JudgeStrip tests (browser mode → Playwright Chromium)
//
// RED: `../judge-strip` does not exist yet, so importing `JudgeStrip`
// is what drives the failing state. These tests pin the 9 ticket cases + the key
// edges against a PURELY PRESENTATIONAL component: it receives `judge`,
// `provenance`, `applyState`, `onRetryJudge`, and `explainer` as props and
// renders. The judge transport, the `judgeDraft` kick, edit-while-judging abort,
// and the generate-refine BRANCHING are OUT OF SCOPE here (owned by the
// ComposeCockpit machine) — JudgeStrip only renders what `judge` + `provenance`
// tell it.
//
// Contract fixtures are REAL shapes: `makeJudgeVerdict` builds a full
// 13-dim `JudgeVerdict` whose `verdict` label is derived from `scores.overall`
// via shared's `deriveJudgeVerdict`, so `deriveApproved` (imported from
// `@x-builder/shared`, never re-implemented here) agrees with the score the
// approval ACs assert. `ProvenanceState` is the bare string union
// `"generated" | "user_written"` — compared `provenance === "generated"`,
// NOT `provenance.status`.
//
// Harness: the established overlay shadow-host harness (`mountShadowHost`) with
// the design-token + neon sheets adopted, rendered via `vitest-browser-react`
// into the real shadow tree — same pattern as `static-engine-column.test.tsx`
// and `ui-v2.test.tsx`. We assert what is stable in browser mode (text, role,
// aria-live/-busy, variant markers, ScoreBar progressbar markers, computed-style
// button-fill comparison against a reference primary Button), not pixels.
//
// Reduced-motion note (for Green): this browser-mode harness exposes NO
// `page.emulateMedia` hook and the repo never toggles the OS media query in a
// running test (`bootstrap.test.tsx` only asserts the sheet TEXT carries the
// `prefers-reduced-motion` block). The neon sheet only zeroes
// `--xb-pulse-duration` under reduced motion — but the ticket requires the pulse
// keyframe be gated SEPARATELY (DoD: "gated keyframe — not relying on
// --duration-* vars"). So these tests pin the reduced-motion contract via a
// STABLE STRUCTURAL SIGNAL the impl must expose on the running indicator:
//   - normal motion: the pulse dot carries `data-judge-pulse="animated"`,
//   - the indicator's animation references a NAMED keyframe (not just the
//     duration var), so a `@media (prefers-reduced-motion: reduce)` rule can
//     set `animation-name: none` independently of the duration token,
//   - and the indicator always carries a static "Running…" label + the running
//     region is `aria-busy="true"`, which is the reduced-motion-safe affordance.
// Green: keep `data-judge-pulse` as the stable signal (test 2/8 read it).

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { deriveApproved } from "@x-builder/shared";

import { Button } from "../../../../client/src/ui/v2/button";
import { overlayExplainerCopy } from "../../explainer/copy";
import type { ProvenanceState } from "../../provenance/derive-provenance-state";
import { makeJudgeVerdict } from "../../testing/fixtures";
import { mountShadowHost, type ShadowHostHandle } from "../../testing/shadow-host";

// Not-yet-existing module — importing it is what drives the RED state.
import { JudgeStrip } from "../judge-strip";

let harness: ShadowHostHandle;

function mount(ui: ReactNode): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

// --------------------------------------------------------------------------
// Real fixtures (from the ticket Test Strategy).
// --------------------------------------------------------------------------

// overall 74 → label "slight_rework" (deriveApproved === true).
const judgedVerdict = makeJudgeVerdict({
  scores: { overall: 74 },
  headline: "Good hook, sharpen the close",
  strengths: ["Clear value prop"],
  improvements: ["End with a sharper call to action"],
  annotations: [
    { quote: "sharpen the close", severity: "suggestion", recommendation: "Add a concrete CTA" },
  ],
});

// overall 85 → label "post_now" (deriveApproved === true).
const approvedVerdict = makeJudgeVerdict({ scores: { overall: 85 } });

// Sanity-guard the fixtures so a future factory change cannot silently turn
// these assertions into tautologies (both must be approved; band labels fixed).
if (judgedVerdict.verdict !== "slight_rework" || !deriveApproved(judgedVerdict)) {
  throw new Error("judgedVerdict fixture must be slight_rework + approved.");
}
if (approvedVerdict.verdict !== "post_now" || !deriveApproved(approvedVerdict)) {
  throw new Error("approvedVerdict fixture must be post_now + approved.");
}

const GENERATED: ProvenanceState = "generated";
const USER_WRITTEN: ProvenanceState = "user_written";

/** Default props with overridable fields; `applyState` is `"idle"` in scope. */
function props(
  overrides: Partial<Parameters<typeof JudgeStrip>[0]> = {},
): Parameters<typeof JudgeStrip>[0] {
  return {
    judge: { status: "waiting" },
    provenance: USER_WRITTEN,
    applyState: "idle",
    onRetryJudge: vi.fn(),
    // Green makes `onApplyAll` a required prop on JudgeStrip. Adding it
    // to the helper defaults keeps every existing test (which builds props via
    // this helper) typechecking without touching their bodies.
    onApplyAll: vi.fn(),
    explainer: overlayExplainerCopy,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Shadow-aware query helpers.
// --------------------------------------------------------------------------

function buttons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
}

/** ScoreBar dims expose role=progressbar WITH the score-fill band marker; this
 * excludes the Button spinner (also role=progressbar) and the loading skeleton
 * (role=status), so the count is exactly the rendered dims. */
function scoreBars(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[role="progressbar"]'),
  ).filter((el) => el.querySelector("[data-score-fill]") !== null);
}

/** The pulse / running indicator the impl must mark with a stable hook. */
function pulseDot(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-judge-pulse]");
}

/** The polite verdict live region. */
function liveRegion(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[aria-live="polite"]');
}

// --------------------------------------------------------------------------
// 1. Waiting → static "Waiting for draft…" label; no pulse; no aria-busy.
// --------------------------------------------------------------------------

describe("JudgeStrip — waiting", () => {
  it("shows a static waiting label, no pulse dot, and is not aria-busy", () => {
    const root = mount(<JudgeStrip {...props({ judge: { status: "waiting" } })} />);

    expect(root.textContent?.toLowerCase()).toContain("waiting for draft");
    // No animated running indicator while waiting.
    expect(pulseDot(root)).toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).toBeNull();
    // No verdict has arrived: no score dims, no "AI judge running" label.
    expect(scoreBars(root)).toHaveLength(0);
    expect(root.textContent).not.toContain("AI judge running");
  });
});

// --------------------------------------------------------------------------
// 2. Running → pulse dot + "AI judge running" label; verdict grid NOT visible.
//    (And: the running region is aria-busy — the reduced-motion-safe affordance.)
// --------------------------------------------------------------------------

describe("JudgeStrip — running", () => {
  it("shows a judge-pulse dot and the 'AI judge running' label, with no verdict grid", () => {
    const root = mount(<JudgeStrip {...props({ judge: { status: "running" } })} />);

    const dot = pulseDot(root);
    expect(dot).not.toBeNull();
    expect(root.textContent).toContain("AI judge running");

    // The verdict grid is not visible while running.
    expect(scoreBars(root)).toHaveLength(0);
    expect(root.textContent).not.toContain(judgedVerdict.headline);
  });

  it("marks the running indicator aria-busy (the reduced-motion-safe affordance)", () => {
    const root = mount(<JudgeStrip {...props({ judge: { status: "running" } })} />);

    // aria-busy="true" rides on the running indicator regardless of motion
    // preference, so a static-label / no-pulse environment still announces work.
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

// --------------------------------------------------------------------------
// 3. Judged → verdict band badge + 13 filled ScoreBar dims + notes visible.
// --------------------------------------------------------------------------

describe("JudgeStrip — judged", () => {
  it("renders the verdict band badge, 13 ScoreBar dims, and strengths/improvements", () => {
    const root = mount(
      <JudgeStrip
        {...props({ judge: { status: "judged", verdict: judgedVerdict } })}
      />,
    );

    // 13-dim score grid fills (one ScoreBar per judge dimension).
    expect(scoreBars(root)).toHaveLength(13);

    // The verdict BAND badge renders on every judged state. It is a v2 Badge
    // ([data-variant]) carrying band text — distinct from the approval badge.
    const variantNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-variant]"),
    );
    const bandBadge = variantNodes.find((n) =>
      /slight|rework/i.test(n.textContent ?? ""),
    );
    expect(bandBadge).toBeDefined();

    // Notes surface verbatim.
    expect(root.textContent).toContain(judgedVerdict.strengths[0]!);
    expect(root.textContent).toContain(judgedVerdict.improvements[0]!);

    // No pulse once judged.
    expect(pulseDot(root)).toBeNull();
  });

  it("renders the grid normally when annotations is empty (no annotation UI)", () => {
    const noAnnotations = makeJudgeVerdict({ scores: { overall: 74 }, annotations: [] });
    const root = mount(
      <JudgeStrip
        {...props({ judge: { status: "judged", verdict: noAnnotations } })}
      />,
    );

    // The 13-dim grid is unaffected by zero annotations (annotations are
    // out of scope here; the strip just renders the scores).
    expect(scoreBars(root)).toHaveLength(13);
  });
});

// --------------------------------------------------------------------------
// 4. aria-live announce → on running → judged, the polite region carries
//    the band + overall.
// --------------------------------------------------------------------------

describe("JudgeStrip — aria-live announcement", () => {
  it("announces the band + overall in the polite region on running → judged", () => {
    const baseProps = props({ judge: { status: "running" } });
    const { rerender } = render(<JudgeStrip {...baseProps} />, {
      container: (harness = mountShadowHost()).mount,
    });
    const root = harness.mount;

    // While running, the polite region holds no verdict result yet.
    const beforeRegion = liveRegion(root);
    expect(beforeRegion?.textContent ?? "").not.toContain(String(judgedVerdict.scores.overall));

    // Transition to judged via re-render (the machine flips judge state).
    rerender(
      <JudgeStrip
        {...props({ judge: { status: "judged", verdict: judgedVerdict } })}
      />,
    );

    const region = liveRegion(root);
    expect(region).not.toBeNull();
    // The announcement carries the overall score…
    expect(region!.textContent).toContain(String(judgedVerdict.scores.overall));
    // …and the band identity (slight_rework, rendered human/raw).
    expect(/slight|rework/i.test(region!.textContent ?? "")).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 5. Failed → danger Alert + retry button; click calls onRetryJudge once.
// --------------------------------------------------------------------------

describe("JudgeStrip — failed", () => {
  it("renders a danger Alert with a retry Button that calls onRetryJudge once", () => {
    const onRetryJudge = vi.fn();
    const root = mount(
      <JudgeStrip
        {...props({ judge: { status: "failed", error: "judge crashed" }, onRetryJudge })}
      />,
    );

    const alert = root.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(
      alert!.getAttribute("data-variant") ?? alert!.getAttribute("class") ?? "",
    ).toContain("danger");

    const retry = buttons(root).find((b) => /retry|try again/i.test(b.textContent ?? ""));
    expect(retry).toBeDefined();
    retry!.click();
    expect(onRetryJudge).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// 6. Refine entry (pre-approved) → judged + provenance "generated" →
//    "✓ Judge approved" shown; no pulse.
// --------------------------------------------------------------------------

describe("JudgeStrip — refine entry (pre-approved)", () => {
  it("shows '✓ Judge approved' when generated + judged + deriveApproved, with no pulse", () => {
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: approvedVerdict },
          provenance: GENERATED,
        })}
      />,
    );

    // The approved badge surfaces immediately — the verdict already arrived.
    expect(root.textContent).toContain("✓ Judge approved");
    // No pulse / wait on the pre-approved entry.
    expect(pulseDot(root)).toBeNull();
    expect(root.textContent).not.toContain("AI judge running");
    // The approval badge is a v2 success Badge (distinct from the band badge).
    const successBadge = Array.from(
      root.querySelectorAll<HTMLElement>('[data-variant="success"]'),
    ).find((n) => /judge approved/i.test(n.textContent ?? ""));
    expect(successBadge).toBeDefined();
  });

  it("does NOT show '✓ Judge approved' for the same approved verdict when user_written", () => {
    // Proves the badge is gated on provenance — not a tautology of "judged".
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: approvedVerdict },
          provenance: USER_WRITTEN,
        })}
      />,
    );

    expect(root.textContent).not.toContain("✓ Judge approved");
    // But the verdict band badge still renders on every judged state.
    expect(scoreBars(root)).toHaveLength(13);
    const bandBadge = Array.from(
      root.querySelectorAll<HTMLElement>("[data-variant]"),
    ).find((n) => /post.?now/i.test(n.textContent ?? ""));
    expect(bandBadge).toBeDefined();
  });

  it("does NOT show '✓ Judge approved' for a generated but NOT-approved verdict", () => {
    // Proves the badge is also gated on deriveApproved (overall 30 → do_not_post).
    const rejected = makeJudgeVerdict({ scores: { overall: 30 } });
    expect(deriveApproved(rejected)).toBe(false);

    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: rejected },
          provenance: GENERATED,
        })}
      />,
    );

    expect(root.textContent).not.toContain("✓ Judge approved");
  });
});

// --------------------------------------------------------------------------
// 7. Refine fallback (no verdict) → judge waiting → normal waiting flow.
// --------------------------------------------------------------------------

describe("JudgeStrip — refine fallback (no verdict)", () => {
  it("runs the normal waiting flow with no approved badge and no pulse", () => {
    // Candidate applied without a verdict → text enters user_written, judge
    // state is waiting (the machine will kick the normal flow next).
    const root = mount(
      <JudgeStrip
        {...props({ judge: { status: "waiting" }, provenance: USER_WRITTEN })}
      />,
    );

    expect(root.textContent?.toLowerCase()).toContain("waiting for draft");
    expect(root.textContent).not.toContain("✓ Judge approved");
    expect(pulseDot(root)).toBeNull();
    expect(scoreBars(root)).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 8. Reduced motion → pulse keyframe is gated separately; a static "Running…"
//    label is present. (Harness cannot toggle the OS media query — pin the
//    stable signal Green must expose; see file header.)
// --------------------------------------------------------------------------

describe("JudgeStrip — reduced-motion contract (running)", () => {
  it("exposes a static 'Running…' label and an aria-busy region in running", () => {
    const root = mount(<JudgeStrip {...props({ judge: { status: "running" } })} />);

    // The reduced-motion-safe affordance: a static "Running…" text label and a
    // busy region that does not depend on the pulse animation playing.
    expect(root.textContent?.toLowerCase()).toContain("running");
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("gates the pulse on a NAMED keyframe (not solely the duration var)", () => {
    const root = mount(<JudgeStrip {...props({ judge: { status: "running" } })} />);

    const dot = pulseDot(root);
    expect(dot).not.toBeNull();
    // The dot's stable hook value declares it is the animated branch in normal
    // motion. A `@media (prefers-reduced-motion: reduce)` rule must be able to
    // turn it off via `animation-name: none` INDEPENDENTLY of
    // `--xb-pulse-duration` (the DoD's "gated keyframe" requirement). We assert
    // the impl carries a real, named animation rather than only an inline
    // duration var: the computed animation-name is a real keyframe ident.
    expect(dot!.getAttribute("data-judge-pulse")).toBe("animated");
    const animationName = getComputedStyle(dot!).animationName;
    expect(animationName).toBeTruthy();
    expect(animationName).not.toBe("none");
  });
});

// --------------------------------------------------------------------------
// 9. Never primary CTA → no JudgeStrip button uses the primary fill.
// --------------------------------------------------------------------------

describe("JudgeStrip — never primary CTA", () => {
  it("renders no button painted with the primary-CTA fill (retry is ghost/secondary)", () => {
    // Render a reference primary Button in the SAME shadow host so we read the
    // EXACT resolved primary fill (`--interactive-default` → `--accent-9`),
    // rather than hard-coding a brittle hue. Then assert no JudgeStrip button
    // matches it. The failed state is the only state with a button (retry).
    const root = mount(
      <>
        <Button variant="primary" onClick={() => {}}>
          Reference primary
        </Button>
        <JudgeStrip
          {...props({ judge: { status: "failed", error: "judge crashed" } })}
        />
      </>,
    );

    const allButtons = buttons(root);
    const reference = allButtons.find((b) =>
      /reference primary/i.test(b.textContent ?? ""),
    );
    expect(reference).toBeDefined();
    const primaryFill = getComputedStyle(reference!).backgroundColor;
    // Guard: the reference resolved to a real, non-transparent fill.
    expect(primaryFill).not.toBe("rgba(0, 0, 0, 0)");

    const judgeButtons = allButtons.filter((b) => b !== reference);
    expect(judgeButtons.length).toBeGreaterThan(0); // retry exists
    for (const btn of judgeButtons) {
      expect(getComputedStyle(btn).backgroundColor).not.toBe(primaryFill);
    }
  });
});

// --------------------------------------------------------------------------
// Edge: unavailable → quiet hint (no danger Alert) + polite "Judge unavailable".
// --------------------------------------------------------------------------

describe("JudgeStrip — unavailable", () => {
  it("shows a quiet hint and a polite announcement, with no danger Alert", () => {
    const hint = "Configure the judge in Settings.";
    const root = mount(
      <JudgeStrip {...props({ judge: { status: "unavailable", hint } })} />,
    );

    // The hint is surfaced verbatim.
    expect(root.textContent).toContain(hint);

    // No danger Alert: unavailable is a quiet state, not a failure.
    const danger = Array.from(
      root.querySelectorAll<HTMLElement>('[role="alert"][data-variant="danger"]'),
    );
    expect(danger).toHaveLength(0);

    // The polite region announces the unavailable state.
    const region = liveRegion(root);
    expect(region).not.toBeNull();
    expect(region!.textContent?.toLowerCase()).toContain("judge unavailable");

    // No pulse, no score grid.
    expect(pulseDot(root)).toBeNull();
    expect(scoreBars(root)).toHaveLength(0);
  });
});

// ==========================================================================
// auto-improve: Apply-all + ApplyState render + provenance gate.
//
// RED: these pin the apply affordance Green will add to
// `judge-strip.tsx` (the `onApplyAll` prop + Apply-all button + the
// `ApplyState`-machine render + the AlreadySolid/failure banners). They fail
// because the current impl ignores `applyState` and renders no apply
// UI (and `onApplyAll` is not yet a prop) — NOT because of test bugs. The
// cases above keep passing (they don't exercise apply behavior; the
// `props()` helper's new `onApplyAll: vi.fn()` default just keeps them
// typechecking once Green makes the prop required).
//
// Stable hooks for Green:
//   - Apply-all button: queried by its label text `/apply all suggestions/i`
//     (the ✦ glyph is optional in the match) via role/text, so the exact
//     leading glyph is not load-bearing.
//   - Applying indicator: asserted via the "Improving…" label + an
//     `aria-busy="true"` region (the reduced-motion-safe affordance), mirroring
//     the judge running indicator. If Green reuses the running pulse dot
//     (`data-judge-pulse="animated"`) for the apply pulse that is fine, but the
//     load-bearing signal these tests pin is the label + `aria-busy`.
//   - AlreadySolid banner: `Alert` with `data-variant="warning"` + title text
//     `/already solid/i`.
//   - Failure banner: `Alert` with `data-variant="danger"` + a retry button
//     whose click fires `onApplyAll` (the APPLY retry — distinct from the
//     judge-failure retry that fires `onRetryJudge`).
// ==========================================================================

/** Apply-all button by label, glyph-agnostic (matches "✦ Apply all suggestions"). */
function applyAllButton(root: ParentNode): HTMLButtonElement | undefined {
  return buttons(root).find((b) => /apply all suggestions/i.test(b.textContent ?? ""));
}

/** A judged, approved verdict in user_written state — the canonical "ready to apply" base. */
const judgedUserWrittenProps = () =>
  props({
    judge: { status: "judged", verdict: judgedVerdict },
    provenance: USER_WRITTEN,
    applyState: "idle",
  });

describe("auto-improve: Apply-all + ApplyState machine + provenance gate", () => {
  // ------------------------------------------------------------------------
  // 1. Apply-all HIDDEN (absent from DOM) in `generated` — loop-prevention.
  // ------------------------------------------------------------------------
  it("does not render the Apply-all button in the generated state (absent from DOM, not just CSS-hidden)", () => {
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: approvedVerdict },
          provenance: GENERATED,
          applyState: "idle",
        })}
      />,
    );

    // The button is absent from the DOM entirely — query by role/text and
    // assert nothing matches (not merely display:none). Both the resolved
    // button and the raw label text are gone, so this cannot pass on a
    // CSS-hidden-but-present button.
    expect(applyAllButton(root)).toBeUndefined();
    expect(root.textContent).not.toContain("Apply all suggestions");
  });

  // ------------------------------------------------------------------------
  // 2. Apply-all VISIBLE + ENABLED in `user_written` + judged.
  // ------------------------------------------------------------------------
  it("renders an enabled '✦ Apply all suggestions' button in user_written + judged", () => {
    const root = mount(<JudgeStrip {...judgedUserWrittenProps()} />);

    const btn = applyAllButton(root);
    expect(btn).toBeDefined();
    // Present AND not disabled (clickable affordance, not a greyed placeholder).
    expect(btn!.disabled).toBe(false);
  });

  // ------------------------------------------------------------------------
  // 3. `applying` → pulse/loading + "Improving…" + aria-busy; the Apply-all
  //    button is replaced by the loading indicator (not separately clickable).
  // ------------------------------------------------------------------------
  it("shows an 'Improving…' loading indicator with aria-busy and no separate Apply-all button while applying", () => {
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: judgedVerdict },
          provenance: USER_WRITTEN,
          applyState: "applying",
        })}
      />,
    );

    // The applying affordance: an "Improving…" label inside an aria-busy region.
    expect(root.textContent?.toLowerCase()).toContain("improving");
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();

    // The clickable Apply-all button is replaced by the loading indicator: no
    // separately-clickable "Apply all suggestions" button remains.
    expect(applyAllButton(root)).toBeUndefined();
  });

  // ------------------------------------------------------------------------
  // 4. `applied` + improvedOverOriginal:true + generated + approved verdict →
  //    "✓ Judge approved" visible; Apply-all hidden.
  // ------------------------------------------------------------------------
  it("shows '✓ Judge approved' and hides Apply-all on applied+improved in generated/approved", () => {
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: approvedVerdict },
          provenance: GENERATED,
          applyState: { status: "applied", improvedOverOriginal: true },
        })}
      />,
    );

    expect(root.textContent).toContain("✓ Judge approved");
    expect(applyAllButton(root)).toBeUndefined();
  });

  // ------------------------------------------------------------------------
  // 5. `applied` + improvedOverOriginal:false → AlreadySolid banner: Alert
  //    data-variant="warning" (NOT "danger"); title contains "Already solid";
  //    Apply-all hidden (state is generated).
  // ------------------------------------------------------------------------
  it("renders an AlreadySolid warning Alert (not danger) when applied but not improved", () => {
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: approvedVerdict },
          provenance: GENERATED,
          applyState: { status: "applied", improvedOverOriginal: false },
        })}
      />,
    );

    const alerts = Array.from(root.querySelectorAll<HTMLElement>('[role="alert"]'));
    const alreadySolid = alerts.find((a) => /already solid/i.test(a.textContent ?? ""));
    expect(alreadySolid).toBeDefined();
    // The banner is informational (warning), explicitly NOT an error/danger state.
    expect(alreadySolid!.getAttribute("data-variant")).toBe("warning");

    // And no danger Alert masquerading as the already-solid banner.
    expect(
      alerts.some((a) => a.getAttribute("data-variant") === "danger"),
    ).toBe(false);

    // Apply-all stays hidden (the re-pin flipped provenance to generated).
    expect(applyAllButton(root)).toBeUndefined();
  });

  // ------------------------------------------------------------------------
  // 6. `failed` → danger Alert + retry button; clicking retry fires onApplyAll
  //    (the APPLY retry — NOT onRetryJudge, which is the judge-failure retry).
  // ------------------------------------------------------------------------
  it("renders a danger Alert with a retry that calls onApplyAll once (not onRetryJudge)", () => {
    const onApplyAll = vi.fn();
    const onRetryJudge = vi.fn();
    const root = mount(
      <JudgeStrip
        {...props({
          // judge is JUDGED (not failed) so the only danger Alert here is the
          // apply-failure one — its retry must drive onApplyAll, never onRetryJudge.
          judge: { status: "judged", verdict: judgedVerdict },
          provenance: USER_WRITTEN,
          applyState: { status: "failed", error: "generation_failed" },
          onApplyAll,
          onRetryJudge,
        })}
      />,
    );

    const dangerAlert = Array.from(
      root.querySelectorAll<HTMLElement>('[role="alert"][data-variant="danger"]'),
    );
    expect(dangerAlert).toHaveLength(1);
    // The error string surfaces in the failure banner.
    expect(dangerAlert[0]!.textContent).toContain("generation_failed");

    // The retry button lives in the apply-failure Alert. Click it.
    const retry = buttons(root).find((b) => /retry|try again/i.test(b.textContent ?? ""));
    expect(retry).toBeDefined();
    retry!.click();

    // The APPLY retry drives onApplyAll exactly once, and never the judge retry.
    expect(onApplyAll).toHaveBeenCalledTimes(1);
    expect(onRetryJudge).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------------
  // 7. Edit-while-applying reset → applying → idle (user_written + judged) →
  //    the Apply-all button reappears; no partial/applying UI remains.
  // ------------------------------------------------------------------------
  it("clears the applying UI and restores Apply-all when applyState resets to idle", () => {
    const { rerender } = render(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: judgedVerdict },
          provenance: USER_WRITTEN,
          applyState: "applying",
        })}
      />,
      { container: (harness = mountShadowHost()).mount },
    );
    const root = harness.mount;

    // Mid-apply: the Improving indicator is up, Apply-all replaced.
    expect(root.textContent?.toLowerCase()).toContain("improving");
    expect(applyAllButton(root)).toBeUndefined();

    // The user edits → ComposeCockpit aborts → applyState resets to idle.
    rerender(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: judgedVerdict },
          provenance: USER_WRITTEN,
          applyState: "idle",
        })}
      />,
    );

    // The Apply-all affordance is back and no partial/applying UI lingers.
    expect(applyAllButton(root)).toBeDefined();
    expect(root.textContent?.toLowerCase()).not.toContain("improving");
  });

  // ------------------------------------------------------------------------
  // 8. Post Coach hints not suppressed by JudgeStrip (JudgeStrip-LOCAL sanity).
  //
  //    Post Coach lives in StaticEngineColumn — OUTSIDE JudgeStrip — so there is
  //    no cross-component assertion to make here without overreaching scope.
  //    The honest, JudgeStrip-local invariant: in the generated/approved state,
  //    JudgeStrip renders its OWN approved content without error AND exposes no
  //    "suppress" affordance/attribute that could hide a sibling column. We
  //    assert (a) the approved content renders, and (b) no element in the
  //    JudgeStrip subtree carries a suppression hook (data-suppress* / a
  //    [hidden] wrapper claiming to gate siblings).
  // ------------------------------------------------------------------------
  it("renders its own approved content and exposes no sibling-suppression hook in generated/approved", () => {
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: approvedVerdict },
          provenance: GENERATED,
          applyState: { status: "applied", improvedOverOriginal: true },
        })}
      />,
    );

    // (a) JudgeStrip renders its approved content without crashing.
    expect(root.textContent).toContain("✓ Judge approved");
    expect(scoreBars(root)).toHaveLength(13);

    // (b) No suppression affordance leaks out of JudgeStrip that would hide a
    //     sibling static column (Post Coach). JudgeStrip is self-scoped.
    expect(root.querySelector("[data-suppress-post-coach]")).toBeNull();
    expect(root.querySelector("[data-suppress]")).toBeNull();
  });

  // ------------------------------------------------------------------------
  // 9. Loop prevention — generated → Apply-all absent AND no rendered control
  //    in JudgeStrip can fire onApplyAll (no hidden trigger). Non-tautological:
  //    we click EVERY rendered button and assert onApplyAll is never invoked.
  // ------------------------------------------------------------------------
  it("exposes no control that can trigger onApplyAll in the generated state", () => {
    const onApplyAll = vi.fn();
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: approvedVerdict },
          provenance: GENERATED,
          applyState: "idle",
          onApplyAll,
        })}
      />,
    );

    // The named Apply-all button is gone…
    expect(applyAllButton(root)).toBeUndefined();

    // …and no OTHER rendered control is a hidden apply trigger: clicking every
    // button in the JudgeStrip subtree must never fire onApplyAll.
    for (const btn of buttons(root)) {
      btn.click();
    }
    expect(onApplyAll).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------------
  // Key edge A: Apply-all also absent when judge.status !== "judged" even if
  // user_written — the button requires a landed verdict to show.
  // ------------------------------------------------------------------------
  it("does not render Apply-all in user_written when the judge is still running (not judged)", () => {
    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "running" },
          provenance: USER_WRITTEN,
          applyState: "idle",
        })}
      />,
    );

    expect(applyAllButton(root)).toBeUndefined();
  });

  // ------------------------------------------------------------------------
  // Key edge B: applied-not-improved with a NOT-approved verdict → the
  // AlreadySolid banner shows, but "✓ Judge approved" does NOT (gated by
  // deriveApproved, independent of the apply outcome).
  // ------------------------------------------------------------------------
  it("shows AlreadySolid but withholds '✓ Judge approved' when the re-pinned verdict is not approved", () => {
    const rejected = makeJudgeVerdict({ scores: { overall: 30 } }); // do_not_post
    expect(deriveApproved(rejected)).toBe(false);

    const root = mount(
      <JudgeStrip
        {...props({
          judge: { status: "judged", verdict: rejected },
          provenance: GENERATED,
          applyState: { status: "applied", improvedOverOriginal: false },
        })}
      />,
    );

    // The info banner appears…
    const alreadySolid = Array.from(
      root.querySelectorAll<HTMLElement>('[role="alert"][data-variant="warning"]'),
    ).find((a) => /already solid/i.test(a.textContent ?? ""));
    expect(alreadySolid).toBeDefined();

    // …but the approval badge is withheld (verdict is not approved).
    expect(root.textContent).not.toContain("✓ Judge approved");
  });
});
