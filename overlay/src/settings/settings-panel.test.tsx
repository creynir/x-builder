// @x-builder/overlay — SettingsPanel tests (browser mode)
//
// Covers the CaptureSummary→KeyValueList rendering and the Visual-AC structural
// contract: the panel surface is built from the Aurora Glass tokens
// (--xb-surface-panel / --xb-glass-blur / --xb-border-edge / --radius-lg) and
// the readiness Badge variant mapping (ready→success, partial→warning,
// unavailable/failed→danger). Rendered into a real token-seeded shadow root so
// the var() references actually resolve.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import {
  makeAppSettings,
  makeCaptureSummary,
  makeExternalXSignalPattern,
  makeExternalXSignalSource,
  makeExternalXSignalsOverview,
  makeFeedbackLoopSummary,
  makeOverlayReadiness,
  subsystem,
} from "../testing/fixtures";
import { mountShadowHost, tokenValue, type ShadowHostHandle } from "../testing/shadow-host";
import { SettingsPanel } from "./settings-panel";

let harness: ShadowHostHandle;

function mountPanel(
  overrides: Partial<Parameters<typeof SettingsPanel>[0]> = {},
  xtheme?: string,
): HTMLElement {
  harness = mountShadowHost(xtheme ? { xtheme } : {});
  render(
    <SettingsPanel
      open
      onClose={vi.fn()}
      settings={makeAppSettings()}
      readiness={makeOverlayReadiness()}
      capture={makeCaptureSummary()}
      feedback={makeFeedbackLoopSummary()}
      externalXSignals={makeExternalXSignalsOverview()}
      externalXSignalsAction="idle"
      onUpdateSettings={vi.fn()}
      onUploadArchive={vi.fn()}
      onRefreshFeedback={vi.fn()}
      onLinkFeedback={vi.fn()}
      onAddExternalXSignalSource={vi.fn()}
      onRefreshExternalXSignalSource={vi.fn()}
      onRemoveExternalXSignalSource={vi.fn()}
      onRefreshExternalXSignals={vi.fn()}
      {...overrides}
    />,
    { container: harness.mount },
  );
  return harness.mount;
}

function panel(root: HTMLElement): HTMLElement {
  const el = root.querySelector('[role="dialog"]');
  if (!(el instanceof HTMLElement)) throw new Error("dialog not found");
  return el;
}

function sectionByHeading(root: HTMLElement, title: string): HTMLElement {
  const heading = Array.from(root.querySelectorAll("h3")).find(
    (candidate) => candidate.textContent === title,
  );
  const section = heading?.closest("section");
  if (!(section instanceof HTMLElement)) {
    throw new Error(`section not found: ${title}`);
  }
  return section;
}

afterEach(() => {
  cleanup();
  harness?.cleanup();
});

describe("SettingsPanel — dialog semantics", () => {
  it("renders role=dialog, aria-modal, and an accessible label", () => {
    const dialog = panel(mountPanel());
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("X Builder settings");
  });
});

describe("SettingsPanel — CaptureSummary in KeyValueList", () => {
  it("renders postsCaptured and lastCaptureAt values", () => {
    const root = mountPanel({
      capture: makeCaptureSummary({ postsCaptured: 42, lastCaptureAt: "2026-06-21" }),
    });
    expect(root.textContent).toContain("42");
    expect(root.textContent).toContain("2026-06-21");
  });
});

describe("SettingsPanel — Visual AC token structure", () => {
  it("resolves the Aurora Glass panel surface tokens on the dialog", () => {
    const dialog = panel(mountPanel());

    // The panel's var() references must resolve against the seeded :host tokens.
    expect(tokenValue(dialog, "--xb-surface-panel")).toBe("hsl(210 24% 14% / 0.96)");
    expect(tokenValue(dialog, "--xb-glass-blur")).toBe("12px");
    expect(tokenValue(dialog, "--xb-border-edge")).toBe("hsl(174 90% 52% / 0.55)");

    // The panel's resolved styles consume those tokens (not a bare/blank box).
    const style = getComputedStyle(dialog);
    expect(style.borderRadius).not.toBe("");
    expect(style.borderRadius).not.toBe("0px");
  });

  it("applies the white (default) theme override to the panel surface", () => {
    const dialog = panel(mountPanel({}, "default"));
    // The default-theme block keeps the dark glass panel and light text.
    expect(tokenValue(dialog, "--xb-surface-panel")).toBe("hsl(210 24% 14% / 0.96)");
    expect(tokenValue(dialog, "--xb-text")).toBe("hsl(180 25% 96%)");
  });
});

describe("SettingsPanel — readiness Badge variant mapping (Visual AC)", () => {
  function markers(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll("[data-variant]")).map(
      (el) => el.getAttribute("data-variant") ?? "",
    );
  }

  it("maps ready → success", () => {
    const root = mountPanel({ readiness: makeOverlayReadiness() });
    expect(markers(root)).toContain("success");
  });

  it("maps partial → warning and unavailable → danger", () => {
    const root = mountPanel({
      readiness: makeOverlayReadiness({
        staticEngine: subsystem({ state: "partial", label: "Static engine partial" }),
        llm: subsystem({ state: "unavailable", label: "Judge unavailable" }),
      }),
    });
    const m = markers(root);
    expect(m).toContain("warning");
    expect(m).toContain("danger");
  });
});


describe("SettingsPanel — External X signals section", () => {
  it("renders a loading skeleton between Feedback loop and X archive", () => {
    const root = mountPanel({ externalXSignals: "loading" });
    const headings = Array.from(root.querySelectorAll("h3")).map(
      (heading) => heading.textContent ?? "",
    );

    expect(headings.indexOf("External X signals")).toBeGreaterThan(
      headings.indexOf("Feedback loop"),
    );
    expect(headings.indexOf("External X signals")).toBeLessThan(
      headings.indexOf("X archive"),
    );
    expect(
      sectionByHeading(root, "External X signals").querySelector("[data-skeleton]"),
    ).not.toBeNull();
  });

  it("renders the empty state without describing external signals as captured posts", () => {
    const section = sectionByHeading(mountPanel(), "External X signals");

    expect(section.textContent).toContain("No external sources");
    expect(section.textContent).toContain("Add an X handle");
    expect(section.textContent).not.toContain("Captured posts");
  });

  it("renders populated sources, pattern badges, counts, and wrapped evidence previews", () => {
    const longEvidenceText = [
      "This external example keeps a long evidence preview readable",
      "while preserving enough post text for the pattern proof in the settings panel.",
      "It should wrap rather than widen the anchored overlay panel.",
    ].join(" ");
    const source = makeExternalXSignalSource({
      screenName: "very_long_external_builder_handle",
      displayName: "Long Evidence Builder",
      status: "waiting_for_observation",
      evidenceCount: 4,
      patternCount: 1,
      lastObservedAt: undefined,
    });
    const pattern = makeExternalXSignalPattern({
      patternType: "hook",
      label: "Proof led hook",
      statement: "External examples open with a concrete proof point before the claim.",
      confidence: 0.62,
      supportCount: 4,
      sourceIds: [source.id],
      evidenceIds: ["external-evidence-long"],
      evidence: [
        {
          evidenceId: "external-evidence-long",
          sourceId: source.id,
          screenName: source.screenName,
          platformPostId: "1800000000000000999",
          text: longEvidenceText,
          metrics: { likes: 44, reposts: 5 },
        },
      ],
    });
    const section = sectionByHeading(
      mountPanel({
        externalXSignals: makeExternalXSignalsOverview({ sources: [source], patterns: [pattern] }),
      }),
      "External X signals",
    );

    expect(section.textContent).toContain("@very_long_external_builder_handle");
    expect(section.textContent).toContain("Evidence-backed patterns");
    expect(section.textContent).toContain("Proof led hook");
    expect(section.textContent).toContain("4");
    expect(section.querySelectorAll("[data-external-x-pattern-row]")).toHaveLength(1);
    expect(
      Array.from(section.querySelectorAll("[data-variant]")).map((el) =>
        el.getAttribute("data-variant"),
      ),
    ).toEqual(expect.arrayContaining(["warning", "info"]));

    const evidencePreview = Array.from(section.querySelectorAll("p")).find((candidate) =>
      candidate.textContent?.includes(longEvidenceText),
    );
    expect(evidencePreview).not.toBeUndefined();
    expect(getComputedStyle(evidencePreview!).overflowWrap).toBe("anywhere");
  });
});
