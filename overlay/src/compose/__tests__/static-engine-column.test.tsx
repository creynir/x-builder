// @x-builder/overlay — StaticEngineColumn tests (browser mode → Playwright Chromium)
//
// RED: `../static-engine-column` does not exist yet, so importing
// `StaticEngineColumn` is what drives the failing state. These tests pin the 8
// ticket cases against a PURELY PRESENTATIONAL component: it receives
// `analyzeState` + `followers` + `explainer` as props and renders. All compose
// detection / transport / debounce is OUT OF SCOPE here (owned by the ComposeCockpit).
//
// The `analyzeState` fixtures are schema-valid `Extract<AnalyzedPostItem,
// {status:"scored"}>` instances (proven by `analyze-state-fixtures.test.tsx`),
// so these tests exercise the EXACT shape the engine emits — object-form Post
// Coach check lists, `{low,high}` reach ranges, the warming cooldown, etc.
//
// Harness: the established overlay shadow-host harness (`mountShadowHost`) with
// the design-token + neon sheets adopted, rendered via `vitest-browser-react`
// into the real shadow tree — same pattern as `ui-v2.test.tsx`,
// `compose-generate-rail.test.tsx`, and the settings suites. We assert what is
// stable in browser mode (skeleton markers, aria-busy, variant markers, text,
// computed-style absence of judge tokens), not brittle pixel values.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { overlayExplainerCopy } from "../../explainer/copy";
import { mountShadowHost, type ShadowHostHandle } from "../../testing/shadow-host";
import {
  failedState,
  idleState,
  missingFollowersState,
  readyResult,
  readyState,
  scoringState,
} from "../../testing/analyze-state";

// Not-yet-existing module — importing it is what drives the RED state.
import { StaticEngineColumn } from "../static-engine-column";

let harness: ShadowHostHandle;

function mount(ui: Parameters<typeof render>[0]): HTMLElement {
  harness = mountShadowHost();
  render(ui, { container: harness.mount });
  return harness.mount;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

const FOLLOWERS = 2400;

// --------------------------------------------------------------------------
// Shadow-aware query helpers.
// --------------------------------------------------------------------------

function skeletons(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-skeleton]"));
}

function buttons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
}

function byVariant(root: ParentNode, variant: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-variant="${variant}"]`));
}

// --------------------------------------------------------------------------
// 1. Idle → skeleton slots; no metric values visible.
// --------------------------------------------------------------------------

describe("StaticEngineColumn — idle", () => {
  it("renders skeleton slots and shows no metric values", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={idleState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    // N loading bars stand in for the not-yet-scored metrics.
    expect(skeletons(root).length).toBeGreaterThan(0);
    // No score value is visible while idle.
    expect(root.textContent).not.toContain(String(readyResult.score.value));
    // No progressbar carries a real value yet.
    expect(root.querySelector('[role="progressbar"][aria-valuenow="72"]')).toBeNull();
  });
});

// --------------------------------------------------------------------------
// 2. Scoring → skeleton slots; aria-busy on the metric region.
// --------------------------------------------------------------------------

describe("StaticEngineColumn — scoring", () => {
  it("renders skeleton slots and marks the metric region aria-busy", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={scoringState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    expect(skeletons(root).length).toBeGreaterThan(0);
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    // Still no real score value.
    expect(root.textContent).not.toContain(String(readyResult.score.value));
  });
});

// --------------------------------------------------------------------------
// 3. Ready → fills: ScoreBar value, Post Coach items, reach prediction.
// --------------------------------------------------------------------------

describe("StaticEngineColumn — ready", () => {
  it("fills a ScoreBar with result.score.value and renders the progressbar value", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={readyState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    // The headline static metric is score.value (72).
    const headline = root.querySelector(
      `[role="progressbar"][aria-valuenow="${readyResult.score.value}"]`,
    );
    expect(headline).not.toBeNull();
    expect(root.textContent).toContain(String(readyResult.score.value));
    // Once ready, the metric region is no longer waiting.
    expect(skeletons(root)).toHaveLength(0);
  });

  it("renders the Post Coach failed / warned / passed check labels", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={readyState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    if (readyResult.postCoach.state !== "ready") {
      throw new Error("readyResult.postCoach must be the ready variant.");
    }
    const coach = readyResult.postCoach;
    // One label from each list must surface (object-form VoiceCheck labels).
    expect(root.textContent).toContain(coach.failed[0]!.label);
    expect(root.textContent).toContain(coach.warned[0]!.label);
    expect(root.textContent).toContain(coach.passed[0]!.label);
  });

  it("renders the compact reach prediction chip without the full regime rows", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={readyState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    if (readyResult.prediction.status !== "available") {
      throw new Error("readyResult.prediction must be available.");
    }
    const prediction = readyResult.prediction;
    const text = root.textContent ?? "";
    const summary = `${prediction.stallRange.low}–${prediction.stallRange.high} typical · ${Math.round(
      prediction.escapeProbability * 100,
    )}% escape`;

    expect(text).toContain(summary);
    expect(text).not.toContain("Stall range");
    expect(text).not.toContain("Escape range");
    expect(text).not.toContain("Escape probability");
    expect(text).not.toContain(String(prediction.escapeRange.high));
  });

  it("surfaces reply thread context diagnostics when parent/root context is missing", () => {
    const diagnosticState = {
      status: "ready" as const,
      result: {
        ...readyResult,
        replyThreadContextDiagnostics: {
          status: "same_dialog_only" as const,
          missing: [
            { field: "immediate_parent" as const, reason: "not_observed" as const },
            { field: "root" as const, reason: "not_observed" as const },
          ],
          uiMessages: ["Only the same-dialog target post is available."],
          promptMessages: ["No observed parent/root thread context was available."],
        },
      },
    };

    const root = mount(
      <StaticEngineColumn
        analyzeState={diagnosticState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    expect(byVariant(root, "warning").length).toBeGreaterThan(0);
    expect(root.textContent).toContain("Reply context incomplete");
    expect(root.textContent).toContain("Only the same-dialog target post is available.");
  });
});

// --------------------------------------------------------------------------
// 4. Missing followers → disabled reach block; no input field.
// --------------------------------------------------------------------------

describe("StaticEngineColumn — missing followers", () => {
  it("shows the disabled / missing-followers reach message and renders no input field", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={missingFollowersState}
        // followers intentionally omitted — the disabled prediction path.
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    if (missingFollowersState.status !== "ready") {
      throw new Error("missingFollowersState must be a ready state.");
    }
    const { prediction } = missingFollowersState.result;
    if (prediction.status !== "disabled") {
      throw new Error("Expected a disabled prediction.");
    }
    // The disabled message is surfaced verbatim.
    expect(root.textContent).toContain(prediction.message);
    // No manual follower input field is rendered (no prompt; auto-supply only).
    expect(root.querySelector("input")).toBeNull();
  });
});

// --------------------------------------------------------------------------
// 5. Cooldown → a warning Badge for the warming cooldown.
// --------------------------------------------------------------------------

describe("StaticEngineColumn — cooldown", () => {
  it("renders a warning Badge for a warming cooldown signal", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={readyState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    // The warming cooldown surfaces as a warning-variant Badge.
    expect(byVariant(root, "warning").length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// 6. Failed → danger Alert + retry Button; click calls onRetryStatic once.
// --------------------------------------------------------------------------

describe("StaticEngineColumn — failed", () => {
  it("renders a danger Alert with a retry Button that calls onRetryStatic once", () => {
    const onRetryStatic = vi.fn();
    const root = mount(
      <StaticEngineColumn
        analyzeState={failedState}
        followers={FOLLOWERS}
        onRetryStatic={onRetryStatic}
        explainer={overlayExplainerCopy}
      />,
    );

    // A danger Alert (assertive live region) is shown.
    const alert = root.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(
      alert!.getAttribute("data-variant") ?? alert!.getAttribute("class") ?? "",
    ).toContain("danger");

    // A retry button exists; clicking it calls onRetryStatic exactly once.
    const retry = buttons(root).find((b) => /retry|try again/i.test(b.textContent ?? ""));
    expect(retry).toBeDefined();
    retry!.click();
    expect(onRetryStatic).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// 7. Channel caption — "◆ Static engine" present in DOM (any state).
// --------------------------------------------------------------------------

describe("StaticEngineColumn — channel caption", () => {
  it("renders the '◆ Static engine' caption", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={readyState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    expect(root.textContent).toContain("◆ Static engine");
  });

  it("renders the caption even in the failed state (caption is state-independent)", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={failedState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    expect(root.textContent).toContain("◆ Static engine");
  });
});

// --------------------------------------------------------------------------
// 8. Neutral styling — no --xb-judge token usage; no primary-CTA button.
// --------------------------------------------------------------------------

describe("StaticEngineColumn — neutral styling", () => {
  it("uses no --xb-judge token anywhere in the rendered markup", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={readyState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    // The static side of the cockpit must be visually quieter than the judge
    // side: no judge token is referenced in any element's inline style.
    expect(root.innerHTML).not.toContain("--xb-judge");
  });

  it("renders no primary-CTA button (the static column is quiet, no accent CTA)", () => {
    const root = mount(
      <StaticEngineColumn
        analyzeState={failedState}
        followers={FOLLOWERS}
        onRetryStatic={vi.fn()}
        explainer={overlayExplainerCopy}
      />,
    );

    // The v2 primary Button paints --interactive-default; no rendered button may
    // carry the X primary CTA fill (#1d9bf0 / rgb(29,155,240)) and the retry
    // button is the secondary variant. Assert no button resolves to that hue.
    for (const btn of buttons(root)) {
      expect(getComputedStyle(btn).backgroundColor).not.toBe("rgb(29, 155, 240)");
    }
  });
});
