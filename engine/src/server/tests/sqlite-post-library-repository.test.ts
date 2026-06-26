import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  JsonFilePostLibraryRepository,
  PostLibraryStorageError,
  postLibraryStoreSchema,
  type CanonicalOwnPostInput,
  type MetricSnapshot,
  type PostLibraryStore,
  type PostLibraryWriteResult,
  type SourceRef,
} from "../post-library-repository.js";
// SqlitePostLibraryRepository + openEngineDatabase are the not-yet-existing modules
// under test. The imports resolve to nothing until Green builds them, which is the
// intended Red failure (Cannot find module).
import { openEngineDatabase } from "../open-engine-database.js";
import { SqlitePostLibraryRepository } from "../sqlite-post-library-repository.js";
// Green-owned shipped helpers. Imported ONLY to pin their signatures (these tests do not
// author them); the import fails until Green ships the module. We never call these for our
// own setup — we open the database directly via openEngineDatabase(':memory:').
import { makeTempEngineDb, seedPosts } from "../sqlite-test-helpers.js";

const importedAt = "2026-06-16T10:00:00.000Z";
const sourceHash = "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd";
const otherSourceHash =
  "sha256:0011223344556677889900112233445566778899001122334455667788990011";

// Discriminant-narrowing helpers (mirror the JSON repo test): filter a union array to a
// single variant so subsequent field reads are statically the narrowed arm.
const archiveSnapshots = (snapshots: readonly MetricSnapshot[]) =>
  snapshots.filter(
    (snapshot): snapshot is Extract<MetricSnapshot, { source: "archive_tweets_js" }> =>
      snapshot.source === "archive_tweets_js",
  );

const liveSnapshots = (snapshots: readonly MetricSnapshot[]) =>
  snapshots.filter(
    (snapshot): snapshot is Extract<MetricSnapshot, { source: "x_live_capture" }> =>
      snapshot.source === "x_live_capture",
  );

const archiveRefs = (refs: readonly SourceRef[]) =>
  refs.filter(
    (ref): ref is Extract<SourceRef, { source: "archive_tweets_js" }> =>
      ref.source === "archive_tweets_js",
  );

const liveRefs = (refs: readonly SourceRef[]) =>
  refs.filter(
    (ref): ref is Extract<SourceRef, { source: "x_live_capture" }> =>
      ref.source === "x_live_capture",
  );

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-sqlite-post-library-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const post = (overrides: Partial<CanonicalOwnPostInput> = {}): CanonicalOwnPostInput => ({
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
  ...overrides,
});

// Normalize write-time timestamps before parity equality. store.updatedAt and every
// post.updatedAt are stamped nowIso() at save time and differ between the two repos by
// construction. We blank them; createdAt and all other fields stay asserted.
const stripWriteTimestamps = (store: PostLibraryStore): PostLibraryStore => ({
  ...store,
  updatedAt: "<normalized>",
  posts: store.posts.map((post) => ({ ...post, updatedAt: "<normalized>" })),
});

// A SQLite repo backed by an in-memory database opened directly (no Green helper).
const memorySqliteRepository = (): SqlitePostLibraryRepository =>
  new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));

// The shared parity batch. Exercises every dedup-identity edge the ticket pins:
// - post-archive: two snapshots sharing observedAt but differing importedAt (both survive);
// - post-mixed: an archive + a live snapshot at the same timestamp (both survive);
// - post-tie-a / post-tie-b: a shared createdAt pair so the id-ASC tie-break is exercised,
//   plus a distinct older createdAt to exercise createdAt-DESC ordering.
const parityBatch = (): CanonicalOwnPostInput[] => [
  post({
    id: "post-archive",
    platformPostId: "1700000000000000001",
    text: "Archive post with two same-observedAt snapshots.",
    createdAt: "2024-01-01T00:00:00.000Z",
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt: "2024-01-01T00:00:00.000Z",
        importedAt: "2026-06-16T10:00:00.000Z",
        favoriteCount: 4,
        retweetCount: 1,
      },
      {
        source: "archive_tweets_js",
        observedAt: "2024-01-01T00:00:00.000Z",
        importedAt: "2026-06-17T10:00:00.000Z",
        favoriteCount: 9,
        retweetCount: 2,
      },
    ],
    sourceRefs: [
      {
        source: "archive_tweets_js",
        importRunId: "import-1",
        rawId: "1700000000000000001",
        sourceHash,
      },
    ],
  }),
  post({
    id: "post-mixed",
    platformPostId: "1700000000000000002",
    text: "Archive post later observed live.",
    createdAt: "2024-06-01T00:00:00.000Z",
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt: "2026-06-20T08:55:00.000Z",
        importedAt: "2026-06-20T09:00:00.000Z",
        favoriteCount: 5,
        retweetCount: 1,
      },
      {
        source: "x_live_capture",
        capturedAt: "2026-06-20T08:55:00.000Z",
        impressions: 1200,
        likes: 9,
      },
    ],
    sourceRefs: [
      {
        source: "archive_tweets_js",
        importRunId: "import-2",
        rawId: "1700000000000000002",
        sourceHash: otherSourceHash,
      },
      {
        source: "x_live_capture",
        captureSessionId: "session-mixed",
        rawId: "1700000000000000002",
      },
    ],
  }),
  post({
    id: "post-tie-b",
    platformPostId: "1700000000000000003",
    text: "Tie-break sibling B (same createdAt as A).",
    createdAt: "2024-12-31T00:00:00.000Z",
  }),
  post({
    id: "post-tie-a",
    platformPostId: "1700000000000000004",
    text: "Tie-break sibling A (same createdAt as B).",
    createdAt: "2024-12-31T00:00:00.000Z",
  }),
];

describe("SQLite post library repository", () => {
  describe("AC1 — empty store", () => {
    it("returns an empty valid PostLibraryStore from a fresh in-memory database", async () => {
      const repository = memorySqliteRepository();

      const store = postLibraryStoreSchema.parse(await repository.loadStore());

      expect(store.schemaVersion).toBe(2);
      expect(store.posts).toEqual([]);
      expect(store.importRuns).toEqual([]);
      expect(store.derivedInsights).toEqual([]);
      expect(store.profileSnapshots).toEqual([]);
      expect(store.activeContext).toEqual({ status: "empty" });
    });
  });

  describe("AC2 / AC3 — parity with the JSON repository", () => {
    it("returns identical PostLibraryWriteResult counts for the shared parity batch", async () => {
      await withTempRoot(async (root) => {
        const jsonRepository = new JsonFilePostLibraryRepository({ root });
        const sqliteRepository = memorySqliteRepository();
        const batch = parityBatch();

        const jsonResult: PostLibraryWriteResult = await jsonRepository.upsertPosts(batch);
        const sqliteResult: PostLibraryWriteResult = await sqliteRepository.upsertPosts(batch);

        expect(sqliteResult).toEqual(jsonResult);
        // Pin the concrete expectation too: four distinct platform keys, all inserts.
        expect(sqliteResult).toEqual({
          insertedCount: 4,
          updatedCount: 0,
          unchangedCount: 0,
          duplicateCount: 0,
        });
      });
    });

    it("returns an identical loadStore() result for the shared parity batch (modulo write timestamps, same order)", async () => {
      await withTempRoot(async (root) => {
        const jsonRepository = new JsonFilePostLibraryRepository({ root });
        const sqliteRepository = memorySqliteRepository();
        const batch = parityBatch();

        await jsonRepository.upsertPosts(batch);
        await sqliteRepository.upsertPosts(batch);

        const jsonStore = stripWriteTimestamps(await jsonRepository.loadStore());
        const sqliteStore = stripWriteTimestamps(await sqliteRepository.loadStore());

        expect(sqliteStore).toEqual(jsonStore);
        // Ordering parity is part of the equality above; pin it explicitly so a
        // reorder regression names itself: createdAt DESC, id ASC on the tied pair.
        expect(sqliteStore.posts.map((item) => item.id)).toEqual(
          jsonStore.posts.map((item) => item.id),
        );
        expect(sqliteStore.posts.map((item) => item.id)).toEqual([
          "post-tie-a",
          "post-tie-b",
          "post-mixed",
          "post-archive",
        ]);
      });
    });
  });

  describe("AC4 — in-batch duplicate platform key", () => {
    it("collapses two same-platform-key inputs to one canonical row and reports duplicateCount 1", async () => {
      const repository = memorySqliteRepository();

      const result = await repository.upsertPosts([
        post(),
        post({
          id: "post-duplicate-input",
          text: "Updated text from the same platform id.",
          weakMetrics: { favoriteCount: 18, retweetCount: 4 },
        }),
      ]);
      const store = await repository.loadStore();

      expect(result).toEqual({
        insertedCount: 1,
        updatedCount: 1,
        unchangedCount: 0,
        duplicateCount: 1,
      });
      expect(store.posts).toHaveLength(1);
      expect(store.posts[0]?.platformPostId).toBe("1800000000000000001");
      expect(store.posts[0]?.text).toBe("Updated text from the same platform id.");
      expect(store.posts[0]?.weakMetrics.favoriteCount).toBe(18);
    });
  });

  describe("AC5 — re-upsert merges metric/source rows by dedup key", () => {
    it("merges new metric and source data into the existing post and counts it as updated", async () => {
      const repository = memorySqliteRepository();

      const first = await repository.upsertPosts([post()]);
      const second = await repository.upsertPosts([
        post({
          text: "A compact archive post with newer metrics.",
          metricSnapshots: [
            {
              source: "archive_tweets_js",
              observedAt: "2024-02-05T12:00:00.000Z",
              importedAt: "2026-06-16T10:30:00.000Z",
              favoriteCount: 25,
              retweetCount: 6,
            },
          ],
          sourceRefs: [
            {
              source: "archive_tweets_js",
              importRunId: "import-2",
              rawId: "1800000000000000001",
              sourceHash,
            },
          ],
        }),
      ]);
      const store = await repository.loadStore();

      expect(first.insertedCount).toBe(1);
      expect(second.insertedCount).toBe(0);
      expect(second.updatedCount).toBe(1);
      expect(store.posts).toHaveLength(1);
      expect(store.posts[0]?.metricSnapshots).toHaveLength(2);
      expect(
        archiveRefs(store.posts[0]?.sourceRefs ?? []).map((ref) => ref.importRunId).sort(),
      ).toEqual(["import-1", "import-2"]);
    });

    it("treats a re-inserted identical metric snapshot as an idempotent no-op (no duplicate row)", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([post()]);
      await repository.upsertPosts([post({ text: "Re-upserted with the very same snapshot key." })]);
      const store = await repository.loadStore();

      expect(store.posts).toHaveLength(1);
      const archived = archiveSnapshots(store.posts[0]?.metricSnapshots ?? []);
      expect(archived).toHaveLength(1);
      expect(archived[0]?.observedAt).toBe("2024-01-05T12:00:00.000Z");
      expect(archived[0]?.importedAt).toBe(importedAt);
    });

    it("dedups duplicates already present within a single input post identically to a prior-row merge", async () => {
      const repository = memorySqliteRepository();

      // The input post itself carries two identical archive snapshots (same snapshotKey)
      // and two identical archive refs (same sourceRefKey). After save, each dedups to one.
      const result = await repository.upsertPosts([
        post({
          metricSnapshots: [
            {
              source: "archive_tweets_js",
              observedAt: "2024-01-05T12:00:00.000Z",
              importedAt,
              favoriteCount: 12,
              retweetCount: 3,
            },
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
            {
              source: "archive_tweets_js",
              importRunId: "import-1",
              rawId: "1800000000000000001",
              sourceHash,
            },
          ],
        }),
      ]);
      const store = await repository.loadStore();

      expect(result.insertedCount).toBe(1);
      expect(store.posts).toHaveLength(1);
      expect(store.posts[0]?.metricSnapshots).toHaveLength(1);
      expect(store.posts[0]?.sourceRefs).toHaveLength(1);
    });
  });

  describe("AC6 — two archive snapshots sharing observedAt, differing importedAt", () => {
    it("keeps both metric snapshots and matches the JSON repository", async () => {
      await withTempRoot(async (root) => {
        const sqliteRepository = memorySqliteRepository();
        const jsonRepository = new JsonFilePostLibraryRepository({ root });
        const input = post({
          metricSnapshots: [
            {
              source: "archive_tweets_js",
              observedAt: "2024-01-05T12:00:00.000Z",
              importedAt: "2026-06-16T10:00:00.000Z",
              favoriteCount: 4,
              retweetCount: 1,
            },
            {
              source: "archive_tweets_js",
              observedAt: "2024-01-05T12:00:00.000Z",
              importedAt: "2026-06-17T10:00:00.000Z",
              favoriteCount: 9,
              retweetCount: 2,
            },
          ],
        });

        await sqliteRepository.upsertPosts([input]);
        await jsonRepository.upsertPosts([input]);

        const sqliteStore = await sqliteRepository.loadStore();
        const jsonStore = await jsonRepository.loadStore();

        const sqliteArchive = archiveSnapshots(sqliteStore.posts[0]?.metricSnapshots ?? []);
        const jsonArchive = archiveSnapshots(jsonStore.posts[0]?.metricSnapshots ?? []);
        expect(sqliteArchive).toHaveLength(2);
        expect(sqliteArchive.map((snapshot) => snapshot.importedAt).sort()).toEqual([
          "2026-06-16T10:00:00.000Z",
          "2026-06-17T10:00:00.000Z",
        ]);
        expect(sqliteArchive.map((snapshot) => snapshot.importedAt).sort()).toEqual(
          jsonArchive.map((snapshot) => snapshot.importedAt).sort(),
        );
      });
    });
  });

  describe("AC7 — archive snapshot and live snapshot at the same timestamp", () => {
    it("keeps both metric snapshots when an archive and a live snapshot share a timestamp", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([
        post({
          metricSnapshots: [
            {
              source: "archive_tweets_js",
              observedAt: "2026-06-20T08:55:00.000Z",
              importedAt: "2026-06-20T09:00:00.000Z",
              favoriteCount: 5,
              retweetCount: 1,
            },
            {
              source: "x_live_capture",
              capturedAt: "2026-06-20T08:55:00.000Z",
              impressions: 1200,
              likes: 9,
            },
          ],
        }),
      ]);
      const store = await repository.loadStore();

      expect(store.posts).toHaveLength(1);
      expect(store.posts[0]?.metricSnapshots).toHaveLength(2);
      expect(archiveSnapshots(store.posts[0]?.metricSnapshots ?? [])).toHaveLength(1);
      expect(liveSnapshots(store.posts[0]?.metricSnapshots ?? [])).toHaveLength(1);
    });
  });

  describe("AC8 — Blocker-A: archive importedAt round-trips and re-parses", () => {
    it("reloads an archive snapshot with its importedAt present and re-parses through the store schema", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([
        post({
          metricSnapshots: [
            {
              source: "archive_tweets_js",
              observedAt: "2024-01-05T12:00:00.000Z",
              importedAt: "2026-06-16T10:00:00.000Z",
              favoriteCount: 12,
              retweetCount: 3,
            },
          ],
        }),
      ]);

      const store = await repository.loadStore();
      // loadStore re-parses through postLibraryStoreSchema; assert the discriminated-union
      // archive arm survived with imported_at intact (this is the imported_at regression).
      const reparsed = postLibraryStoreSchema.parse(store);
      const archived = archiveSnapshots(reparsed.posts[0]?.metricSnapshots ?? []);

      expect(archived).toHaveLength(1);
      expect(archived[0]?.importedAt).toBe("2026-06-16T10:00:00.000Z");
      expect(archived[0]?.observedAt).toBe("2024-01-05T12:00:00.000Z");
    });
  });

  describe("AC9 — profile snapshots append-only (no dedup)", () => {
    it("persists both profile snapshots that share platformUserId and capturedAt", async () => {
      const repository = memorySqliteRepository();

      await repository.pushProfileSnapshot({
        platformUserId: "user-123",
        screenName: "founder",
        followers: 980,
        capturedAt: "2026-06-20T08:55:00.000Z",
      });
      await repository.pushProfileSnapshot({
        platformUserId: "user-123",
        screenName: "founder",
        followers: 981,
        capturedAt: "2026-06-20T08:55:00.000Z",
      });
      const store = await repository.loadStore();

      expect(store.profileSnapshots).toHaveLength(2);
      expect(store.profileSnapshots.map((snapshot) => snapshot.followers).sort()).toEqual([
        980, 981,
      ]);
      expect(
        store.profileSnapshots.every((snapshot) => snapshot.platformUserId === "user-123"),
      ).toBe(true);
    });
  });

  describe("AC10 — ordering: createdAt DESC, id ASC tie-break", () => {
    it("orders loaded posts by createdAt descending then id ascending, matching the JSON repository", async () => {
      await withTempRoot(async (root) => {
        const sqliteRepository = memorySqliteRepository();
        const jsonRepository = new JsonFilePostLibraryRepository({ root });
        const batch = [
          post({ id: "post-older", platformPostId: "10", createdAt: "2024-01-01T00:00:00.000Z" }),
          post({
            id: "post-newest-b",
            platformPostId: "11",
            createdAt: "2024-12-31T00:00:00.000Z",
          }),
          post({
            id: "post-newest-a",
            platformPostId: "12",
            createdAt: "2024-12-31T00:00:00.000Z",
          }),
        ];

        await sqliteRepository.upsertPosts(batch);
        await jsonRepository.upsertPosts(batch);

        const sqliteOrder = (await sqliteRepository.loadStore()).posts.map((item) => item.id);
        const jsonOrder = (await jsonRepository.loadStore()).posts.map((item) => item.id);

        expect(sqliteOrder).toEqual(["post-newest-a", "post-newest-b", "post-older"]);
        expect(sqliteOrder).toEqual(jsonOrder);
      });
    });
  });

  describe("AC11 — kind verbatim and logical/platform id identity", () => {
    it("reloads kind exactly 'original' (no 'post' token) and re-parses the kind enum", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([post({ kind: "original" })]);
      const store = await repository.loadStore();
      const reloaded = store.posts[0];

      expect(reloaded?.kind).toBe("original");
      // postLibraryStoreSchema only admits the four kind tokens; re-parsing proves no
      // 'post' (or other) token leaked through the mapping.
      expect(postLibraryStoreSchema.parse(store).posts[0]?.kind).toBe("original");
    });

    it("reloads non-original kinds verbatim from the {original, reply, repost_reference, unknown} set", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([
        post({
          id: "post-reply",
          platformPostId: "1700000000000000010",
          kind: "reply",
          replyReferences: { inReplyToPostId: "1700000000000000009", inReplyToUserId: "u-9" },
        }),
        post({
          id: "post-repost",
          platformPostId: "1700000000000000011",
          kind: "repost_reference",
        }),
        post({ id: "post-unknown", platformPostId: "1700000000000000012", kind: "unknown" }),
      ]);
      const store = await repository.loadStore();
      const byId = new Map(store.posts.map((item) => [item.id, item.kind]));

      expect(byId.get("post-reply")).toBe("reply");
      expect(byId.get("post-repost")).toBe("repost_reference");
      expect(byId.get("post-unknown")).toBe("unknown");
      expect([...byId.values()]).not.toContain("post");
    });

    // logical_post_id == platform_post_id is a named storage-column invariant of this FND
    // ticket (DDL: logical_post_id TEXT NOT NULL, distinct from platform_post_id and its own
    // index). For a storage ticket the schema IS the contract, so we read the column directly
    // from the post table via the live db handle this suite already constructs. An impl that
    // sets logical_post_id to anything else (post.id, NULL, '') — yet still keys on
    // platform_post_id — must fail this test.
    it("writes logical_post_id equal to platform_post_id verbatim in the post table", async () => {
      const db = openEngineDatabase(":memory:");
      const repository = new SqlitePostLibraryRepository(db);

      await repository.upsertPosts([post({ platformPostId: "1700000000000000001" })]);
      const rows = db
        .prepare("SELECT logical_post_id, platform_post_id FROM post")
        .all() as Array<{ logical_post_id: string; platform_post_id: string }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.logical_post_id).toBe("1700000000000000001");
      expect(rows[0]?.platform_post_id).toBe("1700000000000000001");
      expect(rows[0]?.logical_post_id).toBe(rows[0]?.platform_post_id);
    });

    // Complementary behavioral check (does NOT substitute for the column assertion above):
    // re-upserting under the same platformPostId collapses to one row via the platform-key
    // identity, regardless of the new id.
    it("collapses a re-upsert under the same platform post id to a single row", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([post({ platformPostId: "1700000000000000001" })]);
      await repository.upsertPosts([
        post({ id: "post-rekeyed", platformPostId: "1700000000000000001", text: "Same key, new id." }),
      ]);
      const store = await repository.loadStore();

      expect(store.posts).toHaveLength(1);
      expect(store.posts[0]?.platformPostId).toBe("1700000000000000001");
      expect(store.posts[0]?.text).toBe("Same key, new id.");
    });
  });

  describe("AC12 — open/migration failure wraps in PostLibraryStorageError", () => {
    it("throws PostLibraryStorageError when opening a path whose bytes are not a valid SQLite database", async () => {
      await withTempRoot(async (root) => {
        const junkPath = join(root, "not-a-real.db");
        await writeFile(junkPath, "this is plainly not a sqlite header", "utf8");

        expect(() => openEngineDatabase(junkPath)).toThrow(PostLibraryStorageError);
      });
    });
  });

  describe("Snowflake TEXT round-trip", () => {
    it("round-trips a 64-bit-Snowflake-sized id string with no numeric precision loss", async () => {
      const repository = memorySqliteRepository();
      const snowflake = "1700000000000000001";

      await repository.upsertPosts([
        post({ platformPostId: snowflake, sourceRefs: [], metricSnapshots: [] }),
      ]);
      const store = await repository.loadStore();

      expect(store.posts[0]?.platformPostId).toBe(snowflake);
      // A number-coerced round-trip would land on 1700000000000000000 (lost low bits);
      // assert the exact string survived.
      expect(typeof store.posts[0]?.platformPostId).toBe("string");
    });
  });

  describe("absent vs empty-string reconstruction", () => {
    it("reconstructs a live snapshot's absent optional metrics as absent fields, never empty strings", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([
        post({
          id: "post-live-sparse",
          platformPostId: "1900000000000000050",
          weakMetrics: {},
          metricSnapshots: [
            {
              source: "x_live_capture",
              capturedAt: "2026-06-20T08:55:00.000Z",
              impressions: 100,
            },
          ],
          sourceRefs: [
            {
              source: "x_live_capture",
              captureSessionId: "session-sparse",
              rawId: "1900000000000000050",
            },
          ],
        }),
      ]);
      const store = await repository.loadStore();
      const live = liveSnapshots(store.posts[0]?.metricSnapshots ?? [])[0];

      expect(live?.impressions).toBe(100);
      // The optional fields the input omitted must come back absent (undefined), not the
      // storage-internal '' sentinel coerced into the reconstructed object.
      expect(live).not.toHaveProperty("likes");
      expect(live?.likes).toBeUndefined();
    });

    it("reloads a post with NULL in_reply_to fields as replyReferences defaulting to {}", async () => {
      const repository = memorySqliteRepository();

      await repository.upsertPosts([
        post({ id: "post-no-reply", platformPostId: "1700000000000000099", replyReferences: {} }),
      ]);
      const store = await repository.loadStore();

      expect(store.posts[0]?.replyReferences).toEqual({});
    });
  });

  describe("active_context singleton", () => {
    it("updates the single active_context row rather than appending a second when written twice", async () => {
      const repository = memorySqliteRepository();

      await repository.setActiveContext({ status: "empty" });
      await repository.setActiveContext({
        status: "active",
        sourceImportId: "import-1",
        activatedAt: importedAt,
        scoringContextPatch: {},
        judgeHints: [],
        provenance: "Imported X archive",
        confidence: "low",
        counts: { posts: 1, originals: 1, replies: 0 },
      });
      const store = await repository.loadStore();

      // The store surfaces exactly one activeContext (the singleton), reflecting the latest
      // write — not a collection that grew to two.
      expect(store.activeContext.status).toBe("active");
    });
  });

  describe("file mode 0600 on a real database file", () => {
    it("chmods the database file to 0600 when opened against a tmpdir path", async () => {
      await withTempRoot(async (root) => {
        const dbPath = join(root, "engine.db");

        openEngineDatabase(dbPath);
        const stats = await stat(dbPath);

        // Mask to the permission bits; expect owner read/write only (0600).
        expect(stats.mode & 0o777).toBe(0o600);
      });
    });
  });

  describe("Green-owned test-support helpers (signatures pinned)", () => {
    it("seeds a fresh temp engine db through the shipped helpers and reloads the seeded post", async () => {
      const db = makeTempEngineDb();
      const repository = new SqlitePostLibraryRepository(db);
      const seeded = canonicalize(post({ id: "post-seeded", platformPostId: "1700000000000000200" }));

      await seedPosts(db, [seeded]);
      const store = await repository.loadStore();

      expect(store.posts).toHaveLength(1);
      expect(store.posts[0]?.platformPostId).toBe("1700000000000000200");
      expect(store.posts[0]?.id).toBe("post-seeded");
    });
  });
});

// seedPosts is typed to accept CanonicalOwnPost[] (resolved updatedAt), while our fixture
// factory produces CanonicalOwnPostInput. Resolve updatedAt so the call pins the helper's
// CanonicalOwnPost[] parameter type exactly.
const canonicalize = (input: CanonicalOwnPostInput) => ({
  ...input,
  updatedAt: input.updatedAt ?? "2026-06-16T10:00:00.000Z",
});
