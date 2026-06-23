/**
 * Failing tests for the GraphQL → capture-DTO normalizer.
 *
 * The module under test (`./x-graphql-normalizer`) does not exist yet, so every
 * import below resolves to nothing until the implementation lands. That is the
 * intended Red state: these tests must fail on a missing module, not on a logic
 * error in the test itself.
 *
 * Subject:
 *   XGraphQlNormalizer.normalizeUserTweets(json, capturedAt) -> LiveCapturedPost[]
 *   XGraphQlNormalizer.normalizeUserProfile(json, capturedAt) -> LiveCapturedProfile | undefined
 *
 * Fixtures (owned here) live in ./__fixtures__/graphql/.
 */

import { describe, expect, it } from "vitest";
import {
  liveCapturedPostSchema,
  liveCapturedProfileSchema,
  type LiveCapturedPost,
  type LiveCapturedProfile,
} from "@x-builder/shared";

import { XGraphQlNormalizer } from "./x-graphql-normalizer";

import userTweetsValid from "./__fixtures__/graphql/user-tweets-valid.json";
import userTweetsOneMalformed from "./__fixtures__/graphql/user-tweets-one-malformed.json";
import userTweetsViewsUnavailable from "./__fixtures__/graphql/user-tweets-views-unavailable.json";
import userTweetsAndRepliesValid from "./__fixtures__/graphql/user-tweets-and-replies-valid.json";
import userTweetsEdgeCases from "./__fixtures__/graphql/user-tweets-edge-cases.json";
import userByScreenNameValid from "./__fixtures__/graphql/user-by-screen-name-valid.json";
import userByScreenNameNoFollowers from "./__fixtures__/graphql/user-by-screen-name-no-followers.json";
import userByScreenNameMalformed from "./__fixtures__/graphql/user-by-screen-name-malformed.json";

const CAPTURED_AT = "2026-06-21T10:00:00.000Z";

// A deep clone helper so we can mutate a copy of a JSON fixture for inline
// edge cases without disturbing the shared imported object.
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// normalizeUserTweets — happy path
// ---------------------------------------------------------------------------

describe("normalizeUserTweets — well-formed UserTweets timeline", () => {
  it("returns three records that each validate against liveCapturedPostSchema", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsValid,
      CAPTURED_AT,
    );

    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(liveCapturedPostSchema.safeParse(post).success).toBe(true);
      expect(post.capturedAt).toBe(CAPTURED_AT);
    }
  });

  it("classifies kinds as original, reply, and repost_reference in timeline order", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsValid,
      CAPTURED_AT,
    );

    const byId = new Map(posts.map((p) => [p.platformPostId, p]));
    expect(byId.get("1700000000000000001")?.kind).toBe("original");
    expect(byId.get("1700000000000000002")?.kind).toBe("reply");
    expect(byId.get("1700000000000000003")?.kind).toBe("repost_reference");
  });

  it("derives reply references and entity flags from the legacy entities block", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsValid,
      CAPTURED_AT,
    );
    const byId = new Map(posts.map((p) => [p.platformPostId, p]));

    const reply = byId.get("1700000000000000002");
    expect(reply?.replyReferences.inReplyToPostId).toBe("1699999999999999999");
    expect(reply?.replyReferences.inReplyToUserId).toBe("987654321");
    expect(reply?.entityFlags.hasUrls).toBe(true);
    expect(reply?.entityFlags.hasMentions).toBe(true);
    expect(reply?.entityFlags.hasHashtags).toBe(false);

    const original = byId.get("1700000000000000001");
    expect(original?.replyReferences).toEqual({});
    expect(original?.entityFlags).toEqual({
      hasUrls: false,
      hasMedia: false,
      hasHashtags: false,
      hasMentions: false,
    });

    const repost = byId.get("1700000000000000003");
    expect(repost?.entityFlags.hasHashtags).toBe(true);
    expect(repost?.entityFlags.hasMedia).toBe(true);
  });

  it("parses views.count strings into integer impression counts", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsValid,
      CAPTURED_AT,
    );
    const byId = new Map(posts.map((p) => [p.platformPostId, p]));

    expect(byId.get("1700000000000000001")?.liveMetrics.impressions).toBe(48211);
    expect(byId.get("1700000000000000002")?.liveMetrics.impressions).toBe(3120);
    // Third tweet has no views block at all -> impressions omitted.
    expect(byId.get("1700000000000000003")?.liveMetrics.impressions).toBeUndefined();
  });

  it("maps the remaining engagement counters", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsValid,
      CAPTURED_AT,
    );
    const original = posts.find((p) => p.platformPostId === "1700000000000000001");

    expect(original?.liveMetrics.likes).toBe(128);
    expect(original?.liveMetrics.reposts).toBe(14);
    expect(original?.liveMetrics.replies).toBe(9);
    expect(original?.liveMetrics.quotes).toBe(2);
    expect(original?.liveMetrics.bookmarks).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// normalizeUserTweets — UserTweetsAndReplies (same shape, second operation)
// ---------------------------------------------------------------------------

describe("normalizeUserTweets — UserTweetsAndReplies timeline", () => {
  it("normalizes the with-replies operation shape and keeps replies to other authors", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsAndRepliesValid,
      CAPTURED_AT,
    );

    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(liveCapturedPostSchema.safeParse(post).success).toBe(true);
    }

    const reply = posts.find((p) => p.platformPostId === "1700000000000000032");
    expect(reply?.kind).toBe("reply");
    expect(reply?.replyReferences.inReplyToUserId).toBe("555000111");
  });
});

// ---------------------------------------------------------------------------
// normalizeUserTweets — tolerate-and-skip
// ---------------------------------------------------------------------------

describe("normalizeUserTweets — tolerate-and-skip per entry", () => {
  it("skips the entry with legacy: null and returns the two well-formed records without throwing", () => {
    let posts: LiveCapturedPost[] = [];
    expect(() => {
      posts = XGraphQlNormalizer.normalizeUserTweets(userTweetsOneMalformed, CAPTURED_AT);
    }).not.toThrow();

    expect(posts).toHaveLength(2);
    const ids = posts.map((p) => p.platformPostId).sort();
    expect(ids).toEqual(["1700000000000000011", "1700000000000000013"]);
    for (const post of posts) {
      expect(liveCapturedPostSchema.safeParse(post).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeUserTweets — views unavailable
// ---------------------------------------------------------------------------

describe("normalizeUserTweets — views.count unavailable", () => {
  it("omits impressions for every record when views.count is the string 'unavailable'", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsViewsUnavailable,
      CAPTURED_AT,
    );

    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.liveMetrics.impressions).toBeUndefined();
      expect(post.liveMetrics).not.toHaveProperty("impressions");
      expect(liveCapturedPostSchema.safeParse(post).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeUserTweets — invalid top-level shapes
// ---------------------------------------------------------------------------

describe("normalizeUserTweets — invalid top-level input", () => {
  it("returns an empty array for an empty object without throwing", () => {
    expect(() => XGraphQlNormalizer.normalizeUserTweets({}, CAPTURED_AT)).not.toThrow();
    expect(XGraphQlNormalizer.normalizeUserTweets({}, CAPTURED_AT)).toEqual([]);
  });

  it("returns an empty array for null without throwing", () => {
    expect(() => XGraphQlNormalizer.normalizeUserTweets(null, CAPTURED_AT)).not.toThrow();
    expect(XGraphQlNormalizer.normalizeUserTweets(null, CAPTURED_AT)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeUserTweets — edge cases
// ---------------------------------------------------------------------------

describe("normalizeUserTweets — edge cases", () => {
  it("keeps views.count '0' as a real zero-impression value, not undefined", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsEdgeCases,
      CAPTURED_AT,
    );
    const zeroViews = posts.find((p) => p.platformPostId === "1700000000000000041");

    expect(zeroViews).toBeDefined();
    expect(zeroViews?.liveMetrics.impressions).toBe(0);
  });

  it("maps favorite_count: 0 to likes: 0 but omits likes when favorite_count is absent", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsEdgeCases,
      CAPTURED_AT,
    );
    const byId = new Map(posts.map((p) => [p.platformPostId, p]));

    const zeroLikes = byId.get("1700000000000000041");
    expect(zeroLikes?.liveMetrics.likes).toBe(0);

    const noLikes = byId.get("1700000000000000042");
    expect(noLikes?.liveMetrics.likes).toBeUndefined();
    expect(noLikes?.liveMetrics).not.toHaveProperty("likes");
  });

  it("skips a tweet whose created_at cannot be parsed into a date", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsEdgeCases,
      CAPTURED_AT,
    );

    expect(posts.some((p) => p.platformPostId === "1700000000000000043")).toBe(false);
  });

  it("prefers repost_reference when a retweet structure and a non-null reply id coexist", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsEdgeCases,
      CAPTURED_AT,
    );
    const both = posts.find((p) => p.platformPostId === "1700000000000000044");

    expect(both?.kind).toBe("repost_reference");
  });

  it("deduplicates a repeated platformPostId, keeping the last occurrence", () => {
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsEdgeCases,
      CAPTURED_AT,
    );
    const duplicates = posts.filter((p) => p.platformPostId === "1700000000000000099");

    expect(duplicates).toHaveLength(1);
    // Last occurrence (organic slot) wins: favorite_count 42, views 9999.
    expect(duplicates[0]?.liveMetrics.likes).toBe(42);
    expect(duplicates[0]?.liveMetrics.impressions).toBe(9999);
  });

  it("skips a tweet whose full_text exceeds 8000 characters instead of truncating", () => {
    // Deep clone the valid fixture, then walk to the first tweet's legacy block
    // and overwrite full_text with an over-limit string. Navigated structurally
    // (no `any`) so the mutation survives strict typechecking.
    const oversized = clone(userTweetsValid) as {
      data: {
        user: {
          result: {
            timeline_v2: {
              timeline: {
                instructions: Array<{
                  type: string;
                  entries?: Array<{
                    content: {
                      itemContent: {
                        tweet_results: { result: { legacy: { full_text: string } } };
                      };
                    };
                  }>;
                }>;
              };
            };
          };
        };
      };
    };

    const addEntries = oversized.data.user.result.timeline_v2.timeline.instructions.find(
      (instruction) => instruction.type === "TimelineAddEntries",
    );
    const firstEntry = addEntries?.entries?.[0];
    expect(firstEntry).toBeDefined();
    if (!firstEntry) throw new Error("Expected a first timeline entry to mutate.");
    firstEntry.content.itemContent.tweet_results.result.legacy.full_text = "x".repeat(8_001);

    const baseline: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      userTweetsValid,
      CAPTURED_AT,
    );
    const posts: LiveCapturedPost[] = XGraphQlNormalizer.normalizeUserTweets(
      oversized,
      CAPTURED_AT,
    );

    expect(posts).toHaveLength(baseline.length - 1);
    expect(posts.some((p) => p.platformPostId === "1700000000000000001")).toBe(false);
    for (const post of posts) {
      expect(liveCapturedPostSchema.safeParse(post).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeUserProfile
// ---------------------------------------------------------------------------

describe("normalizeUserProfile", () => {
  it("returns a profile that validates against liveCapturedProfileSchema with an integer follower count", () => {
    const profile: LiveCapturedProfile | undefined = XGraphQlNormalizer.normalizeUserProfile(
      userByScreenNameValid,
      CAPTURED_AT,
    );

    expect(profile).toBeDefined();
    expect(liveCapturedProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile?.platformUserId).toBe("44196397");
    expect(profile?.screenName).toBe("indie_hacker");
    expect(typeof profile?.followers).toBe("number");
    expect(Number.isInteger(profile?.followers)).toBe(true);
    expect(profile?.followers).toBeGreaterThanOrEqual(0);
    expect(profile?.capturedAt).toBe(CAPTURED_AT);
  });

  it("omits followers when followers_count is absent", () => {
    const profile: LiveCapturedProfile | undefined = XGraphQlNormalizer.normalizeUserProfile(
      userByScreenNameNoFollowers,
      CAPTURED_AT,
    );

    expect(profile).toBeDefined();
    expect(profile?.followers).toBeUndefined();
    expect(profile).not.toHaveProperty("followers");
    expect(liveCapturedProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("returns undefined for a malformed result with no legacy block, without throwing", () => {
    let profile: LiveCapturedProfile | undefined;
    expect(() => {
      profile = XGraphQlNormalizer.normalizeUserProfile(userByScreenNameMalformed, CAPTURED_AT);
    }).not.toThrow();
    expect(profile).toBeUndefined();
  });

  it("returns undefined for null input without throwing", () => {
    expect(() => XGraphQlNormalizer.normalizeUserProfile(null, CAPTURED_AT)).not.toThrow();
    expect(XGraphQlNormalizer.normalizeUserProfile(null, CAPTURED_AT)).toBeUndefined();
  });
});
