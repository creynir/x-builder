/**
 * Failing tests for the new overlay-seam schema modules.
 *
 * These schemas do not exist yet; every import below will produce a
 * ModuleNotFoundError / unresolved-export until the implementation lands.
 * That is the correct Red state — all tests here must fail on a missing
 * module, not on a logic error in the test itself.
 *
 * Schemas under test (all from @x-builder/shared barrel):
 *   captureIngestRequestSchema / captureIngestResponseSchema
 *   captureSummarySchema
 *   liveCapturedPostSchema / liveCapturedProfileSchema
 *   cooldownSignalSchema / cooldownReportSchema
 *   suggestPostRequestSchema / suggestPostResponseSchema / suggestedPostSchema
 *   generateCategorySchema
 *   applyJudgeSuggestionsRequestSchema / applyJudgeSuggestionsResponseSchema
 *   overlayReadinessSchema
 */

import { describe, expect, it } from "vitest";
import {
  applyJudgeSuggestionsRequestSchema,
  applyJudgeSuggestionsResponseSchema,
  captureIngestRequestSchema,
  captureIngestResponseSchema,
  captureSummarySchema,
  cooldownReportSchema,
  cooldownSignalSchema,
  generateCategorySchema,
  liveCapturedPostSchema,
  liveCapturedProfileSchema,
  overlayReadinessSchema,
  suggestPostRequestSchema,
  suggestPostResponseSchema,
  suggestedPostSchema,
} from "../../index.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ISO = "2026-06-21T10:00:00.000Z";

const validProfile = {
  platformUserId: "123456",
  screenName: "indie_hacker",
  followers: 1800,
  capturedAt: ISO,
};

const validLivePost = {
  platformPostId: "tweet-abc",
  text: "Local-first is the right default for tools that need to survive offline.",
  createdAt: ISO,
  kind: "original",
  replyReferences: {},
  entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
  liveMetrics: {},
  capturedAt: ISO,
};

const validCooldownSignal = {
  format: "hot_take",
  countInWindow: 4,
  windowDays: 7,
  lastPostedAt: ISO,
  status: "warming",
  message: "You have posted hot_take 4 times in the last 7 days.",
};

const validCooldownReport = {
  windowDays: 7,
  generatedAt: ISO,
  corpusSource: "live",
  signals: [validCooldownSignal],
};

const validSuggestedPost = {
  id: "sug-1",
  format: "hot_take",
  angle: "curious",
  text: "Hot take: the best products are the ones you build for yourself first.",
  rationale: "Aligns with your recent insight_share posts and avoids the warming hot_take window.",
  cooldownStatus: "clear",
  sourceExamplePostIds: ["tweet-abc"],
  generatedBy: "llm",
};

const validSuggestPostResponse = {
  status: "ready",
  suggestions: [validSuggestedPost],
  cooldown: validCooldownReport,
  minimumCorpusSize: 10,
};

// ---------------------------------------------------------------------------
// captureIngestRequestSchema / captureIngestResponseSchema
// ---------------------------------------------------------------------------

describe("captureIngestRequestSchema round-trip", () => {
  it("parses a request with a post array and profile and deep-equals the input", () => {
    const input = {
      posts: [validLivePost],
      profile: validProfile,
    };

    const result = captureIngestRequestSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected captureIngestRequest to parse.");
    expect(result.data.posts).toHaveLength(1);
    expect(result.data.profile?.screenName).toBe("indie_hacker");
  });

  it("defaults an omitted posts array to an empty array", () => {
    const result = captureIngestRequestSchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected captureIngestRequest with no posts to parse.");
    expect(result.data.posts).toEqual([]);
  });

  it("rejects a posts array longer than 200 entries", () => {
    const posts = Array.from({ length: 201 }, (_, i) => ({
      ...validLivePost,
      platformPostId: `tweet-${i}`,
    }));

    expect(captureIngestRequestSchema.safeParse({ posts }).success).toBe(false);
  });
});

describe("captureIngestResponseSchema round-trip", () => {
  it("parses a valid ingest response and round-trips all counter fields", () => {
    const input = {
      insertedCount: 12,
      updatedCount: 3,
      unchangedCount: 5,
      duplicateCount: 1,
      profileApplied: true,
      corpusSize: 97,
    };

    const result = captureIngestResponseSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected captureIngestResponse to parse.");
    expect(result.data).toMatchObject(input);
  });

  it("rejects a response with a negative counter", () => {
    expect(
      captureIngestResponseSchema.safeParse({
        insertedCount: -1,
        updatedCount: 0,
        unchangedCount: 0,
        duplicateCount: 0,
        profileApplied: false,
        corpusSize: 0,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// liveCapturedPostSchema
// ---------------------------------------------------------------------------

describe("liveCapturedPostSchema round-trip", () => {
  it("parses a minimal valid live post and retains all required fields", () => {
    const result = liveCapturedPostSchema.safeParse(validLivePost);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected liveCapturedPost to parse.");
    expect(result.data.platformPostId).toBe("tweet-abc");
    expect(result.data.kind).toBe("original");
    expect(result.data.replyReferences).toEqual({});
    expect(result.data.liveMetrics).toEqual({});
  });

  it("defaults replyReferences and liveMetrics when omitted", () => {
    const { replyReferences: _r, liveMetrics: _l, ...withoutDefaults } = validLivePost;
    const result = liveCapturedPostSchema.safeParse(withoutDefaults);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected liveCapturedPost without defaults to parse.");
    expect(result.data.replyReferences).toEqual({});
    expect(result.data.liveMetrics).toEqual({});
  });

  it("rejects a post with a text field longer than 8000 characters", () => {
    expect(
      liveCapturedPostSchema.safeParse({ ...validLivePost, text: "x".repeat(8_001) }).success,
    ).toBe(false);
  });

  it("rejects a post with a platformPostId longer than 160 characters", () => {
    expect(
      liveCapturedPostSchema.safeParse({
        ...validLivePost,
        platformPostId: "x".repeat(161),
      }).success,
    ).toBe(false);
  });

  it("rejects a post with an unknown kind discriminant", () => {
    expect(
      liveCapturedPostSchema.safeParse({ ...validLivePost, kind: "quote_tweet" }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO createdAt timestamp", () => {
    expect(
      liveCapturedPostSchema.safeParse({ ...validLivePost, createdAt: "2026-06-21" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// liveCapturedProfileSchema
// ---------------------------------------------------------------------------

describe("liveCapturedProfileSchema round-trip", () => {
  it("parses a valid profile and retains all supplied fields", () => {
    const result = liveCapturedProfileSchema.safeParse(validProfile);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected liveCapturedProfile to parse.");
    expect(result.data).toMatchObject(validProfile);
  });

  it("parses a profile that omits the optional followers count", () => {
    const { followers: _f, ...withoutFollowers } = validProfile;
    const result = liveCapturedProfileSchema.safeParse(withoutFollowers);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected profile without followers to parse.");
    expect(result.data.followers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// captureSummarySchema
// ---------------------------------------------------------------------------

describe("captureSummarySchema round-trip", () => {
  it("parses a full capture summary and round-trips every field", () => {
    const input = {
      postsCaptured: 45,
      lastCaptureAt: ISO,
      followers: 1800,
      screenName: "indie_hacker",
      profileCapturedAt: ISO,
    };

    const result = captureSummarySchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected captureSummary to parse.");
    expect(result.data).toMatchObject(input);
  });

  it("parses a minimal summary with only postsCaptured present", () => {
    const result = captureSummarySchema.safeParse({ postsCaptured: 0 });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected minimal captureSummary to parse.");
    expect(result.data.postsCaptured).toBe(0);
    expect(result.data.lastCaptureAt).toBeUndefined();
    expect(result.data.followers).toBeUndefined();
  });

  it("rejects a negative postsCaptured count", () => {
    expect(captureSummarySchema.safeParse({ postsCaptured: -1 }).success).toBe(false);
  });

  it("rejects a screenName longer than 80 characters", () => {
    expect(
      captureSummarySchema.safeParse({
        postsCaptured: 10,
        screenName: "x".repeat(81),
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cooldownSignalSchema
// ---------------------------------------------------------------------------

describe("cooldownSignalSchema round-trip", () => {
  it("parses a valid cooldown signal and round-trips all fields", () => {
    const result = cooldownSignalSchema.safeParse(validCooldownSignal);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected cooldownSignal to parse.");
    expect(result.data).toMatchObject(validCooldownSignal);
  });

  it("rejects a signal using the wrong field name count instead of countInWindow", () => {
    const malformed = {
      format: "hot_take",
      count: 4,
      windowDays: 7,
      status: "warming",
      message: "wrong field name",
    };

    expect(cooldownSignalSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects a windowDays of 0 (below the minimum of 1)", () => {
    expect(
      cooldownSignalSchema.safeParse({ ...validCooldownSignal, windowDays: 0 }).success,
    ).toBe(false);
  });

  it("rejects a windowDays of 91 (above the maximum of 90)", () => {
    expect(
      cooldownSignalSchema.safeParse({ ...validCooldownSignal, windowDays: 91 }).success,
    ).toBe(false);
  });

  it("accepts windowDays at the boundary values 1 and 90", () => {
    expect(
      cooldownSignalSchema.safeParse({ ...validCooldownSignal, windowDays: 1 }).success,
    ).toBe(true);
    expect(
      cooldownSignalSchema.safeParse({ ...validCooldownSignal, windowDays: 90 }).success,
    ).toBe(true);
  });

  it("rejects a message longer than 240 characters", () => {
    expect(
      cooldownSignalSchema.safeParse({
        ...validCooldownSignal,
        message: "x".repeat(241),
      }).success,
    ).toBe(false);
  });

  it("rejects a negative countInWindow", () => {
    expect(
      cooldownSignalSchema.safeParse({ ...validCooldownSignal, countInWindow: -1 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cooldownReportSchema
// ---------------------------------------------------------------------------

describe("cooldownReportSchema round-trip", () => {
  it("parses a valid cooldown report and round-trips all fields", () => {
    const result = cooldownReportSchema.safeParse(validCooldownReport);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected cooldownReport to parse.");
    expect(result.data).toMatchObject(validCooldownReport);
  });

  it("parses a report with an empty signals array", () => {
    const result = cooldownReportSchema.safeParse({
      ...validCooldownReport,
      signals: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected cooldownReport with no signals to parse.");
    expect(result.data.signals).toEqual([]);
  });

  it("rejects a signals array with more than 40 entries", () => {
    const signals = Array.from({ length: 41 }, () => validCooldownSignal);

    expect(cooldownReportSchema.safeParse({ ...validCooldownReport, signals }).success).toBe(false);
  });

  it("rejects an unknown corpusSource discriminant", () => {
    expect(
      cooldownReportSchema.safeParse({
        ...validCooldownReport,
        corpusSource: "database",
      }).success,
    ).toBe(false);
  });

  it("rejects a windowDays of 0 at the report level", () => {
    expect(
      cooldownReportSchema.safeParse({ ...validCooldownReport, windowDays: 0 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestPostRequestSchema
// ---------------------------------------------------------------------------

describe("suggestPostRequestSchema round-trip", () => {
  it("parses an explicit request and round-trips all fields", () => {
    const input = { windowDays: 14, excludeFormats: ["hot_take"], count: 4 };

    const result = suggestPostRequestSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected suggestPostRequest to parse.");
    expect(result.data.windowDays).toBe(14);
    expect(result.data.count).toBe(4);
  });

  it("defaults windowDays to 7, excludeFormats to [], and count to 3 when all omitted", () => {
    const result = suggestPostRequestSchema.safeParse({});

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected empty suggestPostRequest to parse.");
    expect(result.data.windowDays).toBe(7);
    expect(result.data.excludeFormats).toEqual([]);
    expect(result.data.count).toBe(3);
  });

  it("rejects a count of 0 (below minimum of 1)", () => {
    expect(suggestPostRequestSchema.safeParse({ count: 0 }).success).toBe(false);
  });

  it("rejects a count of 5 (above maximum of 4)", () => {
    expect(suggestPostRequestSchema.safeParse({ count: 5 }).success).toBe(false);
  });

  it("rejects a windowDays of 0", () => {
    expect(suggestPostRequestSchema.safeParse({ windowDays: 0 }).success).toBe(false);
  });

  it("rejects a windowDays of 91", () => {
    expect(suggestPostRequestSchema.safeParse({ windowDays: 91 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestedPostSchema
// ---------------------------------------------------------------------------

describe("suggestedPostSchema round-trip", () => {
  it("parses a valid suggested post and round-trips all fields", () => {
    const result = suggestedPostSchema.safeParse(validSuggestedPost);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected suggestedPost to parse.");
    expect(result.data).toMatchObject(validSuggestedPost);
  });

  it("rejects an unknown angle discriminant", () => {
    expect(
      suggestedPostSchema.safeParse({ ...validSuggestedPost, angle: "confrontational" }).success,
    ).toBe(false);
  });

  it("rejects a rationale longer than 280 characters", () => {
    expect(
      suggestedPostSchema.safeParse({
        ...validSuggestedPost,
        rationale: "x".repeat(281),
      }).success,
    ).toBe(false);
  });

  it("rejects sourceExamplePostIds with more than 5 entries", () => {
    expect(
      suggestedPostSchema.safeParse({
        ...validSuggestedPost,
        sourceExamplePostIds: ["a", "b", "c", "d", "e", "f"],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestPostResponseSchema
// ---------------------------------------------------------------------------

describe("suggestPostResponseSchema round-trip", () => {
  it("parses a valid suggest-post response and round-trips all top-level fields", () => {
    const result = suggestPostResponseSchema.safeParse(validSuggestPostResponse);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected suggestPostResponse to parse.");
    expect(result.data.status).toBe("ready");
    expect(result.data.minimumCorpusSize).toBe(10);
    expect(result.data.suggestions).toHaveLength(1);
  });

  it("rejects a suggestions array with 5 entries (above the maximum of 4)", () => {
    const fiveSuggestions = Array.from({ length: 5 }, (_, i) => ({
      ...validSuggestedPost,
      id: `sug-${i}`,
    }));

    expect(
      suggestPostResponseSchema.safeParse({
        ...validSuggestPostResponse,
        suggestions: fiveSuggestions,
      }).success,
    ).toBe(false);
  });

  it("parses an insufficient_corpus response with an empty suggestions array", () => {
    const result = suggestPostResponseSchema.safeParse({
      ...validSuggestPostResponse,
      status: "insufficient_corpus",
      suggestions: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected insufficient_corpus response to parse.");
    expect(result.data.status).toBe("insufficient_corpus");
  });

  it("rejects an unknown status discriminant", () => {
    expect(
      suggestPostResponseSchema.safeParse({
        ...validSuggestPostResponse,
        status: "error",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateCategorySchema
// ---------------------------------------------------------------------------

describe("generateCategorySchema round-trip", () => {
  it("parses a valid generate category and round-trips all fields", () => {
    const input = {
      id: "cat-hot-take-001",
      label: "Hot takes",
      format: "hot_take",
      basis: "top_performer",
      cooldownStatus: "clear",
      sampleCount: 8,
    };

    const result = generateCategorySchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected generateCategory to parse.");
    expect(result.data).toMatchObject(input);
  });

  it("rejects an id longer than 120 characters", () => {
    expect(
      generateCategorySchema.safeParse({
        id: "x".repeat(121),
        label: "Test",
        format: "hot_take",
        basis: "default",
        cooldownStatus: "clear",
        sampleCount: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects a label longer than 40 characters", () => {
    expect(
      generateCategorySchema.safeParse({
        id: "cat-1",
        label: "x".repeat(41),
        format: "hot_take",
        basis: "default",
        cooldownStatus: "clear",
        sampleCount: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown basis discriminant", () => {
    expect(
      generateCategorySchema.safeParse({
        id: "cat-1",
        label: "Test",
        format: "hot_take",
        basis: "ai_generated",
        cooldownStatus: "clear",
        sampleCount: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects a negative sampleCount", () => {
    expect(
      generateCategorySchema.safeParse({
        id: "cat-1",
        label: "Test",
        format: "hot_take",
        basis: "default",
        cooldownStatus: "clear",
        sampleCount: -1,
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyJudgeSuggestionsRequestSchema / applyJudgeSuggestionsResponseSchema
// ---------------------------------------------------------------------------

describe("applyJudgeSuggestionsRequestSchema round-trip", () => {
  it("parses a valid apply-suggestions request and trims leading/trailing whitespace", () => {
    const result = applyJudgeSuggestionsRequestSchema.safeParse({
      text: "  A draft with some rough edges.  ",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected applyJudgeSuggestionsRequest to parse.");
    expect(result.data.text).toBe("A draft with some rough edges.");
  });

  it("rejects a blank text field after trimming", () => {
    expect(applyJudgeSuggestionsRequestSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("rejects a text field longer than 8000 characters", () => {
    expect(
      applyJudgeSuggestionsRequestSchema.safeParse({ text: "x".repeat(8_001) }).success,
    ).toBe(false);
  });
});

describe("applyJudgeSuggestionsResponseSchema round-trip", () => {
  // Build a minimal but valid judgeVerdict for the response fixture.
  const scores = {
    overall: 75,
    replies: 70,
    profileClicks: 65,
    impressions: 68,
    bookmarkValue: 60,
    dwellProxy: 72,
    voiceMatch: 80,
    negativeRisk: 12,
    answerEffort: 55,
    strangerAnswerability: 50,
    statusDependency: 30,
    replyVsQuoteOrientation: 62,
    audienceMatch: null,
  };

  const verdict = {
    verdict: "slight_rework",
    confidence: "medium",
    scores,
    headline: "Strong hook, weak closer.",
    strengths: ["Opens with a concrete claim"],
    improvements: ["Tighten the middle paragraph"],
  };

  const validApplyResponse = {
    text: "A draft with suggestions applied and improved.",
    verdict,
    approved: true,
    improvedOverOriginal: true,
  };

  it("parses a valid apply-suggestions response and round-trips all fields", () => {
    const result = applyJudgeSuggestionsResponseSchema.safeParse(validApplyResponse);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected applyJudgeSuggestionsResponse to parse.");
    expect(result.data.text).toBe(validApplyResponse.text);
    expect(result.data.approved).toBe(true);
    expect(result.data.improvedOverOriginal).toBe(true);
  });

  it("parses a not-improved response where the original text was returned unchanged", () => {
    const result = applyJudgeSuggestionsResponseSchema.safeParse({
      ...validApplyResponse,
      improvedOverOriginal: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected not-improved apply response to parse.");
    expect(result.data.improvedOverOriginal).toBe(false);
  });

  it("rejects a response with a missing text field", () => {
    const { text: _t, ...withoutText } = validApplyResponse;

    expect(applyJudgeSuggestionsResponseSchema.safeParse(withoutText).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// overlayReadinessSchema
// ---------------------------------------------------------------------------

describe("overlayReadinessSchema round-trip", () => {
  const subsystem = {
    state: "ready",
    label: "Static engine",
    retryable: false,
    checkedAt: ISO,
    details: {},
  };

  const validOverlayReadiness = {
    staticEngine: subsystem,
    llm: { ...subsystem, label: "LLM judge" },
    capture: {
      state: "ok",
      label: "Capture observer running",
      lastCaptureAt: ISO,
      checkedAt: ISO,
    },
  };

  it("parses a fully populated overlay readiness payload and round-trips the structure", () => {
    const result = overlayReadinessSchema.safeParse(validOverlayReadiness);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected overlayReadiness to parse.");
    expect(result.data.capture.state).toBe("ok");
    expect(result.data.staticEngine.state).toBe("ready");
  });

  it("parses a capture block with state paused and an optional message", () => {
    const result = overlayReadinessSchema.safeParse({
      ...validOverlayReadiness,
      capture: {
        state: "paused",
        label: "Observer paused",
        message: "X navigation not detected yet.",
        checkedAt: ISO,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected paused capture readiness to parse.");
    expect(result.data.capture.state).toBe("paused");
  });

  it("parses a capture block with state layout_changed", () => {
    const result = overlayReadinessSchema.safeParse({
      ...validOverlayReadiness,
      capture: {
        state: "layout_changed",
        label: "X layout changed — selectors need update",
        checkedAt: ISO,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected layout_changed capture state to parse.");
    expect(result.data.capture.state).toBe("layout_changed");
  });

  it("rejects a capture block with an unknown state discriminant", () => {
    expect(
      overlayReadinessSchema.safeParse({
        ...validOverlayReadiness,
        capture: {
          state: "error",
          label: "Something went wrong",
          checkedAt: ISO,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a capture label longer than 80 characters", () => {
    expect(
      overlayReadinessSchema.safeParse({
        ...validOverlayReadiness,
        capture: {
          state: "ok",
          label: "x".repeat(81),
          checkedAt: ISO,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a capture message longer than 240 characters", () => {
    expect(
      overlayReadinessSchema.safeParse({
        ...validOverlayReadiness,
        capture: {
          state: "paused",
          label: "Observer paused",
          message: "x".repeat(241),
          checkedAt: ISO,
        },
      }).success,
    ).toBe(false);
  });
});
