import { describe, expect, it } from "vitest";

import {
  analyzePostsResponseSchema,
  type AnalyzedPostItem,
  type AnalyzePostsRequest,
} from "@x-builder/shared";

import { analyzeDraftText } from "../analyzer";
import { DeterministicAnalysisService } from "../deterministic-analysis-service";
import { formatReachTable, replyRateTable } from "../const/reach-model-weights";
import { staticQualityCompression } from "../prediction-estimator";

type AvailablePrediction = Extract<
  Extract<AnalyzedPostItem, { status: "scored" }>["prediction"],
  { status: "available" }
>;

// Recomputes the two-regime reach output from the produced base and the pinned
// format/score, so the assertions are exact yet independent of the internal
// follower-estimate base-scaling formula. `linkMult`/`statusMult` default to
// the production-path values (no link detected by the bare analyzer, status
// only applies to wisdom_one_liner).
const halvedEscapeFormats = new Set(["nuanced_question", "wisdom_one_liner", "insight_share"]);

// RMU-007 reach-signal lexicons and factors. These mirror the production
// constants exactly so the contract pins agree with the prediction-estimator
// suite. The adjustments touch only pEscape / expectedReplies — never the
// midpoint or ranges — so the helper applies them after the midpoint is fixed.
const TRENDING_TOPIC_TERMS = [
  "claude",
  "codex",
  "gpt",
  "gemini",
  "agent",
  "agents",
  "llm",
  "llms",
  "copilot",
  "cursor",
  "rag",
  "mcp",
] as const;
const TRENDING_BONUS_PER_MATCH = 0.15;
const TRENDING_MAX_BONUS = 0.4;
const TRIBE_VOCATIVE_TERMS = [
  "founder",
  "founders",
  "indie",
  "solo",
  "builder",
  "builders",
  "growth",
  "shipping",
  "launch",
] as const;
const TRIBE_REPLY_MULTIPLIER = 1.2;
const ONE_WORD_ESCAPE_MULTIPLIER = 1.4;
const ONE_WORD_REPLY_MULTIPLIER = 2.0;
const ANSWER_EFFORT_PENALTY = 0.7;
const SELF_DISCLOSURE_PATTERN =
  /\$[\d,]+|\b(?:lost|burned|wasted|blew)\b[^.?!]*\$?[\d,]+|\b(?:failed|failure|broke|bankrupt)\b/i;

function countWordMatches(lowerText: string, terms: readonly string[]): number {
  return terms.filter((term) => new RegExp(`\\b${term}\\b`, "i").test(lowerText)).length;
}

function expectReachShape(
  prediction: AvailablePrediction,
  options: {
    format: keyof typeof formatReachTable;
    score: number;
    statusMult?: number;
    linkMult?: number;
    hasExternalLink?: boolean;
    // The fixture text drives the RMU-007 reach-signal adjustments. When
    // omitted, no signal adjustments apply (a neutral draft).
    text?: string;
  },
): void {
  const base = prediction.baseImpressions;
  const formatMult = formatReachTable[options.format].p50Multiplier;
  const qualityMult = staticQualityCompression(options.score);
  const statusMult = options.statusMult ?? 1;
  const linkMult = options.linkMult ?? (options.hasExternalLink ? 0.2 : 1);
  const mid = Math.max(1, base * formatMult * qualityMult * statusMult * linkMult);

  let escapeProbability = formatReachTable[options.format].escapeProbability;
  if (halvedEscapeFormats.has(options.format)) {
    escapeProbability *= 0.5;
  }

  // RMU-007 reach-signal adjustments, derived from the fixture text and composed
  // in the same order as the production estimator: trending lift + tribe reply
  // lift, then answer-effort (one-word lift / anecdote-or-disclosure penalty),
  // then clamp, then the external-link cap LAST.
  const lowerText = (options.text ?? "").trim().toLowerCase();
  let expectedReplies = mid * replyRateTable[options.format];

  const trendingMatchCount = countWordMatches(lowerText, TRENDING_TOPIC_TERMS);
  if (trendingMatchCount > 0) {
    escapeProbability *=
      1 + Math.min(TRENDING_MAX_BONUS, TRENDING_BONUS_PER_MATCH * trendingMatchCount);
  }

  if (countWordMatches(lowerText, TRIBE_VOCATIVE_TERMS) > 0) {
    expectedReplies *= TRIBE_REPLY_MULTIPLIER;
  }

  if (/\bin (?:1|one) word\b/i.test(lowerText)) {
    escapeProbability *= ONE_WORD_ESCAPE_MULTIPLIER;
    expectedReplies *= ONE_WORD_REPLY_MULTIPLIER;
  }

  if (
    /\bhow did you\b|\bwhat made you\b|\band why\?/i.test(lowerText) ||
    SELF_DISCLOSURE_PATTERN.test(lowerText)
  ) {
    escapeProbability *= ANSWER_EFFORT_PENALTY;
  }

  escapeProbability = Math.min(1, Math.max(0, escapeProbability));

  if (options.hasExternalLink) {
    escapeProbability = Math.min(escapeProbability, 0.03);
  }

  expect(prediction.qualityBasis).toBe("static");
  expect(prediction.baseSource).toBe("follower_estimate");
  expect(typeof prediction.reachModelVersion).toBe("string");
  expect(prediction.reachModelVersion.length).toBeGreaterThan(0);
  expect(prediction.predictedMidImpressions).toBe(Math.round(mid));
  expect(prediction.stallRange).toEqual({
    low: Math.round(Math.min(0.3 * base, mid)),
    high: Math.round(Math.max(0.3 * base, 1.2 * mid)),
  });
  expect(prediction.escapeRange).toEqual({
    low: Math.round(3 * base),
    high: Math.round(12 * base),
  });
  expect(prediction.escapeProbability).toBeCloseTo(escapeProbability, 10);
  expect(prediction.expectedReplies).toBeCloseTo(expectedReplies, 6);
  // The RMU-006 migration bridge is gone: no legacy mirror fields survive.
  expect(prediction).not.toHaveProperty("rangeLow");
  expect(prediction).not.toHaveProperty("rangeHigh");
  expect(prediction).not.toHaveProperty("midpoint");
  expect(prediction).not.toHaveProperty("confidence");
}

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

function scoreOneWithContext(
  text: string,
  scoringContext: AnalyzePostsRequest["scoringContext"],
): ScoredItem {
  const service = new DeterministicAnalysisService();
  const response = analyzePostsResponseSchema.parse(
    service.analyzePosts({
      items: [{ id: "candidate", text }],
      scoringContext,
      presentation: { postCoachMode: "preview" },
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
    // Under the corrected cascade these single advice/observation lines no longer
    // collapse into the deleted `one_liner` member; they reclassify to
    // `wisdom_one_liner`. Voice scores are format-independent, so they hold.
    expect(analyzeProd(FORMAT_FIXTURES.link)).toMatchObject({
      format: "wisdom_one_liner",
      score: { value: 78 },
    });
    expect(analyzeProd(FORMAT_FIXTURES.short)).toMatchObject({
      format: "wisdom_one_liner",
      score: { value: 65 },
    });
    expect(analyzeProd(FORMAT_FIXTURES.insight)).toMatchObject({
      format: "wisdom_one_liner",
      score: { value: 74 },
    });
  });

  it("pins the two-regime reach output for a question draft", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.question, PRODUCTION_FOLLOWERS);

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction for the question draft.");
    }

    // genuine_question, score 85 (qualityMult 1.1), no link, status-neutral.
    // The fixture text contains the trending term "agent", so pEscape carries
    // the +0.15 single-match trending lift (0.1 -> 0.115); the midpoint and
    // ranges are untouched by it.
    expectReachShape(item.prediction, {
      format: "genuine_question",
      score: 85,
      text: FORMAT_FIXTURES.question,
    });
    expect(Array.isArray(item.prediction.signals)).toBe(true);
  });

  it("pins the two-regime reach output for a hot-take draft", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.hotTake, PRODUCTION_FOLLOWERS);

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction for the hot-take draft.");
    }

    // The fixture text contains the tribe term "launch", so expectedReplies
    // carries the +20% tribe lift; pEscape and the midpoint are untouched by it.
    expectReachShape(item.prediction, {
      format: "hot_take",
      score: 85,
      text: FORMAT_FIXTURES.hotTake,
    });
  });

  it("pins the two-regime reach output for a story draft", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.story, PRODUCTION_FOLLOWERS);

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction for the story draft.");
    }

    expectReachShape(item.prediction, {
      format: "story",
      score: 81,
      text: FORMAT_FIXTURES.story,
    });
  });

  it("damps the reach midpoint and escape probability for a wisdom one-liner that carries a link", () => {
    // Reclassified one_liner -> wisdom_one_liner. The service detects the
    // external link, so the midpoint is multiplied by 0.2 AND the escape
    // probability is capped at 0.03. wisdom_one_liner is also in the halved-escape
    // set and earns a status multiplier (2400 / 20000 -> floored to 0.3).
    const item = scoreOneViaService(FORMAT_FIXTURES.link, PRODUCTION_FOLLOWERS);

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction for the linked wisdom one-liner.");
    }

    expectReachShape(item.prediction, {
      format: "wisdom_one_liner",
      score: 78,
      statusMult: 0.3,
      hasExternalLink: true,
      text: FORMAT_FIXTURES.link,
    });
    expect(item.prediction.escapeProbability).toBeLessThanOrEqual(0.03);
  });

  it("pins the two-regime reach output for a short wisdom one-liner without a link", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.short, PRODUCTION_FOLLOWERS);

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction for the short wisdom one-liner.");
    }

    // wisdom_one_liner, score 65 (qualityMult 1.0), status 0.3, no link.
    expectReachShape(item.prediction, {
      format: "wisdom_one_liner",
      score: 65,
      statusMult: 0.3,
      text: FORMAT_FIXTURES.short,
    });
  });
});

describe("production reach output (four-regime, no legacy bridge)", () => {
  // The four-regime model replaces the old confidence-driven range, and the
  // RMU-006 migration bridge is now deleted: rangeLow/rangeHigh/midpoint and the
  // prediction confidence band no longer exist. We pin the stable end-state
  // contract instead — quality basis present, four-regime fields derived from the
  // base and ordered, and none of the deleted legacy fields surviving.

  it("emits a four-regime reach shape with no legacy fields for a multi-line production draft", () => {
    const highDraft = [
      "I shipped an AI onboarding test last week but the first run never compounded.",
      "We removed the workspace invite step instead of adding more copy.",
      "Activation actually climbed when new teams reached one useful result before admin setup.",
    ].join("\n");
    const item = scoreOneViaService(highDraft, PRODUCTION_FOLLOWERS);

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction for the multi-line story draft.");
    }

    expect(item.prediction).not.toHaveProperty("confidence");
    // story format, score 85 (qualityMult 1.1), status-neutral, no link. The
    // draft carries tension/contrast words ("but", "instead", "actually") but no
    // lexicon terms, so no reach-signal adjustment applies.
    expectReachShape(item.prediction, { format: "story", score: 85, text: highDraft });
  });

  it("emits ordered four-regime ranges and a present quality basis with no legacy fields for every representative draft", () => {
    for (const text of Object.values(FORMAT_FIXTURES)) {
      const item = scoreOneViaService(text, PRODUCTION_FOLLOWERS);

      if (item.prediction.status !== "available") {
        throw new Error(`Expected an available prediction for "${text}".`);
      }

      const { prediction } = item;
      expect(prediction.qualityBasis).toBe("static");
      expect(prediction.stallRange.low).toBeLessThanOrEqual(prediction.stallRange.high);
      expect(prediction.escapeRange.low).toBeLessThanOrEqual(prediction.escapeRange.high);
      expect(prediction.escapeProbability).toBeGreaterThanOrEqual(0);
      expect(prediction.escapeProbability).toBeLessThanOrEqual(1);
      expect(prediction.predictedMidImpressions).toBeGreaterThanOrEqual(1);
      expect(prediction).not.toHaveProperty("rangeLow");
      expect(prediction).not.toHaveProperty("rangeHigh");
      expect(prediction).not.toHaveProperty("midpoint");
      expect(prediction).not.toHaveProperty("confidence");
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
  it("surfaces an available two-regime prediction for a followers request", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.question, PRODUCTION_FOLLOWERS);

    expect(item.detectedFormat).toBe("genuine_question");
    expect(item.score.value).toBe(85);

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction for a followers request.");
    }

    expect(item.prediction.baseSource).toBe("follower_estimate");
    // The fixture text contains the trending term "agent": pEscape carries the
    // +0.15 single-match trending lift; the midpoint is untouched.
    expectReachShape(item.prediction, {
      format: "genuine_question",
      score: 85,
      text: FORMAT_FIXTURES.question,
    });
  });

  it("surfaces an available prediction from a trailing median even when followers are absent", () => {
    const item = scoreOneWithContext(FORMAT_FIXTURES.question, {
      trailingMedianImpressions: 2000,
    });

    expect(item.detectedFormat).toBe("genuine_question");

    if (item.prediction.status !== "available") {
      throw new Error("Expected a trailing-median request to be available, not disabled.");
    }

    expect(item.prediction.baseSource).toBe("trailing_median");
    expect(item.prediction.baseImpressions).toBe(2000);
    expect(item.prediction.qualityBasis).toBe("static");
    expect(item.prediction.escapeRange).toEqual({
      low: Math.round(3 * 2000),
      high: Math.round(12 * 2000),
    });
  });

  it("prefers the trailing median over followers as the base source", () => {
    const item = scoreOneWithContext(FORMAT_FIXTURES.question, {
      followers: PRODUCTION_FOLLOWERS,
      trailingMedianImpressions: 2000,
    });

    if (item.prediction.status !== "available") {
      throw new Error("Expected an available prediction when both base inputs are present.");
    }

    expect(item.prediction.baseSource).toBe("trailing_median");
    expect(item.prediction.baseImpressions).toBe(2000);
  });

  it("disables prediction (missing_followers) only when both followers and trailing median are absent", () => {
    const item = scoreOneViaService(FORMAT_FIXTURES.question, undefined);

    expect(item.detectedFormat).toBe("genuine_question");
    expect(item.score.value).toBe(85);
    expect(item.prediction).toEqual({
      status: "disabled",
      reason: "missing_followers",
      message: "Add a follower count to estimate engagement for this draft.",
    });
  });

  it("disables prediction (text_too_short) when a base is present but the text is too short", () => {
    const item = scoreOneViaService("today was fine", PRODUCTION_FOLLOWERS);

    expect(item.score.value).toBe(25);
    expect(item.prediction).toEqual({
      status: "disabled",
      reason: "text_too_short",
      message: "Write a little more before estimating engagement.",
    });
  });

  it("prefers text_too_short over missing_followers when a trailing-median base is present but text is short", () => {
    const item = scoreOneWithContext("today was fine", {
      trailingMedianImpressions: 2000,
    });

    expect(item.prediction).toEqual({
      status: "disabled",
      reason: "text_too_short",
      message: "Write a little more before estimating engagement.",
    });
  });
});
