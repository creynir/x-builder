import { describe, expect, it } from "vitest";

import { analyzePostsResponseSchema, type AnalyzedPostItem } from "@x-builder/shared";

import { analyzeDraftText } from "../analyzer";
import { DeterministicAnalysisService } from "../deterministic-analysis-service";

// Pinning suite for the production-observable analyze contract.
//
// In production the only entry points are `analyzeDraftText(text, { followers })`
// (called by the service) and `DeterministicAnalysisService.analyzePosts`, which
// passes ONLY `{ followers }` to the analyzer. Production requests never supply
// `aiRating`, never supply an injected `varietyCheck`, and never build post-format
// history. These tests assert the concrete, observable output of that production
// shape so an internal restructuring (removing the unreachable aiRating /
// varietyCheck / format-history paths) can prove it changed nothing.
//
// Every assertion uses concrete values captured from current production behavior.
// If the upcoming deletion alters any production output, these tests FAIL.

type ScoredItem = Extract<AnalyzedPostItem, { status: "scored" }>;

const PRODUCTION_FOLLOWERS = 2400;

function analyzeProd(text: string, followers: number | undefined = PRODUCTION_FOLLOWERS) {
  // Exactly the option shape the production analyzer call site uses: followers only.
  // No aiRating, no varietyCheck, no enabled overrides.
  return analyzeDraftText(text, { followers });
}

function scoreOneViaService(
  text: string,
  followers: number | undefined,
  postCoachMode: "preview" | "expanded" = "preview",
): ScoredItem {
  const service = new DeterministicAnalysisService();
  const response = analyzePostsResponseSchema.parse(
    service.analyzePosts({
      items: [{ id: "candidate", text }],
      // Production-shaped scoring context: followers only (or empty).
      scoringContext: followers === undefined ? {} : { followers },
      presentation: { postCoachMode },
    }),
  );

  expect(response.items).toHaveLength(1);
  const item = response.items[0]!;

  if (item.status !== "scored") {
    throw new Error(`Expected scored item, got ${item.status}.`);
  }

  return item;
}

// Representative production drafts spanning the supported formats. The expected
// values are the current production output for a {followers: 2400}-only request.
const FORMAT_FIXTURES = {
  question:
    "genuine question: why do agent handoffs fail when the context is hidden from the next step?",
  hotTake: "hot take: specific launch proof beats generic positioning every week",
  story: [
    "I shipped a 14 day onboarding test last month.",
    "We removed workspace invites from the first run.",
    "New teams reached one useful result before admin setup, and activation climbed.",
  ].join("\n"),
  link: "I wrote the full teardown here: https://example.com/onboarding",
  short: "Ship the uncomfortable version",
  insight: "Clear writing compounds when the point is specific and grounded in one example.",
} as const;

describe("production analyze contract (followers-only requests)", () => {
  it("pins detected format and voice score for representative production drafts", () => {
    expect(analyzeProd(FORMAT_FIXTURES.question)).toMatchObject({
      format: "genuine_question",
      score: { value: 85 },
    });
    expect(analyzeProd(FORMAT_FIXTURES.hotTake)).toMatchObject({
      format: "hot_take",
      score: { value: 85 },
    });
    expect(analyzeProd(FORMAT_FIXTURES.story)).toMatchObject({
      format: "story",
      score: { value: 81 },
    });
    expect(analyzeProd(FORMAT_FIXTURES.link)).toMatchObject({
      format: "one_liner",
      score: { value: 78 },
    });
    expect(analyzeProd(FORMAT_FIXTURES.short)).toMatchObject({
      format: "one_liner",
      score: { value: 65 },
    });
    expect(analyzeProd(FORMAT_FIXTURES.insight)).toMatchObject({
      format: "one_liner",
      score: { value: 74 },
    });
  });

  it("pins the full engagement prediction for a question draft", () => {
    expect(analyzeProd(FORMAT_FIXTURES.question).prediction).toEqual({
      rangeLow: 1530,
      rangeHigh: 3570,
      midpoint: 2550,
      confidence: "medium",
      signals: [
        { signal_key: "quality_voice", label: "Static score 85 (+120%)", multiplier: 2.2 },
        { signal_key: "format_genuine_question", label: "Question format +5%", multiplier: 1.05 },
        { signal_key: "zeitgeist", label: "Timely wording", multiplier: 1.15 },
      ],
    });
  });

  it("pins the full engagement prediction for a hot-take draft", () => {
    expect(analyzeProd(FORMAT_FIXTURES.hotTake).prediction).toEqual({
      rangeLow: 1690,
      rangeHigh: 3944,
      midpoint: 2817,
      confidence: "medium",
      signals: [
        { signal_key: "quality_voice", label: "Static score 85 (+120%)", multiplier: 2.2 },
        { signal_key: "format_hot_take", label: "Hot take format +16%", multiplier: 1.16 },
        { signal_key: "zeitgeist", label: "Timely wording", multiplier: 1.15 },
      ],
    });
  });

  it("pins the full engagement prediction for a story draft", () => {
    expect(analyzeProd(FORMAT_FIXTURES.story).prediction).toEqual({
      rangeLow: 1720,
      rangeHigh: 4012,
      midpoint: 2866,
      confidence: "medium",
      signals: [
        { signal_key: "quality_voice", label: "Static score 81 (+120%)", multiplier: 2.2 },
        { signal_key: "format_story", label: "Story format +18%", multiplier: 1.18 },
        { signal_key: "zeitgeist", label: "Timely wording", multiplier: 1.15 },
      ],
    });
  });

  it("pins the full engagement prediction for a one-liner with a link", () => {
    expect(analyzeProd(FORMAT_FIXTURES.link).prediction).toEqual({
      rangeLow: 677,
      rangeHigh: 1581,
      midpoint: 1129,
      confidence: "medium",
      signals: [
        { signal_key: "quality_voice", label: "Static score 78 (+40%)", multiplier: 1.4 },
        { signal_key: "format_one_liner", label: "One-liner format -16%", multiplier: 0.84 },
      ],
    });
  });

  it("pins the full engagement prediction for a short one-liner", () => {
    expect(analyzeProd(FORMAT_FIXTURES.short).prediction).toEqual({
      rangeLow: 339,
      rangeHigh: 790,
      midpoint: 564,
      confidence: "medium",
      signals: [
        { signal_key: "quality_voice", label: "Static score 65 (-30%)", multiplier: 0.7 },
        { signal_key: "format_one_liner", label: "One-liner format -16%", multiplier: 0.84 },
      ],
    });
  });
});

describe("production confidence ladder (no aiRating ever supplied)", () => {
  // Invariant: the engagement `confidence` value is fixed for every input that
  // never supplied aiRating, i.e. every production input. The dormant
  // aiHighConfidenceSignalCount / aiMediumConfidenceSignalCount relaxation only
  // fires when aiRating is set, so its removal must NOT move any value asserted
  // here.
  //
  // QUIRK (pinned, see flag in the report): the deterministic voice scorer floors
  // any draft long enough to receive a prediction (>= 15 chars) at >= 50 — the
  // quality floor is 40 and standard checks rarely drop a real draft below 50.
  // Shorter drafts hit isTooShort (capped 25) but then fail the predictor's
  // minimumTextLength guard and return a null prediction. As a result the only
  // confidence tiers OBSERVABLE in production are "medium" and "high"; "low" is
  // unreachable for any {followers}-only input. We therefore pin medium and high
  // (the live tiers) and pin that the predicted-disabled states stand in for the
  // sub-50 region. We do NOT fabricate a "low" production draft — none exists.

  it("yields high confidence for >=4 signals with a strong score", () => {
    const highDraft = [
      "I shipped an AI onboarding test last week but the first run never compounded.",
      "We removed the workspace invite step instead of adding more copy.",
      "Activation actually climbed when new teams reached one useful result before admin setup.",
    ].join("\n");
    const prediction = analyzeProd(highDraft).prediction;

    expect(prediction).not.toBeNull();
    expect(prediction?.confidence).toBe("high");
    expect(prediction?.signals.map((signal) => signal.signal_key)).toEqual([
      "quality_voice",
      "format_story",
      "zeitgeist",
      "tension_contradiction",
    ]);
    // Concrete full shape so a confidence-ladder change is caught end to end.
    expect(prediction).toEqual({
      rangeLow: 3037,
      rangeHigh: 5062,
      midpoint: 4050,
      confidence: "high",
      signals: [
        { signal_key: "quality_voice", label: "Static score 85 (+120%)", multiplier: 2.2 },
        { signal_key: "format_story", label: "Story format +18%", multiplier: 1.18 },
        { signal_key: "zeitgeist", label: "Timely wording", multiplier: 1.3 },
        {
          signal_key: "tension_contradiction",
          label: "Tension / contradiction +25%",
          multiplier: 1.25,
        },
      ],
    });
  });

  it("yields medium confidence for 2-3 signals with a score at or above 50", () => {
    // The question/hot-take/story fixtures all land here; assert the contract directly.
    expect(analyzeProd(FORMAT_FIXTURES.question).prediction?.confidence).toBe("medium");
    expect(analyzeProd(FORMAT_FIXTURES.insight).prediction?.confidence).toBe("medium");
  });

  it("never drops below medium for a single-line one-liner that still earns a prediction", () => {
    // QUIRK: even a low-effort one-liner floors at >= 50 and keeps a 2-signal
    // medium. This pins that the production confidence value here is "medium"
    // (not "low") so the dead aiMediumConfidenceSignalCount relaxation removal
    // cannot change it.
    const onePlainLine = "this is a perfectly ordinary sentence with nothing special at all";
    const prediction = analyzeProd(onePlainLine).prediction;

    expect(prediction).not.toBeNull();
    expect(analyzeProd(onePlainLine).score.value).toBeGreaterThanOrEqual(50);
    expect(prediction?.confidence).toBe("medium");
  });

  it("never yields a low-confidence prediction for any {followers}-only production draft", () => {
    // Locks the observable production confidence surface to {medium, high}. The
    // estimator's "low" branch is unreachable in production (see QUIRK above), so
    // a refactor that touches the confidence ladder must keep it unreachable.
    const draftsThatProducePredictions = [
      FORMAT_FIXTURES.question,
      FORMAT_FIXTURES.hotTake,
      FORMAT_FIXTURES.story,
      FORMAT_FIXTURES.link,
      FORMAT_FIXTURES.short,
      FORMAT_FIXTURES.insight,
      "buy now buy now click here and smash that follow button immediately",
      "LEVERAGE SYNERGY PARADIGM GOING FORWARD CIRCLE BACK MOVE THE NEEDLE #grind #hustle",
    ];

    for (const text of draftsThatProducePredictions) {
      const prediction = analyzeProd(text).prediction;
      expect(prediction).not.toBeNull();
      expect(prediction?.confidence).not.toBe("low");
      expect(["medium", "high"]).toContain(prediction?.confidence);
    }
  });
});

describe("production analyze contract (no injected variety check)", () => {
  it("never emits a variety check when called the production way (no varietyCheck option)", () => {
    // Production never injects a varietyCheck and never calls buildFormatVarietyCheck,
    // so no 'variety' check id may appear in the score for any production draft.
    for (const text of Object.values(FORMAT_FIXTURES)) {
      const checkIds = analyzeProd(text).score.checks.map((check) => check.id);
      expect(checkIds.some((id) => id.startsWith("variety"))).toBe(false);
    }
  });

  it("matches between options-less and {followers}-only calls (no hidden default state)", () => {
    // analyzeDraftText() with no options and analyzeDraftText(text, {}) must agree
    // on format, score, and checks — confirming the production default carries no
    // varietyCheck and no aiRating influence.
    const text = FORMAT_FIXTURES.hotTake;
    const bare = analyzeDraftText(text);
    const empty = analyzeDraftText(text, {});

    expect(bare.format).toBe(empty.format);
    expect(bare.score.value).toBe(empty.score.value);
    expect(bare.score.checks).toEqual(empty.score.checks);
    expect(bare.score.checks.some((check) => check.id.startsWith("variety"))).toBe(false);
  });
});

describe("production analyze contract via DeterministicAnalysisService", () => {
  it("surfaces an available prediction with the pinned confidence for a followers request", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.question, PRODUCTION_FOLLOWERS);

    expect(item.detectedFormat).toBe("genuine_question");
    expect(item.score.value).toBe(85);
    expect(item.prediction).toEqual({
      status: "available",
      rangeLow: 1530,
      rangeHigh: 3570,
      midpoint: 2550,
      confidence: "medium",
      signals: [
        { signal_key: "quality_voice", label: "Static score 85 (+120%)", multiplier: 2.2 },
        { signal_key: "format_genuine_question", label: "Question format +5%", multiplier: 1.05 },
        { signal_key: "zeitgeist", label: "Timely wording", multiplier: 1.15 },
      ],
    });
  });

  it("disables prediction (missing_followers) for a followers-less request", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.question, undefined);

    expect(item.detectedFormat).toBe("genuine_question");
    expect(item.score.value).toBe(85);
    expect(item.prediction).toEqual({
      status: "disabled",
      reason: "missing_followers",
      message: "Add a follower count to estimate engagement for this draft.",
    });
  });

  it("disables prediction (text_too_short) when followers are present but text is too short", () => {
    const item = scoreOneViaService("today was fine", PRODUCTION_FOLLOWERS);

    expect(item.score.value).toBe(25);
    expect(item.prediction).toEqual({
      status: "disabled",
      reason: "text_too_short",
      message: "Write a little more before estimating engagement.",
    });
  });
});
