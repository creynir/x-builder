import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  AnalyzedPostItem,
  EngagementPrediction,
  PostCoachViewModel,
} from "@x-builder/shared";

const deterministicComponentsModulePath = "../deterministic/components";
const learningCaveat = "Static rule check. Imported performance data is not connected yet.";

type ScoredAnalyzedPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;
type ScoreFailedAnalyzedPostItem = Extract<
  AnalyzedPostItem,
  { status: "score_failed" }
>;
type ReadyPostCoachViewModel = Extract<PostCoachViewModel, { state: "ready" }>;
type AvailableEngagementPrediction = Extract<
  EngagementPrediction,
  { status: "available" }
>;
type DisabledEngagementPrediction = Extract<
  EngagementPrediction,
  { status: "disabled" }
>;

type CandidateDeterministicSummaryProps = {
  item: AnalyzedPostItem;
  onAddFollowers?: () => void;
  onRetryScore: (itemId: string) => void;
};

type ManualScoringContextPanelProps = {
  context: {
    followers?: number;
    source: "manual" | "missing";
    skipped: boolean;
  };
  disabled?: boolean;
  focusTarget?: string;
};

type DeterministicDetailInspectorProps =
  | {
      state: "empty";
      message: string;
    }
  | {
      state: "loading";
      label: string;
    }
  | {
      state: "error";
      message: string;
    }
  | {
      state: "ready";
      item: ScoredAnalyzedPostItem;
      onAddFollowers?: () => void;
      onRetryExpandedPostCoach?: () => void;
    };

type DeterministicComponentsModule = {
  CandidateDeterministicSummary: (
    props: CandidateDeterministicSummaryProps,
  ) => ReactElement;
  DraftEvaluationEmptyState: (props: {
    hasDraft: boolean;
    hasFollowers: boolean;
    onAddFollowers?: () => void;
  }) => ReactElement;
  DeterministicDetailInspector: (
    props: DeterministicDetailInspectorProps,
  ) => ReactElement;
  EngagementPredictionCard: (props: {
    onAddFollowers?: () => void;
    prediction: EngagementPrediction;
  }) => ReactElement;
  ManualScoringContextPanel: (
    props: ManualScoringContextPanelProps,
  ) => ReactElement;
  PostCoachCard: (props: {
    density?: "compact" | "full";
    postCoach: PostCoachViewModel;
  }) => ReactElement;
};

async function loadDeterministicComponents() {
  return (await import(
    deterministicComponentsModulePath
  )) as DeterministicComponentsModule;
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function render(element: ReactElement) {
  return renderToStaticMarkup(element);
}

function readyPostCoach(
  overrides: Partial<ReadyPostCoachViewModel> = {},
): ReadyPostCoachViewModel {
  const worthALook = {
    id: "specificity",
    label: "Needs a concrete detail",
    status: "fail" as const,
  };
  const nudge = {
    id: "ending_question",
    label: "Question could be sharper",
    status: "warn" as const,
  };
  const onPoint = {
    id: "plain_language",
    label: "Plain language",
    status: "pass" as const,
  };

  return {
    state: "ready",
    title: "Post Coach",
    value: 73,
    badge: {
      label: "Ship it",
      tone: "ship",
      tooltip: "Solid post. Ship it; higher scores are a bonus.",
    },
    target: 60,
    engageability: {
      engageable: true,
      reason: "Ends with a concrete question.",
    },
    failed: [worthALook],
    warned: [nudge],
    passed: [onPoint],
    counts: {
      flagged: 9,
      nudges: 7,
      onPoint: 5,
    },
    expanded: false,
    previewMode: true,
    sections: [
      {
        title: "Worth a look",
        items: [worthALook],
      },
      {
        title: "Nudges",
        items: [nudge],
      },
      {
        title: "On point",
        items: [onPoint],
      },
    ],
    learnings: [
      {
        text: "Static rule evidence: concrete examples make posts easier to evaluate.",
        relevance: "general",
      },
    ],
    learningCaveat,
    hiddenChecks: 4,
    helperText: "Signals, not verdicts.",
    footerText: "Static heuristic checks only.",
    ...overrides,
  };
}

function availablePrediction(
  overrides: Partial<AvailableEngagementPrediction> = {},
): AvailableEngagementPrediction {
  // End-state four-regime contract: no legacy mirror fields. The card renders
  // these directly through ReachRegimeBlock.
  return {
    status: "available",
    signals: [
      {
        signal_key: "voice_score",
        label: "Static score 73",
        multiplier: 0.85,
      },
      {
        signal_key: "question_ending",
        label: "Question ending",
        multiplier: 1.15,
      },
    ],
    predictedMidImpressions: 1500,
    stallRange: { low: 800, high: 2400 },
    escapeRange: { low: 6000, high: 40000 },
    escapeProbability: 0.12,
    expectedReplies: 9,
    baseImpressions: 1500,
    baseSource: "follower_estimate",
    qualityBasis: "static",
    reachModelVersion: "reach-v1",
    ...overrides,
  };
}

function missingFollowersPrediction(
  overrides: Partial<DisabledEngagementPrediction> = {},
): DisabledEngagementPrediction {
  return {
    status: "disabled",
    reason: "missing_followers",
    message: "Prediction needs follower count.",
    ...overrides,
  };
}

function scoredItem(
  overrides: Partial<ScoredAnalyzedPostItem> = {},
): ScoredAnalyzedPostItem {
  return {
    status: "scored",
    id: "candidate-1",
    text: "genuine question: what made your onboarding finally click?",
    sourceFormat: "debate-question",
    detectedFormat: "genuine_question",
    score: {
      value: 73,
      checks: [
        {
          id: "plain_language",
          label: "Plain language",
          status: "pass",
        },
      ],
      learnings: [
        {
          text: "Static rule evidence: concrete examples make posts easier to evaluate.",
          relevance: "general",
        },
      ],
      engageability: {
        engageable: true,
        reason: "Ends with a concrete question.",
      },
    },
    postCoach: readyPostCoach(),
    prediction: availablePrediction(),
    heuristicLabel: "Heuristic rank, not prediction.",
    analyzedAt: "2026-06-07T12:00:00.000Z",
    analyzerVersion: "deterministic-v1",
    ...overrides,
  };
}

function scoreFailedItem(
  overrides: Partial<ScoreFailedAnalyzedPostItem> = {},
): ScoreFailedAnalyzedPostItem {
  return {
    status: "score_failed",
    id: "candidate-2",
    text: "Hot take: unclear drafts are usually missing one concrete tradeoff.",
    sourceFormat: "mini-framework",
    reason: "analysis_failed",
    message: "Deterministic analysis failed for this candidate.",
    retryable: true,
    ...overrides,
  };
}

describe("CandidateDeterministicSummary", () => {
  it("renders scored API items with compact score, checks, and available prediction state", async () => {
    const { CandidateDeterministicSummary } = await loadDeterministicComponents();

    const html = render(
      <CandidateDeterministicSummary item={scoredItem()} onRetryScore={vi.fn()} />,
    );
    const text = textContent(html);

    expect(text).toContain("genuine question: what made your onboarding finally click?");
    expect(text).not.toContain("Source format");
    expect(text).not.toContain("Detected format");
    expect(text).toContain("73");
    expect(text).toContain("Heuristic rank, not prediction.");
    expect(text).toContain("Ship it");
    expect(text).toContain("9 flagged");
    expect(text).toContain("7 nudges");
    expect(text).toContain("5 on point");
    expect(text).toContain("Needs a concrete detail");
    expect(text).toContain("Question could be sharper");
    // New four-regime chip: typical range + escape likelihood, replacing the
    // deleted "<rangeLow> - <rangeHigh> impressions, <confidence>" string.
    expect(text).toContain("800–2,400 typical");
    expect(text).toContain("12% escape");
    expect(text).not.toContain("impressions, medium");
    expect(text).not.toContain("120 - 280");
  });

  it("renders missing source format gracefully in the compact summary", async () => {
    const { CandidateDeterministicSummary } = await loadDeterministicComponents();

    const item = scoredItem({
      text: "manual draft: what changed after you stopped optimizing for demos?",
      detectedFormat: "genuine_question",
    });
    delete item.sourceFormat;
    const html = render(
      <CandidateDeterministicSummary item={item} onRetryScore={vi.fn()} />,
    );
    const text = textContent(html);

    expect(text).toContain(
      "manual draft: what changed after you stopped optimizing for demos?",
    );
    expect(text).not.toContain("Source format");
    expect(text).not.toContain("Detected format");
    expect(text).toContain("Static score");
  });

  it("renders disabled prediction state from the item without inventing a range", async () => {
    const { CandidateDeterministicSummary } = await loadDeterministicComponents();

    const html = render(
      <CandidateDeterministicSummary
        item={scoredItem({ prediction: missingFollowersPrediction() })}
        onRetryScore={vi.fn()}
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Prediction needs follower count.");
    expect(text).not.toContain("120");
    expect(text).not.toContain("280");
  });

  it("preserves score failure item text and exposes a retry score action", async () => {
    const { CandidateDeterministicSummary } = await loadDeterministicComponents();

    const html = render(
      <CandidateDeterministicSummary
        item={scoreFailedItem()}
        onRetryScore={vi.fn()}
      />,
    );
    const text = textContent(html);

    expect(text).toContain(
      "Hot take: unclear drafts are usually missing one concrete tradeoff.",
    );
    expect(text).toContain("Deterministic analysis failed for this candidate.");
    expect(text).toContain("Retry score");
  });
});

describe("PostCoachCard", () => {
  it("renders badge, provided counts, sections, and learning caveat from the view model", async () => {
    const { PostCoachCard } = await loadDeterministicComponents();
    const postCoach = readyPostCoach({
      value: 18,
      badge: {
        label: "Top tier",
        tone: "top",
        tooltip: "Server-selected badge copy that does not match the raw score.",
      },
      counts: {
        flagged: 9,
        nudges: 7,
        onPoint: 5,
      },
      failed: [
        {
          id: "derived-fail",
          label: "Derived failed check should not render",
          status: "fail",
        },
      ],
      warned: [
        {
          id: "derived-warning",
          label: "Derived warning check should not render",
          status: "warn",
        },
      ],
      passed: [
        {
          id: "derived-pass",
          label: "Derived passing check should not render",
          status: "pass",
        },
      ],
      sections: [
        {
          title: "Worth a look",
          items: [
            {
              id: "api-section-worth",
              label: "API section says the hook is specific",
              status: "pass",
            },
          ],
        },
        {
          title: "Nudges",
          items: [
            {
              id: "api-section-nudge",
              label: "API section asks for a tighter final question",
              status: "warn",
            },
          ],
        },
        {
          title: "On point",
          items: [
            {
              id: "api-section-on-point",
              label: "API section praises the plain-language framing",
              status: "fail",
            },
          ],
        },
      ],
    });

    const html = render(<PostCoachCard postCoach={postCoach} />);
    const text = textContent(html);

    expect(text).toContain("Draft Review");
    expect(text).toContain("Top tier");
    expect(text).toContain("Server-selected badge copy that does not match the raw score.");
    expect(text).not.toContain("Rework");
    expect(text).not.toContain("Ship it");
    expect(text).toContain("9");
    expect(text).toContain("7");
    expect(text).toContain("5");
    expect(text).toContain("Worth a look");
    expect(text).toContain("API section says the hook is specific");
    expect(text).toContain("Nudges");
    expect(text).toContain("API section asks for a tighter final question");
    expect(text).toContain("On point");
    expect(text).toContain("API section praises the plain-language framing");
    expect(text).not.toContain("Derived failed check should not render");
    expect(text).not.toContain("Derived warning check should not render");
    expect(text).not.toContain("Derived passing check should not render");
    expect(text).toContain(learningCaveat);
    expect(text).not.toContain("real user performance");
  });

  it("renders compact check groups so On point counts can be inspected", async () => {
    const { PostCoachCard } = await loadDeterministicComponents();
    const postCoach = readyPostCoach({
      failed: [
        {
          id: "fail-one",
          label: "Opening needs a concrete hook",
          status: "fail",
        },
      ],
      warned: [
        {
          id: "warn-one",
          label: "Ending question can be sharper",
          status: "warn",
        },
      ],
      passed: [
        {
          id: "pass-one",
          label: "Specific reader payoff is clear",
          status: "pass",
        },
        {
          id: "pass-two",
          label: "Plain language keeps the post scannable",
          status: "pass",
        },
      ],
      counts: {
        flagged: 1,
        nudges: 1,
        onPoint: 2,
      },
    });

    const html = render(<PostCoachCard density="compact" postCoach={postCoach} />);
    const text = textContent(html);

    expect(text).toContain("Flagged 1");
    expect(text).toContain("Nudges 1");
    expect(text).toContain("On point 2");
    expect(text).toContain("Specific reader payoff is clear");
    expect(text).toContain("Plain language keeps the post scannable");
    expect(text).not.toContain(postCoach.footerText);
    expect(html).toMatch(/<details\b[^>]*open=""/);
    expect(html).toMatch(/<summary><span>Flagged<\/span><span>1<\/span><\/summary>/);
    expect(html).toMatch(/<summary><span>Nudges<\/span><span>1<\/span><\/summary>/);
    expect(html).toMatch(/<details\b(?![^>]*open)[^>]*><summary><span>On point<\/span><span>2<\/span><\/summary>/);
  });
});

describe("EngagementPredictionCard", () => {
  it("renders the four-regime block: expected reach, escape likelihood, typical and breakout ranges, replies, and signals", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard prediction={availablePrediction()} />,
    );
    const text = textContent(html);

    // Regime labels and values from the four-regime contract.
    expect(text).toContain("Expected reach");
    expect(text).toContain("1500");
    expect(text).toContain("Escape likelihood");
    expect(text).toContain("12% escape");
    expect(text).toContain("Typical reach");
    expect(text).toContain("800 – 2,400");
    expect(text).toContain("If it breaks out");
    expect(text).toContain("6,000 – 40,000");
    expect(text).toContain("Expected replies");
    expect(text).toContain("9");
    // The kept signals list still renders.
    expect(text).toContain("Static score 73");
    expect(text).toContain("0.85");
    expect(text).toContain("Question ending");
    expect(text).toContain("1.15");
    // No legacy Range / Midpoint / Confidence rows survive.
    expect(text).not.toContain("Midpoint");
    expect(text).not.toContain("Confidence");
    expect(text).not.toContain("120 - 280");
  });

  it("renders the escape likelihood as a text-labelled info badge, not a color-only chip", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard prediction={availablePrediction()} />,
    );

    // The escape percentage carries a text label inside an info-variant badge.
    const escapeBadge = html.match(
      /<span class="xb-badge xb-badge--info[^"]*"[^>]*>([^<]*)<\/span>/,
    );
    expect(escapeBadge).not.toBeNull();
    expect(escapeBadge?.[1]).toContain("12% escape");
  });

  it("omits the judge-refinement badge when the quality basis is static", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard prediction={availablePrediction({ qualityBasis: "static" })} />,
    );

    expect(textContent(html)).not.toContain("Refined with judge signal");
  });

  it("shows the judge-refinement accent badge when the quality basis is judge", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard prediction={availablePrediction({ qualityBasis: "judge" })} />,
    );
    const text = textContent(html);

    expect(text).toContain("Refined with judge signal");
    expect(html).toMatch(
      /<span class="xb-badge xb-badge--accent[^"]*"[^>]*>[^<]*Refined with judge signal[^<]*<\/span>/,
    );
    // Regime values still render normally alongside the judge badge.
    expect(text).toContain("Expected reach");
    expect(text).toContain("1500");
    expect(text).toContain("12% escape");
  });

  it("keeps regime sub-labels as definition terms, not headings, so no level is skipped under the card h3", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard prediction={availablePrediction()} />,
    );

    // The card title is the only heading; regime sub-labels must not introduce
    // h4/h5 headings under it.
    expect(html).toContain("<h3");
    expect(html).not.toMatch(/<h4\b/);
    expect(html).not.toMatch(/<h5\b/);
    // Regime rows are described with <dt>/<p>, not heading elements.
    expect(html).toMatch(/<dt\b/);
  });

  it("renders no number-transition animation hooks on the regime values", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard prediction={availablePrediction()} />,
    );

    expect(html).not.toContain("animate");
    expect(html).not.toContain("transition");
    expect(html).not.toContain("count-up");
  });

  it("renders identical card markup height across quality basis values so the layout does not shift", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const staticHtml = render(
      <EngagementPredictionCard prediction={availablePrediction({ qualityBasis: "static" })} />,
    );
    const judgeHtml = render(
      <EngagementPredictionCard prediction={availablePrediction({ qualityBasis: "judge" })} />,
    );

    // The judge badge is additive copy, but the regime block structure (and thus
    // its row count) must be identical across quality basis, so the card never
    // reflows when a draft is refined. Count the regime rows in each render.
    const staticRows = (staticHtml.match(/<dt\b/g) ?? []).length;
    const judgeRows = (judgeHtml.match(/<dt\b/g) ?? []).length;
    expect(staticRows).toBeGreaterThan(0);
    expect(judgeRows).toBe(staticRows);
  });

  it("renders boundary escape probabilities of 0% and 100% with a text label", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const neverEscapes = render(
      <EngagementPredictionCard prediction={availablePrediction({ escapeProbability: 0 })} />,
    );
    const alwaysEscapes = render(
      <EngagementPredictionCard prediction={availablePrediction({ escapeProbability: 1 })} />,
    );

    expect(textContent(neverEscapes)).toContain("0% escape");
    expect(textContent(alwaysEscapes)).toContain("100% escape");
  });

  it("renders equal-low-high stall and escape ranges without collapsing the regime rows", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard
        prediction={availablePrediction({
          stallRange: { low: 1200, high: 1200 },
          escapeRange: { low: 5000, high: 5000 },
        })}
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Typical reach");
    expect(text).toContain("1,200 – 1,200");
    expect(text).toContain("If it breaks out");
    expect(text).toContain("5,000 – 5,000");
  });

  it("renders missing followers as disabled context without a fake range", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard prediction={missingFollowersPrediction()} />,
    );
    const text = textContent(html);

    expect(text).toContain("Prediction needs follower count.");
    expect(text).not.toContain("missing_followers");
    expect(text).not.toContain("120");
    expect(text).not.toContain("280");
  });

  it("offers follower recovery when the missing-followers handler is provided", async () => {
    const { EngagementPredictionCard } = await loadDeterministicComponents();

    const html = render(
      <EngagementPredictionCard
        onAddFollowers={vi.fn()}
        prediction={missingFollowersPrediction()}
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Prediction needs follower count.");
    expect(text).toContain("Add followers");
  });
});

describe("DraftEvaluationEmptyState", () => {
  it("shows both empty result cards and asks for missing draft plus followers", async () => {
    const { DraftEvaluationEmptyState } = await loadDeterministicComponents();

    const html = render(
      <DraftEvaluationEmptyState
        hasDraft={false}
        hasFollowers={false}
        onAddFollowers={vi.fn()}
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Engagement Prediction");
    expect(text).toContain("Prediction unavailable");
    expect(text).toContain("Paste a draft and add followers to estimate impressions.");
    expect(text).toContain("Missing");
    expect(text).toContain("Draft text, Followers");
    expect(text).toContain("Add followers");
    expect(text).toContain("Draft Review");
    expect(text).toContain("Paste a draft to see static review checks.");
  });

  it("keeps the prediction empty state focused on followers when draft text exists", async () => {
    const { DraftEvaluationEmptyState } = await loadDeterministicComponents();

    const html = render(
      <DraftEvaluationEmptyState
        hasDraft
        hasFollowers={false}
        onAddFollowers={vi.fn()}
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Add followers to estimate impressions.");
    expect(text).toContain("Missing Followers");
    expect(text).not.toContain("Draft text, Followers");
  });
});

describe("ManualScoringContextPanel", () => {
  it("renders manual follower input and labels skipped source state without implying persistence", async () => {
    const { ManualScoringContextPanel } = await loadDeterministicComponents();

    const html = render(
      <ManualScoringContextPanel
        context={{
          followers: 2400,
          source: "manual",
          skipped: true,
        }}
        disabled
        focusTarget="manual-followers"
      />,
    );
    const text = textContent(html);

    expect(text).toContain("Followers");
    expect(html).toContain('value="2400"');
    expect(html).toContain('data-focus-target="manual-followers"');
    expect(html).toContain("disabled");
    expect(text).toContain("manual");
    expect(text).toContain("skipped");
    expect(text).not.toContain("saved");
    expect(text).not.toContain("persisted");
  });
});

describe("DeterministicDetailInspector", () => {
  it("renders empty, loading, and error states without fake sample scores", async () => {
    const { DeterministicDetailInspector } = await loadDeterministicComponents();

    const emptyHtml = render(
      <DeterministicDetailInspector
        state="empty"
        message="Select a candidate to inspect deterministic scoring."
      />,
    );
    const loadingHtml = render(
      <DeterministicDetailInspector
        state="loading"
        label="Loading deterministic details"
      />,
    );
    const errorHtml = render(
      <DeterministicDetailInspector
        state="error"
        message="Could not load deterministic details."
      />,
    );

    expect(textContent(emptyHtml)).toContain(
      "Select a candidate to inspect deterministic scoring.",
    );
    expect(textContent(emptyHtml)).not.toContain("Draft Review");
    expect(textContent(emptyHtml)).not.toContain("Heuristic rank");
    expect(textContent(emptyHtml)).not.toContain("Sample");
    expect(loadingHtml).toContain('role="status"');
    expect(textContent(loadingHtml)).toContain("Loading deterministic details");
    expect(textContent(errorHtml)).toContain(
      "Could not load deterministic details.",
    );
  });

  it("renders ready detail content from the scored API item", async () => {
    const { DeterministicDetailInspector } = await loadDeterministicComponents();

    const html = render(
      <DeterministicDetailInspector state="ready" item={scoredItem()} />,
    );
    const text = textContent(html);

    expect(text).toContain("genuine question: what made your onboarding finally click?");
    expect(text).toContain("Draft Review");
    expect(text).toContain("Ship it");
    expect(text).toContain("Expected reach");
    expect(text).toContain("1500");
    expect(text).toContain("12% escape");
    expect(text).toContain("800 – 2,400");
    expect(text).toContain("Static score 73");
  });

  it("renders detail metadata, API Post Coach data, and recovery actions", async () => {
    const { DeterministicDetailInspector } = await loadDeterministicComponents();
    const item = scoredItem({
      score: {
        ...scoredItem().score,
        value: 91,
      },
      postCoach: readyPostCoach({
        value: 18,
        badge: {
          label: "Rework",
          tone: "rework",
          tooltip: "Expanded API copy should be rendered directly.",
        },
        counts: {
          flagged: 4,
          nudges: 3,
          onPoint: 2,
        },
        failed: [
          {
            id: "derived-fail",
            label: "Derived failed check should not appear",
            status: "fail",
          },
        ],
        warned: [],
        passed: [],
        expanded: true,
        previewMode: false,
        sections: [
          {
            title: "Worth a look",
            items: [
              {
                id: "api-expanded-detail",
                label: "API detail says the opener is too abstract",
                status: "warn",
              },
            ],
          },
        ],
        learnings: [
          {
            text: "Expanded detail learning from API data.",
            relevance: "matched",
          },
        ],
        helperText: "Expanded helper text from the API payload.",
        footerText: "Expanded footer text from the API payload.",
      }),
      prediction: missingFollowersPrediction(),
    });

    const html = render(
      <DeterministicDetailInspector
        state="ready"
        item={item}
        onAddFollowers={vi.fn()}
        onRetryExpandedPostCoach={vi.fn()}
      />,
    );
    const text = textContent(html);

    expect(text).toContain("genuine question: what made your onboarding finally click?");
    expect(text).toContain("Deterministic score");
    expect(text).toContain("91");
    expect(text).toContain("Source format");
    expect(text).toContain("debate-question");
    expect(text).toContain("Detected format");
    expect(text).toContain("genuine_question");
    expect(text).toContain("Analyzer");
    expect(text).toContain("deterministic-v1");
    expect(text).toContain("Analyzed at");
    expect(text).toContain("2026-06-07T12:00:00.000Z");
    expect(text).toContain("Draft Review");
    expect(text).toContain("18");
    expect(text).toContain("Rework");
    expect(text).toContain("Expanded API copy should be rendered directly.");
    expect(text).toContain("Expanded helper text from the API payload.");
    expect(text).toContain("Expanded footer text from the API payload.");
    expect(text).toContain("4");
    expect(text).toContain("3");
    expect(text).toContain("2");
    expect(text).toContain("Worth a look");
    expect(text).toContain("API detail says the opener is too abstract");
    expect(text).toContain("Expanded detail learning from API data.");
    expect(text).not.toContain("Derived failed check should not appear");
    expect(text).toContain("Prediction needs follower count.");
    expect(text).toContain("missing_followers");
    expect(text).toContain("Add followers");
    expect(text).toContain("Retry expanded review");
  });
});
