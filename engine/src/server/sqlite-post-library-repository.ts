import type {
  ActiveArchiveContext,
  ArchiveImportRun,
  LiveCapturedProfile,
} from "@x-builder/shared";
import { z } from "zod";

import type Database from "better-sqlite3";

import {
  toCanonicalOwnPost,
  toMetricObsRow,
  toPostRow,
  toSourceRefRow,
  type MetricObsRow,
  type PostRow,
  type SourceRefRow,
} from "./post-row-mapping.js";
import {
  canonicalOwnPostInputSchema,
  canonicalOwnPostSchema,
  postLibraryStoreSchema,
  PostLibraryStorageError,
  type ArchiveDerivedInsightSnapshot,
  type CanonicalOwnPost,
  type CanonicalOwnPostInput,
  type LiveProfileSnapshot,
  type MetricSnapshot,
  type PostLibraryRepository,
  type PostLibraryStore,
  type PostLibraryWriteResult,
  type SourceRef,
} from "./post-library-repository.js";

type DatabaseHandle = Database.Database;

const nowIso = (): string => new Date().toISOString();

const stableJson = (value: unknown): string => JSON.stringify(value);

// The post-library dedup helpers — these define the dedup identities the
// composite primary keys reproduce.
const uniqueBy = <T>(items: T[], keyFor: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = keyFor(item);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
};

const snapshotKey = (snapshot: MetricSnapshot): string =>
  snapshot.source === "archive_tweets_js"
    ? [snapshot.source, snapshot.observedAt, snapshot.importedAt].join(":")
    : [snapshot.source, snapshot.capturedAt].join(":");

const sourceRefKey = (ref: SourceRef): string =>
  ref.source === "archive_tweets_js"
    ? [ref.source, ref.importRunId, ref.rawId, ref.sourceHash].join(":")
    : [ref.source, ref.captureSessionId, ref.rawId].join(":");

const postKey = (post: Pick<CanonicalOwnPost, "platform" | "platformPostId">): string =>
  `${post.platform}:${post.platformPostId}`;

const mergePost = (previous: CanonicalOwnPost, nextPost: CanonicalOwnPost): CanonicalOwnPost =>
  canonicalOwnPostSchema.parse({
    ...previous,
    ...nextPost,
    metricSnapshots: uniqueBy(
      [...previous.metricSnapshots, ...nextPost.metricSnapshots],
      snapshotKey,
    ),
    sourceRefs: uniqueBy([...previous.sourceRefs, ...nextPost.sourceRefs], sourceRefKey),
  });

// The stored profile-snapshot bounds are tighter than the shared wire schema, so a
// wire-valid value can still violate them; matches the JSON repo's stored schema.
const liveProfileSnapshotInputSchema = z.object({
  platformUserId: z.string().min(1).max(160),
  screenName: z.string().min(1).max(80),
  followers: z.number().int().min(0).optional(),
  capturedAt: z.string().datetime(),
});

export class SqlitePostLibraryRepository implements PostLibraryRepository {
  constructor(private readonly db: DatabaseHandle) {}

  async loadStore(): Promise<PostLibraryStore> {
    const posts = this.readAllPosts();
    const profileSnapshots = this.readProfileSnapshots();
    const importRuns = this.readImportRuns();
    const derivedInsights = this.readDerivedInsights();
    const activeContext = this.readActiveContext();

    return postLibraryStoreSchema.parse({
      schemaVersion: 2,
      updatedAt: nowIso(),
      posts,
      importRuns,
      derivedInsights,
      activeContext,
      profileSnapshots,
    });
  }

  async upsertPosts(posts: CanonicalOwnPostInput[]): Promise<PostLibraryWriteResult> {
    const result: PostLibraryWriteResult = {
      insertedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
    };

    this.db.transaction(() => {
      const seenInputKeys = new Set<string>();

      for (const rawPost of posts) {
        const parsedInput = canonicalOwnPostInputSchema.parse(rawPost);
        const updatedAt = nowIso();
        const nextPost = canonicalOwnPostSchema.parse({
          ...parsedInput,
          updatedAt: parsedInput.updatedAt ?? updatedAt,
        });
        const key = postKey(nextPost);
        const existing = this.readPostByPlatformKey(nextPost.platformPostId);

        if (seenInputKeys.has(key)) {
          result.duplicateCount += 1;
        }
        seenInputKeys.add(key);

        if (!existing) {
          this.writePost(nextPost);
          result.insertedCount += 1;
          continue;
        }

        const merged = mergePost(existing, { ...nextPost, updatedAt });

        if (stableJson(existing) === stableJson(merged)) {
          result.unchangedCount += 1;
          continue;
        }

        this.writePost(merged);
        result.updatedCount += 1;
      }
    })();

    return result;
  }

  async saveImportRun(importRun: ArchiveImportRun): Promise<void> {
    this.db
      .prepare("INSERT INTO import_run (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload")
      .run(importRun.id, stableJson(importRun));
  }

  async saveDerivedInsights(snapshot: ArchiveDerivedInsightSnapshot): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO derived_insight (import_run_id, generated_at, payload) VALUES (?, ?, ?) ON CONFLICT(import_run_id) DO UPDATE SET generated_at = excluded.generated_at, payload = excluded.payload",
      )
      .run(snapshot.importRunId, snapshot.generatedAt, stableJson(snapshot));
  }

  async setActiveContext(context: ActiveArchiveContext): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO active_context (singleton, payload) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET payload = excluded.payload",
      )
      .run(stableJson(context));
  }

  async pushProfileSnapshot(snapshot: LiveCapturedProfile): Promise<void> {
    let parsed: LiveProfileSnapshot;

    try {
      parsed = liveProfileSnapshotInputSchema.parse(snapshot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new PostLibraryStorageError(
          "Live profile snapshot does not satisfy the stored bounds.",
          error,
        );
      }

      throw error;
    }

    this.db
      .prepare(
        "INSERT INTO profile_snapshot (platform_user_id, screen_name, followers, captured_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        parsed.platformUserId,
        parsed.screenName,
        parsed.followers ?? null,
        parsed.capturedAt,
      );
  }

  private writePost(post: CanonicalOwnPost): void {
    const postRow = toPostRow(post);

    // Re-write the merged post from scratch keyed on the stable platform_post_id.
    // Deleting first cascades the post's metric_obs / source_ref rows away, so the
    // re-insert below repopulates them from the merged (deduped) arrays — and a
    // re-keyed post.id never orphans the old source_ref rows against its FK.
    this.db
      .prepare("DELETE FROM post WHERE platform_post_id = ?")
      .run(post.platformPostId);

    this.db
      .prepare(
        `INSERT INTO post (
          id, platform, platform_post_id, logical_post_id, text, created_at, kind, language,
          in_reply_to_post_id, in_reply_to_user_id, has_urls, has_media, has_hashtags, has_mentions,
          weak_favorite_count, weak_retweet_count, content_hash, normalized_text_hash, updated_at
        ) VALUES (
          @id, @platform, @platform_post_id, @logical_post_id, @text, @created_at, @kind, @language,
          @in_reply_to_post_id, @in_reply_to_user_id, @has_urls, @has_media, @has_hashtags, @has_mentions,
          @weak_favorite_count, @weak_retweet_count, @content_hash, @normalized_text_hash, @updated_at
        )`,
      )
      .run(postRow);

    const insertMetric = this.db.prepare(
      `INSERT INTO metric_obs (
        tweet_id, source, observed_at, imported_at, impressions, likes, reposts, replies, quotes,
        bookmarks, favorite_count, retweet_count, content_hash
      ) VALUES (
        @tweet_id, @source, @observed_at, @imported_at, @impressions, @likes, @reposts, @replies,
        @quotes, @bookmarks, @favorite_count, @retweet_count, @content_hash
      )
      ON CONFLICT(tweet_id, source, observed_at, imported_at) DO NOTHING`,
    );

    for (const snapshot of uniqueBy(post.metricSnapshots, snapshotKey)) {
      insertMetric.run(toMetricObsRow(post.platformPostId, snapshot));
    }

    const insertSourceRef = this.db.prepare(
      `INSERT INTO source_ref (
        post_id, source, import_run_id, source_hash, capture_session_id, raw_id
      ) VALUES (
        @post_id, @source, @import_run_id, @source_hash, @capture_session_id, @raw_id
      )
      ON CONFLICT(post_id, source, import_run_id, source_hash, capture_session_id, raw_id) DO NOTHING`,
    );

    for (const ref of uniqueBy(post.sourceRefs, sourceRefKey)) {
      insertSourceRef.run(toSourceRefRow(post.id, ref));
    }
  }

  private readPostByPlatformKey(platformPostId: string): CanonicalOwnPost | undefined {
    const postRow = this.db
      .prepare("SELECT * FROM post WHERE platform_post_id = ?")
      .get(platformPostId) as PostRow | undefined;

    if (!postRow) {
      return undefined;
    }

    return this.assemblePost(postRow);
  }

  private readAllPosts(): CanonicalOwnPost[] {
    const postRows = this.db
      .prepare("SELECT * FROM post ORDER BY created_at DESC, id ASC")
      .all() as PostRow[];

    return postRows.map((row) => this.assemblePost(row));
  }

  private assemblePost(postRow: PostRow): CanonicalOwnPost {
    const metricRows = this.db
      .prepare("SELECT * FROM metric_obs WHERE tweet_id = ? ORDER BY rowid ASC")
      .all(postRow.platform_post_id) as MetricObsRow[];
    const sourceRefRows = this.db
      .prepare("SELECT * FROM source_ref WHERE post_id = ? ORDER BY rowid ASC")
      .all(postRow.id) as SourceRefRow[];

    return toCanonicalOwnPost(postRow, metricRows, sourceRefRows);
  }

  private readProfileSnapshots(): LiveProfileSnapshot[] {
    const rows = this.db
      .prepare(
        "SELECT platform_user_id, screen_name, followers, captured_at FROM profile_snapshot ORDER BY id ASC",
      )
      .all() as Array<{
      platform_user_id: string;
      screen_name: string;
      followers: number | null;
      captured_at: string;
    }>;

    return rows.map((row) => ({
      platformUserId: row.platform_user_id,
      screenName: row.screen_name,
      ...(row.followers === null ? {} : { followers: row.followers }),
      capturedAt: row.captured_at,
    }));
  }

  private readImportRuns(): ArchiveImportRun[] {
    const rows = this.db
      .prepare("SELECT payload FROM import_run ORDER BY id ASC")
      .all() as Array<{ payload: string }>;

    return rows.map((row) => JSON.parse(row.payload) as ArchiveImportRun);
  }

  private readDerivedInsights(): ArchiveDerivedInsightSnapshot[] {
    const rows = this.db
      .prepare("SELECT payload FROM derived_insight ORDER BY import_run_id ASC")
      .all() as Array<{ payload: string }>;

    return rows.map((row) => JSON.parse(row.payload) as ArchiveDerivedInsightSnapshot);
  }

  private readActiveContext(): ActiveArchiveContext {
    const row = this.db
      .prepare("SELECT payload FROM active_context WHERE singleton = 1")
      .get() as { payload: string } | undefined;

    if (!row) {
      return { status: "empty" };
    }

    return JSON.parse(row.payload) as ActiveArchiveContext;
  }
}
