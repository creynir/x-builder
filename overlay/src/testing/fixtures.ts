// @x-builder/overlay — settings-affordance fixture builders (test-only)
//
// Lightweight factory functions for the data the settings affordance consumes.
// They produce the REAL shared shapes from `@x-builder/shared` (no re-derived
// Zod, no invented fields): the settings panel reads/writes the real
// `AppSettings`, the readiness indicator reads `OverlayReadiness`, the capture
// summary card reads `CaptureSummary`, and the active-context toggle reads
// `ActiveArchiveContext`. Active context is the archive-context activation — NOT
// a settings field — and judge readiness is surfaced via OverlayReadiness.llm.

import {
  deriveJudgeVerdict,
  type ActiveArchiveContext,
  type AppSettings,
  type CaptureSummary,
  type GetFeedbackLoopSummaryResponse,
  type JudgeVerdict,
  type OverlayReadiness,
  type ReadinessState,
  type SubsystemStatus,
} from "@x-builder/shared";

const ISO_NOW = "2026-06-21T00:00:00.000Z";

const COMPOSER_TESTID = "tweetTextarea_0";

/**
 * Build a REAL `div[data-testid="tweetTextarea_0"]` carrying a single Text node
 * of `text`, appended to a real container in `document.body`. This is the
 * inline `n(text, widthPx)` composer fixture promoted into a shared
 * ticket-owned helper so the highlight-layer suite and the provenance
 * suite read one composer shape. Browser mode lays it out for real, so
 * `el.textContent` and `range.getClientRects()` over its text are real; the
 * `widthPx` knob forces a narrow box when a test needs a long quote to wrap.
 *
 * Returns the bare element. Callers append/teardown via their own harness (the
 * provenance suite removes the parent container in `afterEach`); the element's
 * parent container carries `data-xb-fixture="composer"` for bulk teardown.
 */
export function buildComposerFixture(text: string, widthPx = 500): HTMLDivElement {
  const container = document.createElement("div");
  container.dataset.xbFixture = "composer";
  // Anchor the container so getBoundingClientRect returns a stable, non-zero box.
  container.style.position = "absolute";
  container.style.top = "100px";
  container.style.left = "50px";
  container.style.width = `${widthPx}px`;

  const el = document.createElement("div");
  el.dataset.testid = COMPOSER_TESTID;
  el.style.width = `${widthPx}px`;
  el.style.font = "16px/1.4 monospace";
  el.style.whiteSpace = "pre-wrap";
  el.style.wordBreak = "break-word";
  el.append(document.createTextNode(text));

  container.append(el);
  document.body.append(container);

  return el;
}

/**
 * Build a REAL `JudgeVerdict` (all thirteen score dimensions, headline,
 * strengths, improvements, annotations) — no Zod re-declaration. The `verdict`
 * LABEL is derived from `scores.overall` via shared's `deriveJudgeVerdict`
 * unless an explicit `verdict` override is supplied. This is load-bearing:
 * `deriveApproved` reads the LABEL, not the raw score, so the boundary the
 * approval ACs assert (overall 70 → true, 69 → false) only holds when the label
 * is consistent with `overall`. Tests that want to break that consistency pass
 * an explicit `verdict`.
 *
 * `overrides.scores` is merged over the default scores so a test can set only
 * `{ overall }` and keep the other twelve dimensions valid.
 */
export function makeJudgeVerdict(
  overrides: Partial<Omit<JudgeVerdict, "scores">> & {
    scores?: Partial<JudgeVerdict["scores"]>;
  } = {},
): JudgeVerdict {
  const { scores: scoreOverrides, verdict: verdictOverride, ...rest } = overrides;

  const scores: JudgeVerdict["scores"] = {
    overall: 80,
    replies: 80,
    profileClicks: 80,
    impressions: 80,
    bookmarkValue: 80,
    dwellProxy: 80,
    voiceMatch: 80,
    negativeRisk: 80,
    answerEffort: 80,
    strangerAnswerability: 80,
    statusDependency: 80,
    replyVsQuoteOrientation: 80,
    audienceMatch: null,
    ...scoreOverrides,
  };

  return {
    // Label-from-overall unless explicitly overridden, so deriveApproved agrees
    // with the asserted boundary. See doc comment above.
    verdict: verdictOverride ?? deriveJudgeVerdict(scores.overall),
    confidence: "medium",
    scores,
    headline: "Solid draft with room to tighten the hook.",
    strengths: ["Clear point of view"],
    improvements: ["Tighten the opening line"],
    annotations: [],
    ...rest,
  };
}

/**
 * Build a real `AppSettings` object (the full shared shape). Defaults to a valid
 * persisted-style configuration: a Codex judge, local engine URL, a storage
 * path, deterministic details on. Override any field per test. There is no
 * `judgeReady` or `activeContext` field — those are readiness / archive-context
 * concerns, not settings.
 */
export function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    engineBaseUrl: "http://127.0.0.1:4319",
    storagePath: "/home/user/.x-builder",
    judgeProvider: "codex-cli",
    showDeterministicDetails: true,
    ...overrides,
  };
}

/** Build a `SubsystemStatus` with the real defaults filled in. */
export function subsystem(
  overrides: Partial<SubsystemStatus> & { state: ReadinessState; label: string },
): SubsystemStatus {
  return {
    retryable: true,
    checkedAt: ISO_NOW,
    details: {},
    ...overrides,
  };
}

/** Build an `OverlayReadiness` object. Defaults to all-green / capture ok. */
export function makeOverlayReadiness(
  overrides: Partial<OverlayReadiness> = {},
): OverlayReadiness {
  return {
    staticEngine: subsystem({ state: "ready", label: "Static engine ready" }),
    llm: subsystem({ state: "ready", label: "Judge ready" }),
    capture: {
      state: "ok",
      label: "Capture ok",
      checkedAt: ISO_NOW,
    },
    ...overrides,
  };
}

/** Build a `CaptureSummary` object. Defaults to a populated summary. */
export function makeCaptureSummary(
  overrides: Partial<CaptureSummary> = {},
): CaptureSummary {
  return {
    postsCaptured: 42,
    lastCaptureAt: ISO_NOW,
    ...overrides,
  };
}

/**
 * Build an `ActiveArchiveContext` in the "active" status (toggle on). The
 * toggle's `checked` derives from `status === "active"`.
 */
export function makeActiveContext(
  overrides: Partial<Extract<ActiveArchiveContext, { status: "active" }>> = {},
): ActiveArchiveContext {
  return {
    status: "active",
    sourceImportId: "import-1",
    activatedAt: ISO_NOW,
    scoringContextPatch: {},
    judgeHints: [],
    provenance: "archive-import",
    confidence: "high",
    counts: { posts: 42, originals: 30, replies: 12 },
    ...overrides,
  };
}

/** The empty (deactivated) archive context — toggle off. */
export function makeEmptyContext(): ActiveArchiveContext {
  return { status: "empty" };
}


/** Build a real empty feedback-loop summary; callers can override totals/recent rows. */
export function makeFeedbackLoopSummary(
  overrides: Partial<GetFeedbackLoopSummaryResponse> = {},
): GetFeedbackLoopSummaryResponse {
  return {
    generatedAt: ISO_NOW,
    windowDays: 90,
    totals: {
      predictions: 0,
      linked: 0,
      pendingUnlinked: 0,
      ambiguous: 0,
      partialActuals: 0,
      actuals: 0,
    },
    formatLearnings: [],
    recent: [],
    ...overrides,
  };
}
