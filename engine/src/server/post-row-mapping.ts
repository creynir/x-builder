import { createHash } from "node:crypto";

import type {
  CanonicalOwnPost,
  MetricSnapshot,
  SourceRef,
} from "./post-library-repository.js";
import { generatedReplyContentHash } from "../generated-replies/normalize-generated-reply.js";

// The single module that knows the SQLite column layout. It shreds a
// CanonicalOwnPost into post / metric_obs / source_ref rows (computing the
// storage-internal content_hash at write) and reconstructs a CanonicalOwnPost
// from those rows. The '' sentinel columns reconstruct to absent fields, never
// empty strings; NULL optional numeric columns reconstruct to absent.

export type PostRow = {
  id: string;
  platform: string;
  platform_post_id: string;
  logical_post_id: string;
  text: string;
  created_at: string;
  kind: string;
  language: string | null;
  in_reply_to_post_id: string | null;
  in_reply_to_user_id: string | null;
  has_urls: number;
  has_media: number;
  has_hashtags: number;
  has_mentions: number;
  weak_favorite_count: number | null;
  weak_retweet_count: number | null;
  content_hash: string;
  normalized_text_hash: string;
  updated_at: string;
};

export type MetricObsRow = {
  tweet_id: string;
  source: string;
  observed_at: string;
  imported_at: string;
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  favorite_count: number | null;
  retweet_count: number | null;
  content_hash: string;
};

export type SourceRefRow = {
  post_id: string;
  source: string;
  import_run_id: string;
  source_hash: string;
  capture_session_id: string;
  raw_id: string;
};

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const boolToInt = (value: boolean): number => (value ? 1 : 0);

const intToBool = (value: number): boolean => value !== 0;

const optionalNumber = (value: number | null | undefined): number | null =>
  value === undefined || value === null ? null : value;

// Deterministic over the canonical content fields, so an unchanged re-write
// produces an identical hash (and a no-op merge). updatedAt is excluded — it is
// stamped nowIso() at save and is not part of post identity/content.
export const postContentHash = (post: CanonicalOwnPost): string =>
  sha256(
    JSON.stringify([
      post.platform,
      post.platformPostId,
      post.text,
      post.createdAt,
      post.kind,
      post.language ?? null,
      post.replyReferences.inReplyToPostId ?? null,
      post.replyReferences.inReplyToUserId ?? null,
      post.entityFlags.hasUrls,
      post.entityFlags.hasMedia,
      post.entityFlags.hasHashtags,
      post.entityFlags.hasMentions,
      post.weakMetrics.favoriteCount ?? null,
      post.weakMetrics.retweetCount ?? null,
    ]),
  );

const snapshotContentHash = (snapshot: MetricSnapshot): string =>
  sha256(JSON.stringify(snapshot));

export const toPostRow = (post: CanonicalOwnPost): PostRow => ({
  id: post.id,
  platform: post.platform,
  platform_post_id: post.platformPostId,
  logical_post_id: post.platformPostId,
  text: post.text,
  created_at: post.createdAt,
  kind: post.kind,
  language: post.language ?? null,
  in_reply_to_post_id: post.replyReferences.inReplyToPostId ?? null,
  in_reply_to_user_id: post.replyReferences.inReplyToUserId ?? null,
  has_urls: boolToInt(post.entityFlags.hasUrls),
  has_media: boolToInt(post.entityFlags.hasMedia),
  has_hashtags: boolToInt(post.entityFlags.hasHashtags),
  has_mentions: boolToInt(post.entityFlags.hasMentions),
  weak_favorite_count: optionalNumber(post.weakMetrics.favoriteCount),
  weak_retweet_count: optionalNumber(post.weakMetrics.retweetCount),
  content_hash: postContentHash(post),
  normalized_text_hash: generatedReplyContentHash(post.text),
  updated_at: post.updatedAt,
});

export const toMetricObsRow = (
  platformPostId: string,
  snapshot: MetricSnapshot,
): MetricObsRow => {
  if (snapshot.source === "archive_tweets_js") {
    return {
      tweet_id: platformPostId,
      source: snapshot.source,
      observed_at: snapshot.observedAt,
      imported_at: snapshot.importedAt,
      impressions: null,
      likes: null,
      reposts: null,
      replies: null,
      quotes: null,
      bookmarks: null,
      favorite_count: optionalNumber(snapshot.favoriteCount),
      retweet_count: optionalNumber(snapshot.retweetCount),
      content_hash: snapshotContentHash(snapshot),
    };
  }

  return {
    tweet_id: platformPostId,
    source: snapshot.source,
    observed_at: snapshot.capturedAt,
    imported_at: "",
    impressions: optionalNumber(snapshot.impressions),
    likes: optionalNumber(snapshot.likes),
    reposts: optionalNumber(snapshot.reposts),
    replies: optionalNumber(snapshot.replies),
    quotes: optionalNumber(snapshot.quotes),
    bookmarks: optionalNumber(snapshot.bookmarks),
    favorite_count: null,
    retweet_count: null,
    content_hash: snapshotContentHash(snapshot),
  };
};

export const toSourceRefRow = (postId: string, ref: SourceRef): SourceRefRow => {
  if (ref.source === "archive_tweets_js") {
    return {
      post_id: postId,
      source: ref.source,
      import_run_id: ref.importRunId,
      source_hash: ref.sourceHash,
      capture_session_id: "",
      raw_id: ref.rawId,
    };
  }

  return {
    post_id: postId,
    source: ref.source,
    import_run_id: "",
    source_hash: "",
    capture_session_id: ref.captureSessionId,
    raw_id: ref.rawId,
  };
};

const metricSnapshotFromRow = (row: MetricObsRow): MetricSnapshot => {
  if (row.source === "archive_tweets_js") {
    return {
      source: "archive_tweets_js",
      observedAt: row.observed_at,
      importedAt: row.imported_at,
      ...(row.favorite_count === null ? {} : { favoriteCount: row.favorite_count }),
      ...(row.retweet_count === null ? {} : { retweetCount: row.retweet_count }),
    };
  }

  return {
    source: "x_live_capture",
    capturedAt: row.observed_at,
    ...(row.impressions === null ? {} : { impressions: row.impressions }),
    ...(row.likes === null ? {} : { likes: row.likes }),
    ...(row.reposts === null ? {} : { reposts: row.reposts }),
    ...(row.replies === null ? {} : { replies: row.replies }),
    ...(row.quotes === null ? {} : { quotes: row.quotes }),
    ...(row.bookmarks === null ? {} : { bookmarks: row.bookmarks }),
  };
};

const sourceRefFromRow = (row: SourceRefRow): SourceRef => {
  if (row.source === "archive_tweets_js") {
    return {
      source: "archive_tweets_js",
      importRunId: row.import_run_id,
      rawId: row.raw_id,
      sourceHash: row.source_hash,
    };
  }

  return {
    source: "x_live_capture",
    captureSessionId: row.capture_session_id,
    rawId: row.raw_id,
  };
};

export const toCanonicalOwnPost = (
  row: PostRow,
  metricRows: MetricObsRow[],
  sourceRefRows: SourceRefRow[],
): CanonicalOwnPost => ({
  id: row.id,
  platform: "x",
  platformPostId: row.platform_post_id,
  text: row.text,
  createdAt: row.created_at,
  kind: row.kind as CanonicalOwnPost["kind"],
  ...(row.language === null ? {} : { language: row.language }),
  replyReferences: {
    ...(row.in_reply_to_post_id === null ? {} : { inReplyToPostId: row.in_reply_to_post_id }),
    ...(row.in_reply_to_user_id === null ? {} : { inReplyToUserId: row.in_reply_to_user_id }),
  },
  entityFlags: {
    hasUrls: intToBool(row.has_urls),
    hasMedia: intToBool(row.has_media),
    hasHashtags: intToBool(row.has_hashtags),
    hasMentions: intToBool(row.has_mentions),
  },
  weakMetrics: {
    ...(row.weak_favorite_count === null ? {} : { favoriteCount: row.weak_favorite_count }),
    ...(row.weak_retweet_count === null ? {} : { retweetCount: row.weak_retweet_count }),
  },
  metricSnapshots: metricRows.map(metricSnapshotFromRow),
  sourceRefs: sourceRefRows.map(sourceRefFromRow),
  updatedAt: row.updated_at,
});
