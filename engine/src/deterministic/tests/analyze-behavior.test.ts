import { describe, expect, it } from "vitest";

// This suite locks the behavior of the canonical decomposed analyzer cluster.
// The legacy post-analyzer monolith was removed; these aliases map the historical
// names onto their decomposed equivalents so the behavioral coverage is retained.
import { analyzeDraftText as analyzePost } from "../analyzer";
import { classifyPostFormat as detectFormat } from "../format-classifier";
import {
  appendPostFormatHistory as recordPostHistory,
  buildFormatVarietyCheck as createVarietyCheck,
  countRecentFormatStreak as streakForFormat,
} from "../format-history";
import {
  buildPostCoachModel as derivePostCoachCard,
  selectPostCoachBadge as getPostCoachBadge,
} from "../post-coach-model";
import { estimateEngagementRange as predictEngagement } from "../prediction-estimator";
import type { PostHistoryEntry as PostHistoryItem } from "../types";
import { evaluateDraftVoice as runVoiceChecks } from "../voice-score";
import type { VoiceCheck } from "../voice-check";

const enrichedTextCheckIds = [
  "quality_answerable_question",
  "quality_vague_curiosity",
  "quality_standalone_context",
  "quality_claim_evidence",
  "quality_profile_click_reason",
  "quality_one_idea_focus",
  "line_length",
  "link_density",
  "mention_density",
] as const;

const bannedClaimPattern =
  /\b(ranking|rank|algorithm|profile health|trends?|trending|live trend|zeitgeist|your data|last 30 days|imported metrics|reply_score|profile_click_score|dwell_score)\b/i;

function findCheck(checks: readonly VoiceCheck[], id: string): VoiceCheck {
  const check = checks.find((item) => item.id === id);

  if (!check) {
    throw new Error(`Expected check "${id}" to be present.`);
  }

  return check;
}

function scoreValueFromReturnedChecks(checks: readonly VoiceCheck[]): number {
  const nonQualityChecks = checks.filter((check) => check.kind !== "quality");
  const qualityChecks = checks.filter((check) => check.kind === "quality");
  const nonQualityPoints = nonQualityChecks.reduce((sum, check) => {
    if (check.status === "pass") {
      return sum + 1;
    }

    if (check.status === "warn") {
      return sum + 0.5;
    }

    return sum;
  }, 0);
  const nonQualityScore =
    nonQualityChecks.length === 0
      ? 100
      : Math.round((nonQualityPoints / nonQualityChecks.length) * 100);
  const qualityPasses = qualityChecks.filter((check) => check.status === "pass").length;
  const qualityScore =
    qualityChecks.length === 0
      ? 100
      : Math.round(40 + (qualityPasses / qualityChecks.length) * 60);

  return Math.min(nonQualityScore, qualityScore);
}

describe("deterministic post analyzer", () => {
  it("detects the supported post formats from observable text structure", () => {
    expect(detectFormat("Hot take: most dashboards are just procrastination")).toBe("hot_take");
    expect(detectFormat("genuine question: why do agents fail at handoffs?")).toBe("genuine_question");
    expect(detectFormat("Founders, what changed your onboarding?")).toBe("audience_question");
    expect(detectFormat("My goal is to ship 3 experiments by end of June")).toBe("goal_share");
    expect(detectFormat("Ship the uncomfortable version")).toBe("one_liner");
  });

  it("scores voice quality, learnings, and engageability deterministically", () => {
    const result = analyzePost(
      "genuine question: why do agents fail at handoffs?",
      { followers: 1000 },
    );

    expect(result).toMatchObject({
      format: "genuine_question",
      score: {
        engageability: {
          engageable: true,
        },
      },
    });
    expect(result.score.checks.find((check) => check.id === "quality_hook")).toMatchObject({
      status: "pass",
    });
    expect(result.score.learnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relevance: "matched",
          text: expect.stringContaining("genuine question"),
        }),
      ]),
    );
  });

  it("warns about X's expand cutoff for drafts at or beyond 15 raw lines", () => {
    const fifteenLines = analyzePost(
      Array.from({ length: 15 }, (_, index) => `Line ${index + 1}`).join("\n"),
      { followers: 1000 },
    );
    const twentyLines = analyzePost(
      Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join("\n"),
      { followers: 1000 },
    );

    expect(findCheck(fifteenLines.score.checks, "expand_zone")).toMatchObject({
      status: "warn",
    });
    // Regression guard: drafts longer than 15 lines are even more hidden behind
    // "show more" and must still warn (previously the check only fired at === 15).
    expect(findCheck(twentyLines.score.checks, "expand_zone")).toMatchObject({
      status: "warn",
    });
  });

  it("exposes the enriched text-only checks through the canonical analyzer score", () => {
    const result = analyzePost(
      [
        "Builders, I shipped a 14 day onboarding test and learned one thing:",
        "",
        "Specific setup screens beat clever copy when users need to finish their first run.",
        "",
        "Which setup step would you remove first: profile import or workspace invite?",
      ].join("\n"),
      { followers: 1000 },
    );

    expect(result.score.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([...enrichedTextCheckIds]),
    );

    const allowedCheckKeys = ["id", "label", "status", "kind"];

    for (const id of enrichedTextCheckIds) {
      const keys = Object.keys(findCheck(result.score.checks, id));

      expect(keys.every((key) => allowedCheckKeys.includes(key))).toBe(true);
    }
  });

  it.each([
    [
      "quality_answerable_question",
      "pass",
      "Builders, which setup step would you remove first: profile import or workspace invite?",
      /answer|reply|question|choice/i,
    ],
    [
      "quality_answerable_question",
      "pass",
      "I removed workspace invites from the first run so new teams could reach one useful result before admin setup.",
      null,
    ],
    [
      "quality_answerable_question",
      "warn",
      "I rewrote the onboarding checklist after 12 user calls. Thoughts?",
      /vague|specific|answer|reply|question/i,
    ],
    [
      "quality_answerable_question",
      "fail",
      "What should we ship next? Why are users stuck? Should pricing change? Who owns the docs?",
      /too many|stack|one question|focus/i,
    ],
    [
      "quality_vague_curiosity",
      "pass",
      "This onboarding teardown changed how I write activation emails for B2B teams.",
      /specific|concrete|curiosity|anchor/i,
    ],
    [
      "quality_vague_curiosity",
      "warn",
      "This changed everything. Nobody talks about this enough.",
      /vague|concrete|curiosity|anchor/i,
    ],
    [
      "quality_standalone_context",
      "pass",
      "Onboarding emails fail when the first task is hidden behind three clicks.",
      /context|standalone|subject|opener/i,
    ],
    [
      "quality_standalone_context",
      "warn",
      "This changed everything after we looked at the signup flow.",
      /context|standalone|subject|opener/i,
    ],
    [
      "quality_claim_evidence",
      "pass",
      "In 14 onboarding calls, pricing confusion showed up before feature confusion.",
      /evidence|proof|claim|specific/i,
    ],
    [
      "quality_claim_evidence",
      "pass",
      "Stripe has the best checkout flow because it shows one clear next step.",
      /evidence|proof|claim|specific/i,
    ],
    [
      "quality_claim_evidence",
      "pass",
      "For example, Acme has the best checkout flow because it shows one clear next step.",
      /evidence|proof|claim|specific/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "Everyone should always remove friction because it is the only way to grow.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "Growth is the best lever.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "Product is the best lever.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "For example Growth is the best lever.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "For example growth is the best lever.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "For founders, Growth is the best lever.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "For B2B, Product is the best lever.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_profile_click_reason",
      "pass",
      "I shipped the trial reset flow last week and learned activation improves when support can replay it.",
      /experience|project|author|profile|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "pass",
      "Like Acme, checkout improved when the setup flow shows one clear next step.",
      /experience|project|author|profile|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "You should write better hooks and provide more value every day.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "Activation improves when onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "Growth improved when onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "Retention showed onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "Marketing showed onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "Sales improved when onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "For example Growth improved when onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "For example Analytics improved when onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "Content improved when onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "Dashboard showed onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "For example growth improved when onboarding asks for one setup step.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_one_idea_focus",
      "pass",
      "Activation improved when we moved workspace invites after the first successful run.",
      /focus|one idea|single/i,
    ],
    [
      "quality_one_idea_focus",
      "warn",
      "Activation needs better invites. Also pricing is confusing. Plus docs need a rewrite. One more thing: support macros matter.",
      /focus|one idea|pivots|too many/i,
    ],
    [
      "line_length",
      "pass",
      "Short lines scan cleanly.\n\nEach point gets room.",
      /line|scan|read/i,
    ],
    [
      "line_length",
      "warn",
      "This onboarding note keeps every caveat, result, setup detail, audience qualifier, and example in one dense line that is deliberately long enough to cross the scanability threshold for the deterministic checker.",
      /line|dense|scan|break/i,
    ],
    [
      "link_density",
      "pass",
      "The teardown stands on its own without making readers leave the post.",
      /link|click|self-contained|useful/i,
    ],
    [
      "link_density",
      "warn",
      "I wrote the full teardown here: https://example.com/onboarding",
      /link|click|useful|without/i,
    ],
    [
      "link_density",
      "fail",
      "Launch notes: https://example.com/a docs: https://example.com/b demo: https://example.com/c",
      /links|link-heavy|too many/i,
    ],
    [
      "mention_density",
      "pass",
      "Thanks @maya for pushing the onboarding teardown into real examples.",
      /mention|read|scan|restrained/i,
    ],
    [
      "mention_density",
      "warn",
      "Thanks @maya @lee @sam for the launch notes and signup teardown.",
      /mention|read|scan|too many/i,
    ],
  ] as const)(
    "%s returns %s for a deterministic text fixture",
    (id, expectedStatus, text, labelPattern) => {
      const check = findCheck(runVoiceChecks(text).checks, id);

      expect(check).toMatchObject({
        id,
        status: expectedStatus,
      });
      if (labelPattern) {
        expect(check.label).toMatch(labelPattern);
      }
      expect(check.label).not.toMatch(bannedClaimPattern);
    },
  );

  it("keeps enriched Post Coach checks flowing through failed, warned, and passed sections", () => {
    const score = runVoiceChecks(
      [
        "This changed everything. What should we ship? Why now? Should pricing change? Who owns docs?",
        "",
        "Also read https://example.com/a and https://example.com/b",
        "",
        "Thanks @maya @lee @sam @jo",
      ].join("\n"),
    );
    const card = derivePostCoachCard({
      expanded: true,
      hasText: true,
      score,
    });

    if (card.state !== "ready") {
      throw new Error("Expected ready card.");
    }

    expect(card.sections.map((section) => section.title)).toEqual([
      "Worth a look",
      "Nudges",
      "On point",
    ]);
    expect(card.failed.map((check) => check.id)).toEqual(
      expect.arrayContaining(["quality_answerable_question", "link_density"]),
    );
    expect(card.warned.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "quality_vague_curiosity",
        "quality_one_idea_focus",
        "mention_density",
      ]),
    );
    expect(card.passed.map((check) => check.id)).toEqual(
      expect.arrayContaining(["line_length"]),
    );
  });

  it("keeps enriched check labels in writing-quality language without ranking or data claims", () => {
    const texts = [
      "This changed everything. Nobody talks about this enough.",
      "Everyone should always remove friction because it is the only way to grow.",
      "I wrote the full teardown here: https://example.com/onboarding",
      "Thanks @maya @lee @sam for the launch notes and signup teardown.",
      "Builders, I shipped a 14 day onboarding test. Which setup step would you remove first?",
    ];
    const labels = texts.flatMap((text) =>
      runVoiceChecks(text).checks
        .filter((check) => enrichedTextCheckIds.includes(check.id as (typeof enrichedTextCheckIds)[number]))
        .map((check) => check.label),
    );

    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toEqual(
      expect.arrayContaining([expect.stringMatching(bannedClaimPattern)]),
    );
  });

  it("keeps the engagement prediction card math stable", () => {
    const prediction = predictEngagement({
      text: "Clear writing compounds when the point is specific.",
      score: 66,
      format: "insight_share",
      followers: 1000,
    });

    expect(prediction).toEqual({
      rangeLow: 160,
      rangeHigh: 372,
      midpoint: 266,
      confidence: "medium",
      signals: [
        {
          signal_key: "quality_voice",
          label: "Static score 66 (-30%)",
          multiplier: 0.7,
        },
        {
          signal_key: "format_insight_share",
          label: "Insight format -5%",
          multiplier: 0.95,
        },
      ],
    });
  });

  it("does not compute engagement prediction without explicit followers", () => {
    const result = analyzePost(
      "genuine question: why do deterministic scoring tools need explicit follower context?",
    );

    expect(result.prediction).toBeNull();
  });

  it("does not let the exported engagement predictor use an implicit follower fallback", () => {
    const prediction = predictEngagement({
      text: "Clear writing compounds when the point is specific.",
      score: 66,
      format: "insight_share",
      followers: undefined,
    });

    expect(prediction).toBeNull();
  });

  it("documents current zeitgeist prediction math without live-trend copy claims", () => {
    const prediction = predictEngagement({
      text: "AI onboarding gets easier when the first run has one clear success moment.",
      score: 66,
      format: "insight_share",
      followers: 1000,
    });

    const signal = prediction?.signals.find((item) => item.signal_key === "zeitgeist");

    expect(signal).toMatchObject({
      signal_key: "zeitgeist",
      multiplier: 1.15,
    });
    expect(signal?.label).not.toMatch(bannedClaimPattern);
  });

  it("supports disabled checks and an injected variety check for future engine composition", () => {
    const varietyCheck: VoiceCheck = {
      id: "variety_recent_format",
      label: "Recent format variety",
      status: "warn",
    };
    const score = runVoiceChecks("Hot take: specific beats clever every time", {
      enabled: {
        hashtags: false,
      },
      varietyCheck,
    });

    expect(score.checks.some((check) => check.id === "hashtags")).toBe(false);
    expect(score.checks).toEqual(expect.arrayContaining([varietyCheck]));
  });

  it("keeps enriched text checks when composing voice checks with an injected variety check", () => {
    const varietyCheck: VoiceCheck = {
      id: "variety_recent_format",
      label: "Recent format variety",
      status: "fail",
    };
    const score = runVoiceChecks(
      [
        "This changed everything. What should we ship? Why now? Should pricing change? Who owns docs?",
        "",
        "Also read https://example.com/a and https://example.com/b",
        "",
        "Thanks @maya @lee @sam @jo",
      ].join("\n"),
      { varietyCheck },
    );
    const checkIds = score.checks.map((check) => check.id);

    expect(checkIds).toEqual(
      expect.arrayContaining(["variety_recent_format", ...enrichedTextCheckIds]),
    );

    const card = derivePostCoachCard({
      expanded: true,
      hasText: true,
      score,
    });

    if (card.state !== "ready") {
      throw new Error("Expected ready card.");
    }

    const failedSectionIds =
      card.sections.find((section) => section.title === "Worth a look")?.items.map((check) => check.id) ??
      [];
    const warnedSectionIds =
      card.sections.find((section) => section.title === "Nudges")?.items.map((check) => check.id) ??
      [];
    const passedSectionIds =
      card.sections.find((section) => section.title === "On point")?.items.map((check) => check.id) ??
      [];

    expect(failedSectionIds).toEqual(
      expect.arrayContaining([
        "variety_recent_format",
        "quality_answerable_question",
      ]),
    );
    expect(card.failed.map((check) => check.id)).toEqual(
      expect.arrayContaining(["quality_answerable_question", "link_density"]),
    );
    expect(card.warned.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "quality_vague_curiosity",
        "quality_one_idea_focus",
        "mention_density",
      ]),
    );
    expect(card.passed.map((check) => check.id)).toEqual(
      expect.arrayContaining(["line_length"]),
    );
    expect(warnedSectionIds).toEqual(
      expect.arrayContaining([
        "quality_vague_curiosity",
        "quality_one_idea_focus",
        "mention_density",
      ]),
    );
    expect(passedSectionIds).toEqual(expect.arrayContaining(["line_length"]));
  });

  it("keeps the public voice score explainable from returned checks when variety is injected", () => {
    const text = [
      "This changed everything. What should we ship? Why now? Should pricing change? Who owns docs?",
      "",
      "Also read https://example.com/a and https://example.com/b",
      "",
      "Thanks @maya @lee @sam @jo",
    ].join("\n");
    const varietyCheck: VoiceCheck = {
      id: "variety_recent_format",
      label: "Recent format variety",
      status: "pass",
    };
    const scoreWithoutVariety = runVoiceChecks(text);
    const scoreWithVariety = runVoiceChecks(text, { varietyCheck });

    expect(scoreWithoutVariety.value).toBe(scoreValueFromReturnedChecks(scoreWithoutVariety.checks));
    expect(scoreWithVariety.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["variety_recent_format", ...enrichedTextCheckIds]),
    );
    expect(scoreWithVariety.value).toBe(scoreValueFromReturnedChecks(scoreWithVariety.checks));
    expect(scoreWithVariety.value).toBe(scoreWithoutVariety.value);
  });

  it("derives a variety check from recent post history without browser storage", () => {
    const history: PostHistoryItem[] = [
      { format: "insight_share", at: "2026-06-07T09:00:00.000Z" },
      { format: "insight_share", at: "2026-06-06T09:00:00.000Z" },
      { format: "hot_take", at: "2026-06-05T09:00:00.000Z" },
    ];
    const insightDraft =
      "Specificity creates trust when you show proof from launch week instead of asking people to believe your roadmap";

    expect(createVarietyCheck(insightDraft, [])).toEqual({
      id: "variety",
      label: "Format mix (insight share)",
      status: "pass",
    });
    expect(createVarietyCheck(insightDraft, history)).toEqual({
      id: "variety",
      label: "3 insight shares in a row - mix it up",
      status: "fail",
    });
    expect(streakForFormat(history, "insight_share")).toBe(2);
  });

  it("records bounded post history in newest-first order", () => {
    const history = Array.from({ length: 10 }, (_, index): PostHistoryItem => ({
      format: index % 2 === 0 ? "story" : "hot_take",
      at: `2026-06-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
    }));
    const next = recordPostHistory(
      history,
      {
        format: "genuine_question",
        kind: "published",
      },
      new Date("2026-06-07T12:00:00.000Z"),
    );

    expect(next).toHaveLength(10);
    expect(next[0]).toEqual({
      format: "genuine_question",
      kind: "published",
      at: "2026-06-07T12:00:00.000Z",
    });
    expect(next).not.toContain(history[9]);
  });

  it("derives the empty Post Coach card state before the user writes", () => {
    expect(derivePostCoachCard({ hasText: false, score: null })).toEqual({
      state: "empty",
      title: "Post Coach",
      message: "Start typing to see static Post Coach checks for the draft.",
    });
  });

  it("derives the expanded Post Coach card sections from voice checks", () => {
    const score = runVoiceChecks(
      [
        "everyone should log launches",
        "",
        "we got 42 replies last week",
        "",
        "proof creates trust",
      ].join("\n"),
      {
        varietyCheck: {
          id: "variety_format_mix",
          label: "Format mix (insight share)",
          status: "pass",
        },
      },
    );
    const card = derivePostCoachCard({
      expanded: true,
      hasText: true,
      score,
    });

    expect(card).toMatchObject({
      state: "ready",
      title: "Post Coach",
      value: 81,
      target: 60,
      badge: {
        label: "Ship it",
        tone: "ship",
      },
      counts: {
        flagged: 4,
        nudges: 2,
        onPoint: 24,
      },
      expanded: true,
      previewMode: false,
      hiddenChecks: 0,
    });

    if (card.state !== "ready") {
      throw new Error("Expected ready card.");
    }

    expect(card.engageability).toEqual({
      engageable: false,
      reason:
        'No clear engagement hook. Add a "hot take:" / "genuine question:" prefix, end on a question, share a milestone moment, or call out an audience.',
    });
    expect(card.sections.map((section) => section.title)).toEqual([
      "Worth a look",
      "Nudges",
      "On point",
    ]);
    expect(card.sections[0]?.items.map((check) => check.id)).toEqual([
      "quality_hook",
      "quality_tension",
      "quality_quotable",
      "quality_question",
    ]);
    expect(card.sections[1]?.items.map((check) => check.id)).toEqual(
      expect.arrayContaining(["direct_opener", "quality_profile_click_reason"]),
    );
    expect(card.sections[2]?.items.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "quality_answerable_question",
        "quality_vague_curiosity",
        "quality_standalone_context",
        "quality_claim_evidence",
        "quality_one_idea_focus",
        "line_length",
        "link_density",
        "mention_density",
      ]),
    );
    expect(card.learnings).toEqual([
      {
        text: "Three or more non-empty lines can make the structure easier to scan.",
        relevance: "matched",
      },
    ]);
    expect(card.helperText).toContain("Signals, not verdicts.");
    expect(card.footerText).toContain("These are static rule checks");
  });

  it("derives Post Coach preview samples without learnings", () => {
    const score = runVoiceChecks("everyone should log launches");
    const card = derivePostCoachCard({
      hasText: true,
      previewMode: true,
      score,
    });

    expect(card).toMatchObject({
      state: "ready",
      expanded: false,
      previewMode: true,
      learnings: [],
      sections: [
        {
          title: "Sample",
        },
      ],
      hiddenChecks: score.checks.length - 2,
    });
  });

  it("labels Post Coach score bands for card badges", () => {
    expect(getPostCoachBadge(90)).toMatchObject({ label: "Top tier", tone: "top" });
    expect(getPostCoachBadge(60)).toMatchObject({ label: "Ship it", tone: "ship" });
    expect(getPostCoachBadge(45)).toMatchObject({ label: "Almost there", tone: "almost" });
    expect(getPostCoachBadge(20)).toMatchObject({ label: "Rework", tone: "rework" });
  });
});
