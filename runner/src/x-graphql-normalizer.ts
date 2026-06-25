/**
 * XGraphQlNormalizer — pure, stateless transform of already-fetched X (Twitter)
 * GraphQL response objects into capture DTOs (`LiveCapturedPost` /
 * `LiveCapturedProfile`).
 *
 * Zero-trace: no network, no GraphQL construction, no DOM, no persistence, no
 * operation-name URL filtering. The caller (GraphQlCaptureObserver, XOB-017)
 * passes in an already-parsed response body; this module never throws to that
 * caller — per-entry failures are tolerated-and-skipped.
 *
 * The single `unknown` input boundary is narrowed with hand-written type guards;
 * there are no `any` escapes past that boundary.
 */

import {
  liveCapturedPostSchema,
  liveCapturedProfileSchema,
  type LiveCapturedPost,
  type LiveCapturedProfile,
} from "@x-builder/shared";

const MAX_POST_ID_LENGTH = 160;
const MAX_TEXT_LENGTH = 8_000;

// --- Defensive narrowing helpers ------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Reads a property off an unknown value without assuming it is an object. */
function prop(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** True when an unknown value is a non-empty array (used for entity flags). */
function hasItems(value: unknown): boolean {
  return isArray(value) && value.length > 0;
}

/** True when a value is a non-null, non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Parses a metric counter that is already a JS number in the payload
 * (favorite_count, retweet_count, ...). Returns `undefined` when the field is
 * absent or not a valid non-negative integer — distinguishing "absent" (omit)
 * from a genuine `0` (kept). A literal `0` is a valid non-negative integer and
 * is therefore returned as `0`.
 */
function parseCounter(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * Parses `tweet.views.count`, which the API serialises as a *string*. Returns
 * `undefined` for absent / null / "unavailable" / non-numeric / NaN / negative
 * values, and a non-negative integer otherwise. The string `"0"` is a real
 * zero-views value and is KEPT as `0` (not lumped with the sentinels).
 */
function parseImpressions(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  // Reject anything that is not strictly an integer literal so that
  // "12abc" / "unavailable" / "" never slip through parseInt's lenient prefix
  // matching.
  if (!/^\d+$/.test(value.trim())) return undefined;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return undefined;
  return parsed;
}

// --- Tweet → LiveCapturedPost ----------------------------------------------

interface EntityFlags {
  hasUrls: boolean;
  hasMedia: boolean;
  hasHashtags: boolean;
  hasMentions: boolean;
}

function buildEntityFlags(legacy: unknown): EntityFlags {
  const entities = prop(legacy, "entities");
  const extendedEntities = prop(legacy, "extended_entities");
  return {
    hasUrls: hasItems(prop(entities, "urls")),
    hasMedia:
      hasItems(prop(entities, "media")) || hasItems(prop(extendedEntities, "media")),
    hasHashtags: hasItems(prop(entities, "hashtags")),
    hasMentions: hasItems(prop(entities, "user_mentions")),
  };
}

function buildReplyReferences(legacy: unknown): {
  inReplyToPostId?: string;
  inReplyToUserId?: string;
} {
  const references: { inReplyToPostId?: string; inReplyToUserId?: string } = {};
  const inReplyToPostId = prop(legacy, "in_reply_to_status_id_str");
  const inReplyToUserId = prop(legacy, "in_reply_to_user_id_str");
  if (isNonEmptyString(inReplyToPostId)) {
    references.inReplyToPostId = inReplyToPostId;
  }
  if (isNonEmptyString(inReplyToUserId)) {
    references.inReplyToUserId = inReplyToUserId;
  }
  return references;
}

function buildLiveMetrics(tweet: unknown, legacy: unknown): {
  impressions?: number;
  likes?: number;
  reposts?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
} {
  const metrics: {
    impressions?: number;
    likes?: number;
    reposts?: number;
    replies?: number;
    quotes?: number;
    bookmarks?: number;
  } = {};

  const likes = parseCounter(prop(legacy, "favorite_count"));
  if (likes !== undefined) metrics.likes = likes;

  const reposts = parseCounter(prop(legacy, "retweet_count"));
  if (reposts !== undefined) metrics.reposts = reposts;

  const replies = parseCounter(prop(legacy, "reply_count"));
  if (replies !== undefined) metrics.replies = replies;

  const quotes = parseCounter(prop(legacy, "quote_count"));
  if (quotes !== undefined) metrics.quotes = quotes;

  const bookmarks = parseCounter(prop(legacy, "bookmark_count"));
  if (bookmarks !== undefined) metrics.bookmarks = bookmarks;

  const impressions = parseImpressions(prop(prop(tweet, "views"), "count"));
  if (impressions !== undefined) metrics.impressions = impressions;

  return metrics;
}

/** Retweet precedence: a present retweet structure wins over a reply id. */
function classifyKind(legacy: unknown): LiveCapturedPost["kind"] {
  if (prop(legacy, "retweeted_status_result") !== undefined) {
    return "repost_reference";
  }
  if (isNonEmptyString(prop(legacy, "in_reply_to_status_id_str"))) {
    return "reply";
  }
  return "original";
}

/**
 * Builds and schema-validates a single post. Throws on any unrecoverable
 * condition (missing fields, type errors, invalid date, oversized text, schema
 * failure) so the caller's try/catch can tolerate-and-skip the entry.
 */
function buildPost(tweetResult: unknown, capturedAt: string): LiveCapturedPost {
  // Unwrap the promoted-tweet `tweet` sub-field wrapper if present.
  const tweet =
    prop(tweetResult, "tweet") !== undefined ? prop(tweetResult, "tweet") : tweetResult;

  const legacy = prop(tweet, "legacy");
  if (!isRecord(legacy)) {
    throw new Error("tweet.legacy missing or not an object");
  }

  const restId = prop(tweet, "rest_id");
  if (typeof restId !== "string" || restId.length === 0 || restId.length > MAX_POST_ID_LENGTH) {
    throw new Error("tweet.rest_id missing or out of bounds");
  }

  const fullText = prop(legacy, "full_text");
  if (typeof fullText !== "string") {
    throw new Error("tweet.legacy.full_text missing or not a string");
  }
  const text = fullText.trim();
  if (text.length < 1 || text.length > MAX_TEXT_LENGTH) {
    // Skip oversized (or empty) text rather than truncating silently.
    throw new Error("tweet.legacy.full_text out of 1..8000 bounds");
  }

  const createdAtRaw = prop(legacy, "created_at");
  if (typeof createdAtRaw !== "string") {
    throw new Error("tweet.legacy.created_at missing or not a string");
  }
  const createdDate = new Date(createdAtRaw);
  if (Number.isNaN(createdDate.getTime())) {
    throw new Error("tweet.legacy.created_at is not a parseable date");
  }

  const candidate = {
    platformPostId: restId,
    text,
    createdAt: createdDate.toISOString(),
    kind: classifyKind(legacy),
    replyReferences: buildReplyReferences(legacy),
    entityFlags: buildEntityFlags(legacy),
    liveMetrics: buildLiveMetrics(tweet, legacy),
    capturedAt,
  };

  // Defensive final gate: the record must satisfy the canonical schema.
  const parsed = liveCapturedPostSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("built post failed liveCapturedPostSchema");
  }
  return parsed.data;
}

// --- Timeline walk ----------------------------------------------------------

/**
 * Collects every `tweet_results.result` candidate out of the timeline_v2
 * instructions, tolerating missing intermediate nodes at every hop.
 */
function collectTweetResults(json: unknown): unknown[] {
  const result = prop(prop(prop(json, "data"), "user"), "result");
  // X migrated the profile timeline from `timeline_v2.timeline` to
  // `timeline.timeline`; accept either (newest first), tolerating missing hops.
  const timeline =
    prop(prop(result, "timeline"), "timeline") ?? prop(prop(result, "timeline_v2"), "timeline");
  const instructions = prop(timeline, "instructions");
  if (!isArray(instructions)) return [];

  const results: unknown[] = [];
  for (const instruction of instructions) {
    const type = prop(instruction, "type");
    // Accept both casings of the add-entries instruction; ignore others
    // (TimelineClearCache, TimelinePinEntry, ...).
    if (type !== "TimelineAddEntries" && type !== "timelineAddEntries") {
      continue;
    }
    const entries = prop(instruction, "entries");
    if (!isArray(entries)) continue;

    for (const entry of entries) {
      const result = prop(
        prop(prop(prop(entry, "content"), "itemContent"), "tweet_results"),
        "result",
      );
      if (result !== undefined) {
        results.push(result);
      }
    }
  }
  return results;
}

// --- Public API -------------------------------------------------------------

export const XGraphQlNormalizer = {
  /**
   * Normalises a `UserTweets` / `UserTweetsAndReplies` GraphQL response into a
   * list of `LiveCapturedPost`. Never throws; malformed entries are skipped.
   * Deduplicates by `platformPostId` (last occurrence wins).
   */
  normalizeUserTweets(json: unknown, capturedAt: string): LiveCapturedPost[] {
    const byId = new Map<string, LiveCapturedPost>();

    let candidates: unknown[];
    try {
      candidates = collectTweetResults(json);
    } catch {
      // A failure in the top-level walk yields no posts rather than a throw.
      return [];
    }

    for (const candidate of candidates) {
      try {
        const post = buildPost(candidate, capturedAt);
        // last-wins dedupe: a Map.set on an existing key replaces in place,
        // and Map preserves first-insertion order, so the value is updated
        // while overall ordering stays stable.
        byId.set(post.platformPostId, post);
      } catch {
        // Tolerate-and-skip: a single debug line, never console.error, never
        // rethrow. (Intentionally low-volume; the observer aggregates context.)
        console.debug("[XGraphQlNormalizer] skipped a malformed tweet entry");
      }
    }

    return Array.from(byId.values());
  },

  /**
   * Normalises a `UserByScreenName` GraphQL response into a
   * `LiveCapturedProfile`, or `undefined` when the profile is unrecoverable.
   * Never throws.
   */
  normalizeUserProfile(json: unknown, capturedAt: string): LiveCapturedProfile | undefined {
    try {
      const result = prop(prop(prop(json, "data"), "user"), "result");
      const legacy = prop(result, "legacy");
      const core = prop(result, "core");

      const platformUserId = prop(result, "rest_id");
      // X migrated identity fields (screen_name, name) out of `legacy` into
      // `core`; read `core` first and fall back to `legacy` for older shapes.
      // followers_count remains under `legacy`.
      const screenName = prop(core, "screen_name") ?? prop(legacy, "screen_name");

      if (typeof platformUserId !== "string" || typeof screenName !== "string") {
        return undefined;
      }

      const candidate: {
        platformUserId: string;
        screenName: string;
        followers?: number;
        capturedAt: string;
      } = {
        platformUserId,
        screenName,
        capturedAt,
      };

      const followers = parseCounter(prop(legacy, "followers_count"));
      if (followers !== undefined) {
        candidate.followers = followers;
      }

      const parsed = liveCapturedProfileSchema.safeParse(candidate);
      if (!parsed.success) {
        return undefined;
      }
      return parsed.data;
    } catch {
      return undefined;
    }
  },
} as const;
