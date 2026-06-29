/**
 * Failing tests for the additive judge/shell/analysis schema edits and the
 * EngineTransport binding registry.
 *
 * Covers:
 *   - judgeAnnotationSchema (new field on judgeVerdictSchema)
 *   - judgeVerdictSchema += annotations (legacy-parse-unchanged + max(12) cap)
 *   - deriveApproved boundary (overall 70 → true, 69 → false)
 *   - generateIdeaRequestSchema refine (idea-only, format-only, neither → rejected)
 *   - analyzePostsResponseSchema legacy parse (omitted cooldown is not injected)
 *   - ENGINE_TRANSPORT_BINDINGS shape (exactly 24 entries, locked names)
 *
 * Every import that references a NOT-YET-IMPLEMENTED symbol will produce a
 * ModuleNotFoundError / unresolved-export.  That is the correct Red state.
 */

import { describe, expect, it } from "vitest";
import {
  analyzePostsRequestSchema,
  analyzePostsResponseSchema,
  applyJudgeSuggestionsRequestSchema,
  deriveApproved,
  ENGINE_TRANSPORT_BINDINGS,
  generateIdeaRequestSchema,
  judgeAnnotationSchema,
  judgeDraftRequestSchema,
  judgeVerdictSchema,
  replyComposerContextSchema,
} from "../../index.js";

// ---------------------------------------------------------------------------
// Shared judge verdict fixture (mirrors judge.test.ts conventions)
// ---------------------------------------------------------------------------

const scores = {
  overall: 78,
  replies: 80,
  profileClicks: 72,
  impressions: 65,
  bookmarkValue: 60,
  dwellProxy: 70,
  voiceMatch: 85,
  negativeRisk: 10,
  answerEffort: 55,
  strangerAnswerability: 48,
  statusDependency: 30,
  replyVsQuoteOrientation: 62,
  audienceMatch: null,
};

const validVerdict = {
  verdict: "slight_rework" as const,
  confidence: "medium" as const,
  scores,
  headline: "Strong hook, weak closer.",
  strengths: ["Opens with a concrete claim"],
  improvements: ["Tighten the middle paragraph"],
};

const validReplyComposerContext = {
  source: "same_dialog_dom" as const,
  targetAuthorHandle: "context_builder",
  targetDisplayName: "Context Builder",
  targetText: "The boring version is usually the one people can actually ship.",
  targetStatusId: "1930000000000000000",
  targetUrl: "https://x.com/context_builder/status/1930000000000000000",
  leadingTargetHandle: {
    handle: "context_builder",
    state: "present" as const,
  },
};

const minimalAnalyzeItem = {
  id: "candidate-1",
  text: "What changed when your onboarding finally started working?",
  sourceFormat: "one-liner" as const,
};

const minimalAnalyzeRequest = {
  items: [minimalAnalyzeItem],
  scoringContext: {
    followers: 1200,
  },
};

// ---------------------------------------------------------------------------
// judgeAnnotationSchema
// ---------------------------------------------------------------------------

describe("judgeAnnotationSchema round-trip", () => {
  it("parses a valid judge annotation and round-trips all fields", () => {
    const input = {
      quote: "the best products are built for yourself",
      severity: "suggestion",
      recommendation: "Add a concrete example to ground this claim.",
    };

    const result = judgeAnnotationSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected judgeAnnotation to parse.");
    expect(result.data).toMatchObject(input);
  });

  it("rejects an annotation whose quote is empty", () => {
    expect(
      judgeAnnotationSchema.safeParse({
        quote: "",
        severity: "warning",
        recommendation: "Fix this.",
      }).success,
    ).toBe(false);
  });

  it("rejects an annotation whose quote is exactly 281 characters (above max of 280)", () => {
    expect(
      judgeAnnotationSchema.safeParse({
        quote: "x".repeat(281),
        severity: "suggestion",
        recommendation: "Shorten the highlighted text.",
      }).success,
    ).toBe(false);
  });

  it("accepts an annotation whose quote is exactly 280 characters (at max boundary)", () => {
    expect(
      judgeAnnotationSchema.safeParse({
        quote: "x".repeat(280),
        severity: "warning",
        recommendation: "Consider tightening this sentence.",
      }).success,
    ).toBe(true);
  });

  it("rejects an annotation with an unknown severity discriminant", () => {
    expect(
      judgeAnnotationSchema.safeParse({
        quote: "valid quote",
        severity: "error",
        recommendation: "Fix this.",
      }).success,
    ).toBe(false);
  });

  it("rejects an annotation whose recommendation is empty", () => {
    expect(
      judgeAnnotationSchema.safeParse({
        quote: "valid quote",
        severity: "suggestion",
        recommendation: "",
      }).success,
    ).toBe(false);
  });

  it("rejects an annotation whose recommendation is longer than 240 characters", () => {
    expect(
      judgeAnnotationSchema.safeParse({
        quote: "valid quote",
        severity: "suggestion",
        recommendation: "x".repeat(241),
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// judgeVerdictSchema — annotations extension
// ---------------------------------------------------------------------------

describe("judgeVerdictSchema annotations extension", () => {
  it("parses a verdict that explicitly carries an empty annotations array", () => {
    const result = judgeVerdictSchema.safeParse({ ...validVerdict, annotations: [] });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected verdict with empty annotations to parse.");
    expect(result.data.annotations).toEqual([]);
  });

  it("parses a verdict with one valid annotation and round-trips it", () => {
    const annotation = {
      quote: "the best products",
      severity: "suggestion",
      recommendation: "Provide a supporting example.",
    };

    const result = judgeVerdictSchema.safeParse({
      ...validVerdict,
      annotations: [annotation],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected verdict with annotation to parse.");
    expect(result.data.annotations).toHaveLength(1);
    expect(result.data.annotations[0]).toMatchObject(annotation);
  });

  it("rejects a verdict whose annotations array exceeds the maximum of 12 entries", () => {
    const annotations = Array.from({ length: 13 }, (_, i) => ({
      quote: `span ${i + 1}`,
      severity: "suggestion" as const,
      recommendation: "Consider revising.",
    }));

    expect(judgeVerdictSchema.safeParse({ ...validVerdict, annotations }).success).toBe(false);
  });

  it("accepts a verdict whose annotations array is exactly 12 entries (at max boundary)", () => {
    const annotations = Array.from({ length: 12 }, (_, i) => ({
      quote: `span ${i + 1}`,
      severity: "warning" as const,
      recommendation: "Consider revising.",
    }));

    expect(judgeVerdictSchema.safeParse({ ...validVerdict, annotations }).success).toBe(true);
  });

  // CRITICAL legacy-parse-unchanged: a legacy JudgeVerdict with no annotations key
  // must parse and yield annotations: [] — the .default([]) is the compat mechanism.
  it("parses a legacy verdict that has no annotations key and yields annotations as an empty array", () => {
    // validVerdict has no annotations key — it is the legacy shape.
    const result = judgeVerdictSchema.safeParse(validVerdict);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected legacy verdict without annotations to parse.");
    // The defaulted field must be present and equal to []
    expect(result.data.annotations).toEqual([]);
    // Every other field must be byte-identical to the input
    expect(result.data.verdict).toBe(validVerdict.verdict);
    expect(result.data.confidence).toBe(validVerdict.confidence);
    expect(result.data.scores).toEqual(validVerdict.scores);
    expect(result.data.headline).toBe(validVerdict.headline);
    expect(result.data.strengths).toEqual(validVerdict.strengths);
    expect(result.data.improvements).toEqual(validVerdict.improvements);
  });
});

// ---------------------------------------------------------------------------
// deriveApproved boundary
// ---------------------------------------------------------------------------

describe("deriveApproved boundary conditions", () => {
  // overall === 70 is the lower edge of the slight_rework band → approved
  it("returns true for a verdict whose overall score is exactly 70 (slight_rework band)", () => {
    const verdictAt70 = judgeVerdictSchema.parse({
      ...validVerdict,
      scores: { ...scores, overall: 70 },
      verdict: "slight_rework",
    });

    expect(deriveApproved(verdictAt70)).toBe(true);
  });

  // overall === 69 is the top of the major_rework band → not approved
  it("returns false for a verdict whose overall score is exactly 69 (major_rework band)", () => {
    const verdictAt69 = judgeVerdictSchema.parse({
      ...validVerdict,
      scores: { ...scores, overall: 69 },
      verdict: "major_rework",
    });

    expect(deriveApproved(verdictAt69)).toBe(false);
  });

  it("returns true for a post_now verdict", () => {
    const postNow = judgeVerdictSchema.parse({
      ...validVerdict,
      scores: { ...scores, overall: 90 },
      verdict: "post_now",
    });

    expect(deriveApproved(postNow)).toBe(true);
  });

  it("returns false for a do_not_post verdict", () => {
    const doNotPost = judgeVerdictSchema.parse({
      ...validVerdict,
      scores: { ...scores, overall: 20 },
      verdict: "do_not_post",
    });

    expect(deriveApproved(doNotPost)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reply composer context schema
// ---------------------------------------------------------------------------

describe("reply composer context schema", () => {
  it("parses a valid context and round trips every field", () => {
    const result = replyComposerContextSchema.safeParse(validReplyComposerContext);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected reply composer context to parse.");
    expect(result.data).toEqual(validReplyComposerContext);
  });

  it("parses a valid context without optional status fields and with a deleted leading handle", () => {
    const input = {
      source: "same_dialog_dom" as const,
      targetAuthorHandle: "signal_ops",
      targetText: "A narrow contract is easier to carry through the whole stack.",
      leadingTargetHandle: {
        handle: "signal_ops",
        state: "user_deleted" as const,
      },
    };

    const result = replyComposerContextSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected minimal reply composer context to parse.");
    expect(result.data).toEqual(input);
  });

  it("rejects handles that include an at sign or invalid characters", () => {
    const invalidContexts = [
      {
        ...validReplyComposerContext,
        targetAuthorHandle: "@context_builder",
      },
      {
        ...validReplyComposerContext,
        leadingTargetHandle: {
          ...validReplyComposerContext.leadingTargetHandle,
          handle: "context-builder",
        },
      },
    ];

    for (const input of invalidContexts) {
      expect(replyComposerContextSchema.safeParse(input).success).toBe(false);
    }
  });

  it("rejects oversized target text and target url fields", () => {
    expect(
      replyComposerContextSchema.safeParse({
        ...validReplyComposerContext,
        targetText: "x".repeat(8_001),
      }).success,
    ).toBe(false);

    expect(
      replyComposerContextSchema.safeParse({
        ...validReplyComposerContext,
        targetUrl: "https://x.com/context_builder/status/" + "1".repeat(4_100),
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reply context request payloads
// ---------------------------------------------------------------------------

describe("reply context additive request payloads", () => {
  it("preserves reply context on a format seeded generation request", () => {
    const result = generateIdeaRequestSchema.safeParse({
      format: "hot_take",
      replyContext: validReplyComposerContext,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected generation request with reply context to parse.");
    expect(result.data.format).toBe("hot_take");
    expect(result.data.replyContext).toEqual(validReplyComposerContext);
  });

  it("rejects a generation request that only carries reply context", () => {
    expect(
      generateIdeaRequestSchema.safeParse({ replyContext: validReplyComposerContext }).success,
    ).toBe(false);
  });

  it("preserves reply context on a judge request", () => {
    const result = judgeDraftRequestSchema.safeParse({
      text: "This draft should be judged in the context of the visible reply target.",
      replyContext: validReplyComposerContext,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected judge request with reply context to parse.");
    expect(result.data.replyContext).toEqual(validReplyComposerContext);
  });

  it("preserves reply context on an apply suggestions request", () => {
    const result = applyJudgeSuggestionsRequestSchema.safeParse({
      text: "Tighten this reply without losing the target context.",
      replyContext: validReplyComposerContext,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected apply suggestions request to parse.");
    expect(result.data.replyContext).toEqual(validReplyComposerContext);
  });

  it("preserves reply context on an analyze request item", () => {
    const result = analyzePostsRequestSchema.safeParse({
      ...minimalAnalyzeRequest,
      items: [
        {
          ...minimalAnalyzeItem,
          replyContext: validReplyComposerContext,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected analyze request with reply context to parse.");
    expect(result.data.items[0]?.replyContext).toEqual(validReplyComposerContext);
  });

  it("keeps normal request shapes valid when reply context is absent", () => {
    expect(generateIdeaRequestSchema.safeParse({ format: "hot_take" }).success).toBe(true);
    expect(judgeDraftRequestSchema.safeParse({ text: "A normal draft." }).success).toBe(true);
    expect(
      applyJudgeSuggestionsRequestSchema.safeParse({ text: "A normal draft." }).success,
    ).toBe(true);
    expect(analyzePostsRequestSchema.safeParse(minimalAnalyzeRequest).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateIdeaRequestSchema additive refine
// ---------------------------------------------------------------------------

describe("generateIdeaRequestSchema additive refine", () => {
  // CRITICAL legacy-parse-unchanged: an idea-only request (no format) must parse
  // unchanged.
  it("parses a legacy idea-only request unchanged and passes the refine", () => {
    const input = { idea: "Ship the boring version first and iterate." };

    const result = generateIdeaRequestSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected idea-only GenerateIdeaRequest to parse.");
    expect(result.data.idea).toBe("Ship the boring version first and iterate.");
    // format must not be injected
    expect(result.data.format).toBeUndefined();
  });

  // format-only (no idea) must also parse.
  it("parses a format-only request where idea is omitted", () => {
    const result = generateIdeaRequestSchema.safeParse({ format: "hot_take" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected format-only GenerateIdeaRequest to parse.");
    expect(result.data.format).toBe("hot_take");
    expect(result.data.idea).toBeUndefined();
  });

  // Neither idea nor format → refine must reject.
  it("rejects a request that supplies neither idea nor format", () => {
    expect(generateIdeaRequestSchema.safeParse({}).success).toBe(false);
  });

  it("parses a request carrying both idea and format", () => {
    const result = generateIdeaRequestSchema.safeParse({
      idea: "A take on async work culture.",
      format: "insight_share",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected idea+format GenerateIdeaRequest to parse.");
    expect(result.data.idea).toBe("A take on async work culture.");
    expect(result.data.format).toBe("insight_share");
  });

  it("trims whitespace from the idea field", () => {
    const result = generateIdeaRequestSchema.safeParse({
      idea: "  Ship the boring version first.  ",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected trimmed idea to parse.");
    expect(result.data.idea).toBe("Ship the boring version first.");
  });

  it("rejects an idea longer than 4000 characters", () => {
    expect(
      generateIdeaRequestSchema.safeParse({ idea: "x".repeat(4_001) }).success,
    ).toBe(false);
  });

  it("rejects more than 25 known post ids", () => {
    const result = generateIdeaRequestSchema.safeParse({
      format: "hot_take",
      useKnownPostIds: Array.from({ length: 26 }, (_value, index) => `post-${index}`),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown format value", () => {
    expect(
      generateIdeaRequestSchema.safeParse({ format: "viral_thread" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analyzePostsResponseSchema — legacy scored item without cooldown
// ---------------------------------------------------------------------------

describe("analyzePostsResponseSchema legacy item without cooldown", () => {
  // Build a minimal but valid scored post item fixture (no cooldown key).
  const learningCaveat =
    "Static rule check. Imported performance data is not connected yet.";

  const score = {
    value: 72,
    checks: [
      { id: "quality_hook", label: "Clear hook", status: "pass" },
    ],
    learnings: [
      { text: "Specific proof tends to make posts easier to evaluate.", relevance: "general" },
    ],
    engageability: { engageable: true, reason: "Ends with a concrete question." },
  };

  const postCoach = {
    state: "ready",
    title: "Post Coach",
    value: 72,
    badge: { label: "Ship it", tone: "ship", tooltip: "Solid post." },
    target: 60,
    engageability: score.engageability,
    failed: [],
    warned: [],
    passed: [score.checks[0]],
    counts: { flagged: 0, nudges: 0, onPoint: 1 },
    expanded: false,
    previewMode: true,
    sections: [{ title: "Sample", items: [score.checks[0]] }],
    learnings: [],
    learningCaveat,
    hiddenChecks: 0,
    helperText: "Signals, not verdicts.",
    footerText: "Static heuristic checks only.",
  };

  const prediction = {
    status: "available",
    signals: [{ signal_key: "quality_voice", label: "Static score 72", multiplier: 0.8 }],
    predictedMidImpressions: 300,
    stallRange: { low: 180, high: 360 },
    escapeRange: { low: 600, high: 2400 },
    escapeProbability: 0.1,
    expectedReplies: 6,
    baseImpressions: 200,
    baseSource: "follower_estimate",
    qualityBasis: "static",
    reachModelVersion: "reach-v1",
  };

  // A legacy scored item: no cooldown key.
  const legacyScoredItem = {
    status: "scored",
    id: "candidate-1",
    text: "genuine question: what made your onboarding finally click?",
    sourceFormat: "debate-question",
    detectedFormat: "genuine_question",
    score,
    postCoach,
    prediction,
    heuristicLabel: "Heuristic rank, not prediction.",
    analyzedAt: "2026-06-21T10:00:00.000Z",
    analyzerVersion: "deterministic-v1",
  };

  // CRITICAL legacy-parse-unchanged: omitted cooldown must not be injected.
  it("parses a legacy scored item that omits cooldown and does not inject a cooldown field", () => {
    const result = analyzePostsResponseSchema.safeParse({ items: [legacyScoredItem] });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected legacy analyzePostsResponse without cooldown to parse.");
    }

    expect(result.data.items).toHaveLength(1);
    const item = result.data.items[0];
    if (!item) {
      throw new Error("Expected the parsed response to carry exactly one scored item.");
    }

    expect(item.status).toBe("scored");
    // cooldown must not have been added by parsing
    expect(item).not.toHaveProperty("cooldown");
  });
});

// ---------------------------------------------------------------------------
// ENGINE_TRANSPORT_BINDINGS
// ---------------------------------------------------------------------------

// Locked 24 method names (from the ticket spec — spellings must not drift)
const LOCKED_METHOD_NAMES = [
  "getOverlayReadiness",
  "getStatus",
  "getSettings",
  "updateSettings",
  "validateArchive",
  "importArchive",
  "getActiveContext",
  "activateContext",
  "deactivateContext",
  "analyzePosts",
  "judgeDraft",
  "generateIdeas",
  "suggestPost",
  "getCooldown",
  "getCaptureSummary",
  "getGenerateCategories",
  "applyJudgeSuggestions",
  "recordFeedbackPrediction",
  "linkFeedbackPrediction",
  "getFeedbackLoopSummary",
  "getExternalXSignalsOverview",
  "addExternalXSignalSource",
  "removeExternalXSignalSource",
  "refreshExternalXSignalSource",
] as const;

describe("ENGINE_TRANSPORT_BINDINGS shape and completeness", () => {
  it("contains exactly 24 entries", () => {
    const keys = Object.keys(ENGINE_TRANSPORT_BINDINGS);

    expect(keys).toHaveLength(24);
  });

  it("does not add a transport binding for reply context", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.replyContext).toBeUndefined();
    expect(ENGINE_TRANSPORT_BINDINGS.getReplyContext).toBeUndefined();
    expect(ENGINE_TRANSPORT_BINDINGS.setReplyContext).toBeUndefined();
  });

  it("has every value equal to __xbuilder_<methodName>", () => {
    for (const [method, binding] of Object.entries(ENGINE_TRANSPORT_BINDINGS)) {
      expect(binding).toBe(`__xbuilder_${method}`);
    }
  });

  it("contains exactly the locked set of 24 method names and no others", () => {
    const keys = new Set(Object.keys(ENGINE_TRANSPORT_BINDINGS));
    const locked = new Set<string>(LOCKED_METHOD_NAMES);

    for (const name of locked) {
      expect(keys.has(name)).toBe(true);
    }

    for (const key of keys) {
      expect(locked.has(key)).toBe(true);
    }
  });

  it("is a defined object and is frozen so consumers cannot mutate the binding registry", () => {
    expect(ENGINE_TRANSPORT_BINDINGS).toBeDefined();
    expect(typeof ENGINE_TRANSPORT_BINDINGS).toBe("object");
    expect(Object.isFrozen(ENGINE_TRANSPORT_BINDINGS)).toBe(true);
  });

  it("has the binding __xbuilder_analyzePosts (not analyzePost — locked spelling)", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.analyzePosts).toBe("__xbuilder_analyzePosts");
  });

  it("has the binding __xbuilder_suggestPost (not getSuggestion — locked spelling)", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.suggestPost).toBe("__xbuilder_suggestPost");
  });

  it("has the binding __xbuilder_getGenerateCategories (not getCategories — locked spelling)", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.getGenerateCategories).toBe(
      "__xbuilder_getGenerateCategories",
    );
  });

  it("has the binding __xbuilder_applyJudgeSuggestions (locked spelling)", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.applyJudgeSuggestions).toBe(
      "__xbuilder_applyJudgeSuggestions",
    );
  });

  it("has the binding __xbuilder_generateIdeas (not generate or generateCandidates — locked spelling)", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.generateIdeas).toBe("__xbuilder_generateIdeas");
  });

  it("has the feedback bindings with locked spellings", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.recordFeedbackPrediction).toBe(
      "__xbuilder_recordFeedbackPrediction",
    );
    expect(ENGINE_TRANSPORT_BINDINGS.linkFeedbackPrediction).toBe(
      "__xbuilder_linkFeedbackPrediction",
    );
    expect(ENGINE_TRANSPORT_BINDINGS.getFeedbackLoopSummary).toBe(
      "__xbuilder_getFeedbackLoopSummary",
    );
    expect(ENGINE_TRANSPORT_BINDINGS.getFeedbackLoop).toBeUndefined();
    expect(ENGINE_TRANSPORT_BINDINGS.recordPrediction).toBeUndefined();
  });

  it("has the external X signal bindings with locked spellings and no stale aliases", () => {
    expect(ENGINE_TRANSPORT_BINDINGS.getExternalXSignalsOverview).toBe(
      "__xbuilder_getExternalXSignalsOverview",
    );
    expect(ENGINE_TRANSPORT_BINDINGS.addExternalXSignalSource).toBe(
      "__xbuilder_addExternalXSignalSource",
    );
    expect(ENGINE_TRANSPORT_BINDINGS.removeExternalXSignalSource).toBe(
      "__xbuilder_removeExternalXSignalSource",
    );
    expect(ENGINE_TRANSPORT_BINDINGS.refreshExternalXSignalSource).toBe(
      "__xbuilder_refreshExternalXSignalSource",
    );
    expect(ENGINE_TRANSPORT_BINDINGS.registerExternalAccount).toBeUndefined();
    expect(ENGINE_TRANSPORT_BINDINGS.importExternalSignals).toBeUndefined();
    expect(ENGINE_TRANSPORT_BINDINGS.getExternalSignalsSummary).toBeUndefined();
    expect(ENGINE_TRANSPORT_BINDINGS.getExternalSignalPatterns).toBeUndefined();
  });
});
