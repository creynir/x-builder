import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

import type Database from "better-sqlite3";

import {
  toMetricObsRow,
  toPostRow,
  toSourceRefRow,
} from "./post-row-mapping.js";
import {
  PostLibraryStorageError,
  postLibraryFileName,
  postLibraryStoreSchema,
  upgradePostLibraryStoreToV2,
} from "./post-library-repository.js";

type DatabaseHandle = Database.Database;

const migratedFileName = "post-library.json.migrated";

// The one-time JSON->SQLite importer. SYNCHRONOUS so it runs inline at the
// synchronous engine-database open (better-sqlite3 is sync). It reuses the LPF-002
// post-row-mapping shred (toPostRow / toMetricObsRow / toSourceRefRow, which compute
// content_hash + logical_post_id) and the single-sourced upgradePostLibraryStoreToV2,
// so the imported corpus is byte-faithful to the post-library store on disk.
//
// Guard order keeps it idempotent and safe:
//   1. No post-library.json present -> no-op (nothing to migrate).
//   2. The post table is already non-empty -> no-op (already migrated; never re-import
//      or churn the .migrated rename).
//   3. INSERT OR IGNORE every row inside ONE transaction (a partial prior run with rows
//      but no rename adds nothing on re-run).
//   4. Rename post-library.json -> post-library.json.migrated only after a clean import.
//      The file is moved, NEVER deleted, and a corrupt/too-new file is left in place.
export const importPostLibraryJsonToSqlite = (
  jsonRoot: string,
  db: DatabaseHandle,
): void => {
  const jsonPath = join(jsonRoot, postLibraryFileName);

  // [guard 1] Nothing to migrate.
  if (!existsSync(jsonPath)) {
    return;
  }

  // [guard 2] Already migrated: a populated post table short-circuits before any read
  // or rename, so a re-run (or a fresh JSON dropped beside an existing corpus) is a no-op.
  const postCount = (
    db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
  ).n;
  if (postCount > 0) {
    return;
  }

  // Read + parse + upgrade + validate. Any failure (unreadable file, malformed JSON,
  // schema violation, too-new schemaVersion) throws PostLibraryStorageError BEFORE the
  // rename, leaving the original file untouched.
  let store;
  try {
    const contents = readFileSync(jsonPath, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    store = postLibraryStoreSchema.parse(upgradePostLibraryStoreToV2(parsed));
  } catch (error) {
    if (error instanceof PostLibraryStorageError) {
      throw error;
    }

    throw new PostLibraryStorageError(
      "Post library store could not be imported into SQLite.",
      error,
    );
  }

  const insertPost = db.prepare(
    `INSERT OR IGNORE INTO post (
      id, platform, platform_post_id, logical_post_id, text, created_at, kind, language,
      in_reply_to_post_id, in_reply_to_user_id, has_urls, has_media, has_hashtags, has_mentions,
      weak_favorite_count, weak_retweet_count, content_hash, normalized_text_hash, updated_at
    ) VALUES (
      @id, @platform, @platform_post_id, @logical_post_id, @text, @created_at, @kind, @language,
      @in_reply_to_post_id, @in_reply_to_user_id, @has_urls, @has_media, @has_hashtags, @has_mentions,
      @weak_favorite_count, @weak_retweet_count, @content_hash, @normalized_text_hash, @updated_at
    )`,
  );

  const insertMetric = db.prepare(
    `INSERT OR IGNORE INTO metric_obs (
      tweet_id, source, observed_at, imported_at, impressions, likes, reposts, replies, quotes,
      bookmarks, favorite_count, retweet_count, content_hash
    ) VALUES (
      @tweet_id, @source, @observed_at, @imported_at, @impressions, @likes, @reposts, @replies,
      @quotes, @bookmarks, @favorite_count, @retweet_count, @content_hash
    )`,
  );

  const insertSourceRef = db.prepare(
    `INSERT OR IGNORE INTO source_ref (
      post_id, source, import_run_id, source_hash, capture_session_id, raw_id
    ) VALUES (
      @post_id, @source, @import_run_id, @source_hash, @capture_session_id, @raw_id
    )`,
  );

  const insertProfile = db.prepare(
    `INSERT INTO profile_snapshot (platform_user_id, screen_name, followers, captured_at)
     VALUES (?, ?, ?, ?)`,
  );

  const insertImportRun = db.prepare(
    "INSERT OR IGNORE INTO import_run (id, payload) VALUES (?, ?)",
  );

  const insertDerivedInsight = db.prepare(
    "INSERT OR IGNORE INTO derived_insight (import_run_id, generated_at, payload) VALUES (?, ?, ?)",
  );

  const insertActiveContext = db.prepare(
    "INSERT OR IGNORE INTO active_context (singleton, payload) VALUES (1, ?)",
  );

  // [guard 3] One transaction: every row uses INSERT OR IGNORE so a partial prior run
  // (rows present, rename not yet done) adds no duplicates on re-run.
  db.transaction(() => {
    for (const post of store.posts) {
      insertPost.run(toPostRow(post));

      for (const snapshot of post.metricSnapshots) {
        insertMetric.run(toMetricObsRow(post.platformPostId, snapshot));
      }

      for (const ref of post.sourceRefs) {
        insertSourceRef.run(toSourceRefRow(post.id, ref));
      }
    }

    for (const snapshot of store.profileSnapshots) {
      insertProfile.run(
        snapshot.platformUserId,
        snapshot.screenName,
        snapshot.followers ?? null,
        snapshot.capturedAt,
      );
    }

    for (const importRun of store.importRuns) {
      insertImportRun.run(importRun.id, JSON.stringify(importRun));
    }

    for (const insight of store.derivedInsights) {
      insertDerivedInsight.run(
        insight.importRunId,
        insight.generatedAt,
        JSON.stringify(insight),
      );
    }

    // An empty active context reconstructs from an absent row, so only a non-empty
    // context is persisted — matching SqlitePostLibraryRepository.readActiveContext.
    if (store.activeContext.status !== "empty") {
      insertActiveContext.run(JSON.stringify(store.activeContext));
    }
  })();

  // [guard 1 satisfied: file gone after success] Move, never delete.
  renameSync(jsonPath, join(jsonRoot, migratedFileName));
};
