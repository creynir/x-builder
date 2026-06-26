/**
 * Failing tests for the one-time JSON -> SQLite importer and the extracted
 * v1->v2 upgrade function (FND: JSON->SQLite importer + host swap).
 *
 * The modules under test are not authored yet:
 *   - `../import-post-library-json.js` -> `importPostLibraryJsonToSqlite(jsonRoot, db)`
 *   - `../post-library-repository.js`  -> `upgradePostLibraryStoreToV2(raw): unknown`
 * The `upgradePostLibraryStoreToV2` import below resolves to nothing until Green
 * adds the export, and the importer module does not exist at all. Both are the
 * intended Red signal (a missing export / Cannot find module), not a SyntaxError
 * in this test.
 *
 * Isolation: a tmpdir json root (mkdtemp) holds the `post-library.json`, and the
 * database is always an in-memory engine db opened directly via
 * openEngineDatabase(':memory:') or a tmpdir x-builder.db. The user's real
 * ~/.x-builder storage path is never touched.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  JsonFilePostLibraryRepository,
  PostLibraryStorageError,
  postLibraryStoreSchema,
  // Not-yet-exported: the single-sourced v1->v2 upgrade the repository's loadStore
  // and the importer both call. Import fails until Green exports it from the repo.
  upgradePostLibraryStoreToV2,
  type CanonicalOwnPost,
  type PostLibraryStore,
} from "../post-library-repository.js";
import { openEngineDatabase } from "../open-engine-database.js";
import { SqlitePostLibraryRepository } from "../sqlite-post-library-repository.js";
// The not-yet-authored importer module under test (Cannot find module until Green
// ships it).
import { importPostLibraryJsonToSqlite } from "../import-post-library-json.js";

const POST_LIBRARY_FILE = "post-library.json";
const MIGRATED_FILE = "post-library.json.migrated";

const importedAt = "2026-06-16T10:00:00.000Z";
const sourceHash = "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd";

// A canonical post fixture (resolved updatedAt) shaped exactly as the JSON store
// persists it, so a v2 store JSON we write by hand re-parses cleanly.
const canonicalPost = (overrides: Partial<CanonicalOwnPost> = {}): CanonicalOwnPost => ({
  id: "post-1",
  platform: "x",
  platformPostId: "1800000000000000001",
  text: "A compact archive post.",
  createdAt: "2024-01-05T12:00:00.000Z",
  kind: "original",
  language: "en",
  replyReferences: {},
  entityFlags: {
    hasUrls: false,
    hasMedia: false,
    hasHashtags: false,
    hasMentions: false,
  },
  weakMetrics: {
    favoriteCount: 12,
    retweetCount: 3,
  },
  metricSnapshots: [
    {
      source: "archive_tweets_js",
      observedAt: "2024-01-05T12:00:00.000Z",
      importedAt,
      favoriteCount: 12,
      retweetCount: 3,
    },
  ],
  sourceRefs: [
    {
      source: "archive_tweets_js",
      importRunId: "import-1",
      rawId: "1800000000000000001",
      sourceHash,
    },
  ],
  updatedAt: importedAt,
  ...overrides,
});

const importRun = {
  id: "import-1",
  sourceHash,
  assignmentPath: "tweets.js",
  status: "completed" as const,
  counts: {
    totalRecords: 1,
    validPosts: 1,
    skippedRecords: 0,
    originals: 1,
    replies: 0,
    repostReferences: 0,
    insertedPosts: 1,
    updatedPosts: 0,
    unchangedPosts: 0,
  },
  duplicates: {
    duplicateRecords: 0,
    duplicatePlatformPostIds: [],
  },
  warnings: [],
  createdAt: importedAt,
  completedAt: importedAt,
};

const derivedInsightSnapshot = {
  importRunId: "import-1",
  generatedAt: importedAt,
  insights: {
    generatedAt: importedAt,
    counts: { posts: 1, originals: 1, replies: 0, repostReferences: 0 },
    cadence: { postsPerWeek: 1, mostCommonHoursUtc: [12] },
    replyOriginalMix: { originalRatio: 1, replyRatio: 0 },
    repeatStructures: [],
    emotionalAngleRotation: [],
    weakEngagement: {},
    confidence: "low" as const,
  },
};

const activeContext = {
  status: "active" as const,
  sourceImportId: "import-1",
  activatedAt: importedAt,
  scoringContextPatch: {},
  judgeHints: [],
  provenance: "Imported X archive",
  confidence: "low" as const,
  counts: { posts: 1, originals: 1, replies: 0 },
};

const profileSnapshot = {
  platformUserId: "user-123",
  screenName: "founder",
  followers: 980,
  capturedAt: "2026-06-20T08:55:00.000Z",
};

// A full v2 store object as it would sit on disk (every collection populated).
const v2Store = (posts: CanonicalOwnPost[] = [canonicalPost()]): PostLibraryStore =>
  postLibraryStoreSchema.parse({
    schemaVersion: 2,
    updatedAt: importedAt,
    posts,
    importRuns: [importRun],
    derivedInsights: [derivedInsightSnapshot],
    activeContext,
    profileSnapshots: [profileSnapshot],
  });

const writeStoreFile = async (root: string, store: unknown): Promise<void> => {
  await writeFile(join(root, POST_LIBRARY_FILE), `${JSON.stringify(store, null, 2)}\n`, "utf8");
};

const withTempJsonRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-import-json-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

// Drop write-time timestamps before equality. Both repos stamp store.updatedAt and
// each post.updatedAt with nowIso() at save/read time, so they differ by
// construction; everything else stays asserted.
const stripWriteTimestamps = (store: PostLibraryStore): PostLibraryStore => ({
  ...store,
  updatedAt: "<normalized>",
  posts: store.posts.map((post) => ({ ...post, updatedAt: "<normalized>" })),
});

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
};

describe("JSON -> SQLite post-library importer", () => {
  describe("AC1 — a complete v2 store imports every record and the file is renamed", () => {
    it("imports posts, metric_obs, source_ref, profile_snapshot, import_run, derived_insight and active_context rows, then renames the JSON to .migrated", async () => {
      await withTempJsonRoot(async (root) => {
        await writeStoreFile(root, v2Store());
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const postCount = (
          db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
        ).n;
        const metricCount = (
          db.prepare("SELECT COUNT(*) AS n FROM metric_obs").get() as { n: number }
        ).n;
        const sourceRefCount = (
          db.prepare("SELECT COUNT(*) AS n FROM source_ref").get() as { n: number }
        ).n;
        const profileCount = (
          db.prepare("SELECT COUNT(*) AS n FROM profile_snapshot").get() as { n: number }
        ).n;
        const importRunCount = (
          db.prepare("SELECT COUNT(*) AS n FROM import_run").get() as { n: number }
        ).n;
        const insightCount = (
          db.prepare("SELECT COUNT(*) AS n FROM derived_insight").get() as { n: number }
        ).n;
        const activeContextCount = (
          db.prepare("SELECT COUNT(*) AS n FROM active_context").get() as { n: number }
        ).n;

        expect(postCount).toBe(1);
        expect(metricCount).toBe(1);
        expect(sourceRefCount).toBe(1);
        expect(profileCount).toBe(1);
        expect(importRunCount).toBe(1);
        expect(insightCount).toBe(1);
        expect(activeContextCount).toBe(1);

        expect(await fileExists(join(root, POST_LIBRARY_FILE))).toBe(false);
        expect(await fileExists(join(root, MIGRATED_FILE))).toBe(true);
      });
    });

    it("imports faithfully: SQLite loadStore() matches the same file loaded through the JSON repository", async () => {
      await withTempJsonRoot(async (root) => {
        // The JSON repository reads the SAME on-disk file as the parity oracle.
        const jsonRepository = new JsonFilePostLibraryRepository({ root });
        const expectedStore = stripWriteTimestamps(await loadOraclyStore(root, jsonRepository));

        // A second identical file in a separate root feeds the importer, so the
        // oracle's own read does not consume (rename) the importer's input.
        await withTempJsonRoot(async (importRoot) => {
          await writeStoreFile(importRoot, v2Store());
          const db = openEngineDatabase(":memory:");

          importPostLibraryJsonToSqlite(importRoot, db);

          const sqliteStore = stripWriteTimestamps(
            await new SqlitePostLibraryRepository(db).loadStore(),
          );

          expect(sqliteStore).toEqual(expectedStore);
        });
      });
    });

    it("orders the imported posts createdAt DESC then id ASC, matching the JSON repository", async () => {
      await withTempJsonRoot(async (root) => {
        const posts = [
          canonicalPost({ id: "post-older", platformPostId: "10", createdAt: "2024-01-01T00:00:00.000Z" }),
          canonicalPost({ id: "post-newest-b", platformPostId: "11", createdAt: "2024-12-31T00:00:00.000Z" }),
          canonicalPost({ id: "post-newest-a", platformPostId: "12", createdAt: "2024-12-31T00:00:00.000Z" }),
        ];
        await writeStoreFile(root, v2Store(posts));
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const order = (await new SqlitePostLibraryRepository(db).loadStore()).posts.map(
          (post) => post.id,
        );

        expect(order).toEqual(["post-newest-a", "post-newest-b", "post-older"]);
      });
    });
  });

  describe("AC2 — a v1 store is upgraded then imported without error", () => {
    it("defaults profileSnapshots to [] for a schemaVersion:1 file and imports the post", async () => {
      await withTempJsonRoot(async (root) => {
        // A v1 store has no profileSnapshots key and schemaVersion 1.
        const v1 = {
          schemaVersion: 1,
          updatedAt: importedAt,
          posts: [canonicalPost()],
          importRuns: [importRun],
          derivedInsights: [derivedInsightSnapshot],
          activeContext,
        };
        await writeStoreFile(root, v1);
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const store = await new SqlitePostLibraryRepository(db).loadStore();

        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.platformPostId).toBe("1800000000000000001");
        // The absent v1 profileSnapshots defaulted to [].
        expect(store.profileSnapshots).toEqual([]);
        expect(await fileExists(join(root, MIGRATED_FILE))).toBe(true);
      });
    });
  });

  describe("AC3 — no JSON file present is a no-op", () => {
    it("changes no table rows and renames nothing when post-library.json is absent", async () => {
      await withTempJsonRoot(async (root) => {
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const postCount = (
          db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
        ).n;
        const profileCount = (
          db.prepare("SELECT COUNT(*) AS n FROM profile_snapshot").get() as { n: number }
        ).n;

        expect(postCount).toBe(0);
        expect(profileCount).toBe(0);
        expect(await fileExists(join(root, POST_LIBRARY_FILE))).toBe(false);
        expect(await fileExists(join(root, MIGRATED_FILE))).toBe(false);
      });
    });
  });

  describe("AC4 — a corrupt JSON file throws and is NOT renamed", () => {
    it("throws PostLibraryStorageError and leaves the corrupt file in place", async () => {
      await withTempJsonRoot(async (root) => {
        await writeFile(join(root, POST_LIBRARY_FILE), "{ this is not valid json", "utf8");
        const db = openEngineDatabase(":memory:");

        expect(() => importPostLibraryJsonToSqlite(root, db)).toThrow(PostLibraryStorageError);

        // The original is untouched (still present) and no .migrated sibling exists.
        expect(await fileExists(join(root, POST_LIBRARY_FILE))).toBe(true);
        expect(await fileExists(join(root, MIGRATED_FILE))).toBe(false);
        expect(await readFile(join(root, POST_LIBRARY_FILE), "utf8")).toBe(
          "{ this is not valid json",
        );
        // Nothing was inserted before the throw.
        expect((db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }).n).toBe(0);
      });
    });
  });

  describe("AC5 — a too-new schemaVersion throws and is NOT renamed", () => {
    it("throws PostLibraryStorageError for schemaVersion greater than 2 and does not rename", async () => {
      await withTempJsonRoot(async (root) => {
        await writeStoreFile(root, { ...v2Store(), schemaVersion: 3 });
        const db = openEngineDatabase(":memory:");

        expect(() => importPostLibraryJsonToSqlite(root, db)).toThrow(PostLibraryStorageError);

        expect(await fileExists(join(root, POST_LIBRARY_FILE))).toBe(true);
        expect(await fileExists(join(root, MIGRATED_FILE))).toBe(false);
        expect((db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }).n).toBe(0);
      });
    });
  });

  describe("AC6 — idempotent across restart", () => {
    it("inserts nothing and renames nothing on a second run after a successful import", async () => {
      await withTempJsonRoot(async (root) => {
        await writeStoreFile(root, v2Store());
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);
        const afterFirst = (
          db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
        ).n;

        // File is already .migrated and the post table is populated. A second run
        // must be a complete no-op: no extra rows, and no .migrated churn.
        importPostLibraryJsonToSqlite(root, db);
        const afterSecond = (
          db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
        ).n;

        expect(afterFirst).toBe(1);
        expect(afterSecond).toBe(1);
        expect(await fileExists(join(root, MIGRATED_FILE))).toBe(true);
        expect(await fileExists(join(root, POST_LIBRARY_FILE))).toBe(false);
      });
    });

    it("does not double-insert when a fresh post-library.json is present but the post table is already non-empty", async () => {
      await withTempJsonRoot(async (root) => {
        const db = openEngineDatabase(":memory:");
        // Pre-populate the post table through the canonical write path, then place a
        // fresh JSON file with the SAME post. The populated-table guard alone makes
        // the importer a no-op (no second row, no rename).
        await new SqlitePostLibraryRepository(db).upsertPosts([canonicalPost()]);
        await writeStoreFile(root, v2Store());

        importPostLibraryJsonToSqlite(root, db);

        const postCount = (
          db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
        ).n;

        expect(postCount).toBe(1);
        // The populated-table guard short-circuits before any rename.
        expect(await fileExists(join(root, POST_LIBRARY_FILE))).toBe(true);
        expect(await fileExists(join(root, MIGRATED_FILE))).toBe(false);
      });
    });
  });

  describe("AC7 — a partial prior run (rows present, file not yet renamed) stays idempotent", () => {
    it("uses INSERT OR IGNORE plus the non-empty-table guard so a re-run adds no rows", async () => {
      await withTempJsonRoot(async (root) => {
        const db = openEngineDatabase(":memory:");

        // Simulate a crash AFTER inserting rows but BEFORE the rename: rows already
        // present, and the original post-library.json still on disk.
        await new SqlitePostLibraryRepository(db).upsertPosts([canonicalPost()]);
        await writeStoreFile(root, v2Store());
        const beforeRerun = (
          db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
        ).n;

        importPostLibraryJsonToSqlite(root, db);

        const afterRerun = (
          db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }
        ).n;
        const metricCount = (
          db.prepare("SELECT COUNT(*) AS n FROM metric_obs").get() as { n: number }
        ).n;

        expect(beforeRerun).toBe(1);
        expect(afterRerun).toBe(1);
        // INSERT OR IGNORE means no duplicate metric_obs row either.
        expect(metricCount).toBe(1);
      });
    });
  });

  describe("AC9 — kind verbatim and Snowflake TEXT fidelity", () => {
    it("imports a post whose kind is 'unknown' verbatim with no 'post' token", async () => {
      await withTempJsonRoot(async (root) => {
        await writeStoreFile(
          root,
          v2Store([
            canonicalPost({ id: "post-unknown", platformPostId: "20", kind: "unknown" }),
          ]),
        );
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const row = db
          .prepare("SELECT kind FROM post WHERE platform_post_id = ?")
          .get("20") as { kind: string };

        expect(row.kind).toBe("unknown");
        expect(row.kind).not.toBe("post");
      });
    });

    it("imports an original-kind post verbatim", async () => {
      await withTempJsonRoot(async (root) => {
        await writeStoreFile(
          root,
          v2Store([canonicalPost({ id: "post-original", platformPostId: "21", kind: "original" })]),
        );
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const row = db
          .prepare("SELECT kind FROM post WHERE platform_post_id = ?")
          .get("21") as { kind: string };

        expect(row.kind).toBe("original");
      });
    });

    it("imports a 19-digit Snowflake id as TEXT with no numeric precision loss", async () => {
      await withTempJsonRoot(async (root) => {
        const snowflake = "1700000000000000001";
        await writeStoreFile(
          root,
          v2Store([
            canonicalPost({
              id: "post-snowflake",
              platformPostId: snowflake,
              sourceRefs: [
                {
                  source: "archive_tweets_js",
                  importRunId: "import-1",
                  rawId: snowflake,
                  sourceHash,
                },
              ],
            }),
          ]),
        );
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const row = db
          .prepare("SELECT platform_post_id, logical_post_id FROM post")
          .get() as { platform_post_id: string; logical_post_id: string };

        // A number-coerced round-trip would land on 1700000000000000000 (lost low
        // bits); assert the exact 19-digit string survived as TEXT.
        expect(typeof row.platform_post_id).toBe("string");
        expect(row.platform_post_id).toBe(snowflake);
        expect(row.logical_post_id).toBe(snowflake);
      });
    });
  });

  describe("rename never deletes — the .migrated file retains the original contents", () => {
    it("renames the JSON to .migrated with byte-identical contents (file is moved, not dropped)", async () => {
      await withTempJsonRoot(async (root) => {
        const original = `${JSON.stringify(v2Store(), null, 2)}\n`;
        await writeFile(join(root, POST_LIBRARY_FILE), original, "utf8");
        const db = openEngineDatabase(":memory:");

        importPostLibraryJsonToSqlite(root, db);

        const entries = await readdir(root);

        expect(entries).toContain(MIGRATED_FILE);
        expect(entries).not.toContain(POST_LIBRARY_FILE);
        expect(await readFile(join(root, MIGRATED_FILE), "utf8")).toBe(original);
      });
    });
  });
});

describe("upgradePostLibraryStoreToV2 (single-sourced v1->v2 upgrade)", () => {
  describe("AC8 — unit: v1 upgrades, v2 passes through, too-new throws", () => {
    it("upgrades a v1 raw object to a v2 shape with schemaVersion 2 and profileSnapshots []", () => {
      const v1 = {
        schemaVersion: 1,
        updatedAt: importedAt,
        posts: [],
        importRuns: [],
        derivedInsights: [],
        activeContext: { status: "empty" },
      };

      const upgraded = postLibraryStoreSchema.parse(upgradePostLibraryStoreToV2(v1));

      expect(upgraded.schemaVersion).toBe(2);
      expect(upgraded.profileSnapshots).toEqual([]);
    });

    it("returns a v2 raw object as a v2-shaped store unchanged", () => {
      const v2 = v2Store();

      const result = postLibraryStoreSchema.parse(upgradePostLibraryStoreToV2(v2));

      expect(result.schemaVersion).toBe(2);
      expect(result.profileSnapshots).toEqual([profileSnapshot]);
      expect(result.posts).toHaveLength(1);
    });

    it("throws PostLibraryStorageError for a schemaVersion greater than 2", () => {
      const tooNew = { ...v2Store(), schemaVersion: 3 };

      expect(() => upgradePostLibraryStoreToV2(tooNew)).toThrow(PostLibraryStorageError);
    });
  });

  describe("AC8 — behavior preserved: the JSON repository still upgrades a v1 file via the extracted function", () => {
    it("loads a v1 post-library.json through JsonFilePostLibraryRepository.loadStore() with profileSnapshots defaulted to []", async () => {
      await withTempJsonRoot(async (root) => {
        const v1 = {
          schemaVersion: 1,
          updatedAt: importedAt,
          posts: [canonicalPost()],
          importRuns: [],
          derivedInsights: [],
          activeContext: { status: "empty" },
        };
        await writeStoreFile(root, v1);
        const repository = new JsonFilePostLibraryRepository({ root });

        const store = await repository.loadStore();

        expect(store.schemaVersion).toBe(2);
        expect(store.profileSnapshots).toEqual([]);
        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.platformPostId).toBe("1800000000000000001");
      });
    });
  });
});

// Load the parity-oracle store from the SAME bytes the importer consumes. A fresh
// JsonFilePostLibraryRepository over the json root reads post-library.json without
// mutating it, so it is a faithful oracle for the import equality assertion.
const loadOraclyStore = async (
  root: string,
  repository: JsonFilePostLibraryRepository,
): Promise<PostLibraryStore> => {
  await writeStoreFile(root, v2Store());

  return repository.loadStore();
};
