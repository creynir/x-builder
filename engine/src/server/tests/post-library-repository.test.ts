import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import {
  JsonFilePostLibraryRepository,
  PostLibraryStorageError,
  postLibraryStoreSchema,
  type CanonicalOwnPostInput,
  type MetricSnapshot,
  type SourceRef,
} from "../post-library-repository";

const importedAt = "2026-06-16T10:00:00.000Z";
const sourceHash = "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd";

// Real consumers must narrow on the `source` discriminant before
// reading any variant-specific field. These helpers filter a union array down to a single
// variant so the subsequent reads are statically the narrowed arm — no casts, and reads of
// a field that belongs to the other arm become a compile error rather than `undefined`.
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
  const root = await mkdtemp(join(tmpdir(), "x-builder-post-library-"));

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

// A complete archive ActiveArchiveContext used purely to trigger a saveStore
// (a write) without needing any not-yet-existing live types.
const activeArchiveContext = {
  status: "active" as const,
  sourceImportId: "import-1",
  activatedAt: importedAt,
  scoringContextPatch: {},
  judgeHints: [],
  provenance: "Imported X archive",
  confidence: "low" as const,
  counts: {
    posts: 1,
    originals: 1,
    replies: 0,
  },
};

// Owned fixture: an on-disk v1 post-library.json as a raw JSON string. One archive
// post with archive_tweets_js snapshots/refs and no profileSnapshots. Written to the
// tmpdir and loaded through the real repository. This is the v1->v2 migration fixture.
const v1FixtureJson = JSON.stringify(
  {
    schemaVersion: 1,
    updatedAt: "2026-06-16T10:05:00.000Z",
    posts: [
      {
        id: "post-archive-1",
        platform: "x",
        platformPostId: "1800000000000000042",
        text: "Archive post that predates the v2 store.",
        createdAt: "2024-03-01T08:30:00.000Z",
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
          favoriteCount: 7,
          retweetCount: 2,
        },
        metricSnapshots: [
          {
            source: "archive_tweets_js",
            observedAt: "2024-03-01T08:30:00.000Z",
            importedAt,
            favoriteCount: 7,
            retweetCount: 2,
          },
        ],
        sourceRefs: [
          {
            source: "archive_tweets_js",
            importRunId: "import-legacy-1",
            rawId: "1800000000000000042",
            sourceHash,
          },
        ],
        updatedAt: "2026-06-16T10:05:00.000Z",
      },
    ],
    importRuns: [],
    derivedInsights: [],
    activeContext: { status: "empty" },
  },
  null,
  2,
);

describe("JSON file post library repository", () => {
  it("loads an empty valid store when no library file exists", async () => {
    await withTempRoot(async (root) => {
      const repository = new JsonFilePostLibraryRepository({ root });

      const store = postLibraryStoreSchema.parse(await repository.loadStore());

      expect(store.schemaVersion).toBe(2);
      expect(store.posts).toEqual([]);
      expect(store.importRuns).toEqual([]);
      expect(store.derivedInsights).toEqual([]);
      expect(store.activeContext).toEqual({ status: "empty" });
    });
  });

  it("raises a controlled storage error for corrupt persisted JSON", async () => {
    await withTempRoot(async (root) => {
      await writeFile(join(root, "post-library.json"), "{ not valid json", "utf8");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const repository = new JsonFilePostLibraryRepository({ root });

        await expect(repository.loadStore()).rejects.toBeInstanceOf(PostLibraryStorageError);
        expect(errorSpy).toHaveBeenCalledOnce();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  it("upserts canonical posts by platform and platform post id", async () => {
    await withTempRoot(async (root) => {
      const repository = new JsonFilePostLibraryRepository({ root });

      const result = await repository.upsertPosts([
        post(),
        post({
          id: "post-duplicate-input",
          text: "Updated text from the same platform id.",
          weakMetrics: {
            favoriteCount: 18,
            retweetCount: 4,
          },
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

  it("preserves metric snapshots and source refs when an existing post is updated", async () => {
    await withTempRoot(async (root) => {
      const repository = new JsonFilePostLibraryRepository({ root });

      await repository.upsertPosts([post()]);
      await repository.upsertPosts([
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

      expect(store.posts).toHaveLength(1);
      expect(store.posts[0]?.metricSnapshots).toHaveLength(2);
      expect(archiveRefs(store.posts[0]?.sourceRefs ?? []).map((ref) => ref.importRunId)).toEqual([
        "import-1",
        "import-2",
      ]);
    });
  });

  it("serializes concurrent upsert writes from the same repository instance", async () => {
    await withTempRoot(async (root) => {
      const repository = new JsonFilePostLibraryRepository({ root });

      await Promise.all([
        repository.upsertPosts([post({ id: "post-1", platformPostId: "1" })]),
        repository.upsertPosts([post({ id: "post-2", platformPostId: "2" })]),
        repository.upsertPosts([post({ id: "post-3", platformPostId: "3" })]),
      ]);

      const store = await repository.loadStore();

      expect(store.posts.map((item) => item.platformPostId).sort()).toEqual(["1", "2", "3"]);
    });
  });

  it("persists import runs, derived insight snapshots, and active context without raw archive contents", async () => {
    await withTempRoot(async (root) => {
      const repository = new JsonFilePostLibraryRepository({ root });
      await repository.saveImportRun({
        id: "import-1",
        sourceHash,
        assignmentPath: "window.YTD.tweets.part0",
        status: "completed",
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
      });
      await repository.saveDerivedInsights({
        importRunId: "import-1",
        generatedAt: importedAt,
        insights: {
          generatedAt: importedAt,
          counts: {
            posts: 1,
            originals: 1,
            replies: 0,
            repostReferences: 0,
          },
          cadence: {
            postsPerWeek: 1,
            mostCommonHoursUtc: [12],
          },
          replyOriginalMix: {
            originalRatio: 1,
            replyRatio: 0,
          },
          repeatStructures: [],
          emotionalAngleRotation: [],
          weakEngagement: {
            favoriteMedian: 12,
            retweetMedian: 3,
          },
          confidence: "low",
        },
      });
      await repository.setActiveContext({
        status: "active",
        sourceImportId: "import-1",
        activatedAt: importedAt,
        scoringContextPatch: {},
        judgeHints: [],
        provenance: "Imported X archive",
        confidence: "low",
        counts: {
          posts: 1,
          originals: 1,
          replies: 0,
        },
      });

      const rawStore = await readFile(join(root, "post-library.json"), "utf8");
      const store = postLibraryStoreSchema.parse(JSON.parse(rawStore));

      expect(store.importRuns).toHaveLength(1);
      expect(store.derivedInsights).toHaveLength(1);
      expect(store.activeContext.status).toBe("active");
      expect(rawStore).not.toContain("[{\"tweet\"");
      expect(rawStore).not.toContain("contents");
    });
  });

  // ----------------------------------------------------------------------------
  // Category A — characterization (preservation) tests.
  // These pin Behavior-Preservation Invariants and MUST pass against current code
  // and remain green after the v2 refactor.
  // ----------------------------------------------------------------------------

  describe("archive behavior preservation", () => {
    it("does not duplicate an archive metric snapshot with an identical observedAt/importedAt key", async () => {
      await withTempRoot(async (root) => {
        const repository = new JsonFilePostLibraryRepository({ root });

        // Same [source, observedAt, importedAt] across both upserts -> snapshotKey collision.
        await repository.upsertPosts([post()]);
        await repository.upsertPosts([
          post({
            text: "Re-upserted with the very same archive snapshot key.",
          }),
        ]);

        const store = await repository.loadStore();

        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.metricSnapshots).toHaveLength(1);
        const archived = archiveSnapshots(store.posts[0]?.metricSnapshots ?? []);
        expect(archived).toHaveLength(1);
        expect(archived[0]?.observedAt).toBe("2024-01-05T12:00:00.000Z");
      });
    });

    it("keeps two archive metric snapshots that differ only in observedAt", async () => {
      await withTempRoot(async (root) => {
        const repository = new JsonFilePostLibraryRepository({ root });

        await repository.upsertPosts([post()]);
        await repository.upsertPosts([
          post({
            text: "Same importedAt, different observedAt -> distinct snapshotKey.",
            metricSnapshots: [
              {
                source: "archive_tweets_js",
                observedAt: "2024-06-05T12:00:00.000Z",
                importedAt,
                favoriteCount: 20,
                retweetCount: 5,
              },
            ],
          }),
        ]);

        const store = await repository.loadStore();

        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.metricSnapshots).toHaveLength(2);
        const archived = archiveSnapshots(store.posts[0]?.metricSnapshots ?? []);
        expect(archived).toHaveLength(2);
        expect(archived.map((snapshot) => snapshot.observedAt).sort()).toEqual([
          "2024-01-05T12:00:00.000Z",
          "2024-06-05T12:00:00.000Z",
        ]);
      });
    });

    it("does not duplicate an archive source ref with an identical importRunId/rawId/sourceHash key", async () => {
      await withTempRoot(async (root) => {
        const repository = new JsonFilePostLibraryRepository({ root });

        await repository.upsertPosts([post()]);
        await repository.upsertPosts([
          post({
            // Force the post to be merged (newer snapshot) but keep an identical sourceRef.
            metricSnapshots: [
              {
                source: "archive_tweets_js",
                observedAt: "2024-09-05T12:00:00.000Z",
                importedAt,
              },
            ],
          }),
        ]);

        const store = await repository.loadStore();

        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.sourceRefs).toHaveLength(1);
        const refs = archiveRefs(store.posts[0]?.sourceRefs ?? []);
        expect(refs).toHaveLength(1);
        expect(refs[0]?.importRunId).toBe("import-1");
      });
    });

    it("keeps two archive source refs that differ only in sourceHash", async () => {
      await withTempRoot(async (root) => {
        const otherHash =
          "sha256:0011223344556677889900112233445566778899001122334455667788990011";
        const repository = new JsonFilePostLibraryRepository({ root });

        await repository.upsertPosts([post()]);
        await repository.upsertPosts([
          post({
            sourceRefs: [
              {
                source: "archive_tweets_js",
                importRunId: "import-1",
                rawId: "1800000000000000001",
                sourceHash: otherHash,
              },
            ],
          }),
        ]);

        const store = await repository.loadStore();

        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.sourceRefs).toHaveLength(2);
        const refs = archiveRefs(store.posts[0]?.sourceRefs ?? []);
        expect(refs).toHaveLength(2);
        expect(refs.map((ref) => ref.sourceHash).sort()).toEqual([otherHash, sourceHash].sort());
      });
    });

    it("returns stored posts sorted by createdAt descending with id ascending as tie-breaker", async () => {
      await withTempRoot(async (root) => {
        const repository = new JsonFilePostLibraryRepository({ root });

        await repository.upsertPosts([
          post({
            id: "post-older",
            platformPostId: "10",
            createdAt: "2024-01-01T00:00:00.000Z",
          }),
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
        ]);

        const store = await repository.loadStore();

        expect(store.posts.map((item) => item.id)).toEqual([
          "post-newest-a",
          "post-newest-b",
          "post-older",
        ]);
      });
    });

    // QUIRK (pinned, not bent): re-upserting a byte-identical post never inserts a second
    // copy and never duplicates the post's snapshots/refs (they dedup to one). Whether the
    // re-upsert is reported as updatedCount:1 or unchangedCount:1 is TIMING-DEPENDENT in the
    // current implementation: mergePost stamps the merged post with a fresh updatedAt
    // (nowIso()), so stableJson(previous) !== stableJson(merged) — and thus updatedCount:1 —
    // UNLESS both upserts land in the same millisecond, in which case the timestamps match
    // and it reports unchangedCount:1. We assert the timing-independent facts: insert once,
    // re-merge with no new copy, exactly one of updated/unchanged, and dedup to one element.
    it("re-upserts an identical post without inserting a duplicate or duplicating its snapshots/refs", async () => {
      await withTempRoot(async (root) => {
        const repository = new JsonFilePostLibraryRepository({ root });

        const first = await repository.upsertPosts([post()]);
        const second = await repository.upsertPosts([post()]);

        expect(first).toEqual({
          insertedCount: 1,
          updatedCount: 0,
          unchangedCount: 0,
          duplicateCount: 0,
        });
        // Re-upsert: not an insert, not an in-batch duplicate, and exactly one of
        // updated/unchanged (timing-dependent which) accounts for the single post.
        expect(second.insertedCount).toBe(0);
        expect(second.duplicateCount).toBe(0);
        expect(second.updatedCount + second.unchangedCount).toBe(1);

        const store = await repository.loadStore();

        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.metricSnapshots).toHaveLength(1);
        expect(store.posts[0]?.sourceRefs).toHaveLength(1);
      });
    });
  });

  // ----------------------------------------------------------------------------
  // Category B — new-behavior tests.
  // These describe v2 / migration / live-capture behavior that does NOT exist yet
  // and MUST fail against current code; they pass after Green.
  // Live-shaped data is constructed as on-disk JSON strings (never typed literals)
  // so the suite typechecks against current source types.
  // ----------------------------------------------------------------------------

  describe("v1 to v2 forward migration", () => {
    it("loads a v1 store as schemaVersion 2 with an empty profileSnapshots and identical posts", async () => {
      await withTempRoot(async (root) => {
        await writeFile(join(root, "post-library.json"), v1FixtureJson, "utf8");
        const repository = new JsonFilePostLibraryRepository({ root });

        const store = await repository.loadStore();
        const parsedFixture = JSON.parse(v1FixtureJson) as {
          posts: Array<{
            id: string;
            text: string;
            metricSnapshots: unknown[];
            sourceRefs: Array<{ importRunId: string; rawId: string }>;
          }>;
        };

        expect(store.schemaVersion).toBe(2);
        expect(store.profileSnapshots).toEqual([]);
        expect(store.posts).toHaveLength(1);
        expect(store.posts[0]?.id).toBe(parsedFixture.posts[0]?.id);
        expect(store.posts[0]?.text).toBe(parsedFixture.posts[0]?.text);
        expect(store.posts[0]?.metricSnapshots).toEqual(parsedFixture.posts[0]?.metricSnapshots);
        expect(archiveRefs(store.posts[0]?.sourceRefs ?? []).map((ref) => ref.importRunId)).toEqual([
          "import-legacy-1",
        ]);
        expect(store.posts[0]?.sourceRefs.map((ref) => ref.rawId)).toEqual([
          "1800000000000000042",
        ]);
      });
    });

    it("persists a loaded v1 store as v2 on the next write and is not re-migrated on reload", async () => {
      await withTempRoot(async (root) => {
        await writeFile(join(root, "post-library.json"), v1FixtureJson, "utf8");
        const repository = new JsonFilePostLibraryRepository({ root });

        // First load migrates in memory; setActiveContext triggers a saveStore.
        await repository.loadStore();
        await repository.setActiveContext(activeArchiveContext);

        const rawAfterWrite = await readFile(join(root, "post-library.json"), "utf8");
        const onDisk = JSON.parse(rawAfterWrite) as {
          schemaVersion: number;
          profileSnapshots: unknown[];
          posts: Array<{ id: string }>;
        };

        expect(onDisk.schemaVersion).toBe(2);
        expect(onDisk.profileSnapshots).toEqual([]);
        expect(onDisk.posts).toHaveLength(1);
        expect(onDisk.posts[0]?.id).toBe("post-archive-1");

        // A second load reads the already-v2 file: still v2, posts unchanged (idempotent).
        const reloaded = await repository.loadStore();

        expect(reloaded.schemaVersion).toBe(2);
        expect(reloaded.posts).toHaveLength(1);
        expect(reloaded.posts[0]?.id).toBe("post-archive-1");
      });
    });
  });

  describe("schema version drift guard", () => {
    it("throws a controlled storage error for a store with schemaVersion greater than 2", async () => {
      await withTempRoot(async (root) => {
        const futureStore = JSON.stringify({
          schemaVersion: 3,
          updatedAt: "2026-06-16T10:05:00.000Z",
          posts: [],
          importRuns: [],
          derivedInsights: [],
          activeContext: { status: "empty" },
          profileSnapshots: [],
        });
        await writeFile(join(root, "post-library.json"), futureStore, "utf8");
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        try {
          const repository = new JsonFilePostLibraryRepository({ root });

          await expect(repository.loadStore()).rejects.toBeInstanceOf(PostLibraryStorageError);
        } finally {
          errorSpy.mockRestore();
        }
      });
    });
  });

  describe("v2 live-capture readiness", () => {
    it("loads and round-trips a v2 store with live metric snapshots, live source refs, and profile snapshots", async () => {
      await withTempRoot(async (root) => {
        const liveStore = JSON.stringify(
          {
            schemaVersion: 2,
            updatedAt: "2026-06-20T09:00:00.000Z",
            posts: [
              {
                id: "post-live-1",
                platform: "x",
                platformPostId: "1900000000000000001",
                text: "A live-captured post.",
                createdAt: "2026-06-19T18:00:00.000Z",
                kind: "original",
                language: "en",
                replyReferences: {},
                entityFlags: {
                  hasUrls: false,
                  hasMedia: false,
                  hasHashtags: false,
                  hasMentions: false,
                },
                weakMetrics: {},
                metricSnapshots: [
                  {
                    source: "x_live_capture",
                    capturedAt: "2026-06-20T08:55:00.000Z",
                    impressions: 4200,
                    likes: 31,
                    reposts: 4,
                    replies: 2,
                    quotes: 1,
                    bookmarks: 6,
                  },
                ],
                sourceRefs: [
                  {
                    source: "x_live_capture",
                    captureSessionId: "session-1",
                    rawId: "1900000000000000001",
                  },
                ],
                updatedAt: "2026-06-20T09:00:00.000Z",
              },
            ],
            importRuns: [],
            derivedInsights: [],
            activeContext: { status: "empty" },
            profileSnapshots: [
              {
                platformUserId: "user-123",
                screenName: "founder",
                followers: 980,
                capturedAt: "2026-06-20T08:55:00.000Z",
              },
            ],
          },
          null,
          2,
        );
        await writeFile(join(root, "post-library.json"), liveStore, "utf8");
        // Pre-Green, loadStore rejects v2 data via the ZodError path and logs once;
        // silence that log so the eventual (post-Green) assertion failure is the signal.
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const repository = new JsonFilePostLibraryRepository({ root });

        const store = await repository.loadStore().finally(() => errorSpy.mockRestore());

        expect(store.schemaVersion).toBe(2);
        expect(store.posts).toHaveLength(1);

        const liveMetrics = liveSnapshots(store.posts[0]?.metricSnapshots ?? []);
        expect(liveMetrics).toHaveLength(1);
        const snapshot = liveMetrics[0];
        expect(snapshot?.source).toBe("x_live_capture");
        expect(snapshot?.capturedAt).toBe("2026-06-20T08:55:00.000Z");
        expect(snapshot?.impressions).toBe(4200);
        expect(snapshot?.likes).toBe(31);

        const liveSourceRefs = liveRefs(store.posts[0]?.sourceRefs ?? []);
        expect(liveSourceRefs).toHaveLength(1);
        const ref = liveSourceRefs[0];
        expect(ref?.source).toBe("x_live_capture");
        expect(ref?.captureSessionId).toBe("session-1");
        expect(ref?.rawId).toBe("1900000000000000001");
        // sourceHash exists only on the archive arm; narrowing to the live arm makes a read
        // of it a compile error, so its absence is enforced by the type system, not asserted.

        const profiles = store.profileSnapshots;
        expect(profiles).toHaveLength(1);
        expect(profiles[0]?.platformUserId).toBe("user-123");
        expect(profiles[0]?.screenName).toBe("founder");
        expect(profiles[0]?.followers).toBe(980);

        // Round-trip: trigger a write (archive-only context), re-read raw file, live data survives.
        await repository.setActiveContext(activeArchiveContext);

        const rawAfterWrite = await readFile(join(root, "post-library.json"), "utf8");
        const onDisk = JSON.parse(rawAfterWrite) as {
          schemaVersion: number;
          posts: Array<{
            metricSnapshots: Array<{ source: string; capturedAt?: string; impressions?: number }>;
            sourceRefs: Array<{ source: string; captureSessionId?: string; sourceHash?: string }>;
          }>;
          profileSnapshots: Array<{ platformUserId: string }>;
        };

        expect(onDisk.schemaVersion).toBe(2);
        expect(onDisk.posts[0]?.metricSnapshots[0]?.source).toBe("x_live_capture");
        expect(onDisk.posts[0]?.metricSnapshots[0]?.impressions).toBe(4200);
        expect(onDisk.posts[0]?.sourceRefs[0]?.source).toBe("x_live_capture");
        expect(onDisk.posts[0]?.sourceRefs[0]?.captureSessionId).toBe("session-1");
        expect(onDisk.posts[0]?.sourceRefs[0]?.sourceHash).toBeUndefined();
        expect(onDisk.profileSnapshots[0]?.platformUserId).toBe("user-123");
      });
    });

    it("validates a single post carrying both an archive and a live metric snapshot and keeps both through dedup", async () => {
      await withTempRoot(async (root) => {
        const mixedStore = JSON.stringify(
          {
            schemaVersion: 2,
            updatedAt: "2026-06-20T09:00:00.000Z",
            posts: [
              {
                id: "post-mixed-1",
                platform: "x",
                platformPostId: "1900000000000000002",
                text: "An archive post later observed live.",
                createdAt: "2024-05-01T12:00:00.000Z",
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
                  favoriteCount: 5,
                  retweetCount: 1,
                },
                metricSnapshots: [
                  {
                    source: "archive_tweets_js",
                    observedAt: "2024-05-01T12:00:00.000Z",
                    importedAt,
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
                    importRunId: "import-legacy-2",
                    rawId: "1900000000000000002",
                    sourceHash,
                  },
                  {
                    source: "x_live_capture",
                    captureSessionId: "session-2",
                    rawId: "1900000000000000002",
                  },
                ],
                updatedAt: "2026-06-20T09:00:00.000Z",
              },
            ],
            importRuns: [],
            derivedInsights: [],
            activeContext: { status: "empty" },
            profileSnapshots: [],
          },
          null,
          2,
        );
        await writeFile(join(root, "post-library.json"), mixedStore, "utf8");
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const repository = new JsonFilePostLibraryRepository({ root });

        const store = await repository.loadStore().finally(() => errorSpy.mockRestore());

        expect(store.posts).toHaveLength(1);
        const sources = store.posts[0]?.metricSnapshots.map((snapshot) => snapshot.source).sort();
        expect(sources).toEqual(["archive_tweets_js", "x_live_capture"]);
        const refSources = store.posts[0]?.sourceRefs.map((ref) => ref.source).sort();
        expect(refSources).toEqual(["archive_tweets_js", "x_live_capture"]);

        // Re-upsert the same post via the typed (archive) API; the distinct-discriminant
        // live entries must survive the uniqueBy dedup unchanged.
        await repository.upsertPosts([
          post({
            id: "post-mixed-1",
            platformPostId: "1900000000000000002",
            text: "An archive post later observed live.",
            createdAt: "2024-05-01T12:00:00.000Z",
            weakMetrics: { favoriteCount: 5, retweetCount: 1 },
            metricSnapshots: [
              {
                source: "archive_tweets_js",
                observedAt: "2024-05-01T12:00:00.000Z",
                importedAt,
                favoriteCount: 5,
                retweetCount: 1,
              },
            ],
            sourceRefs: [
              {
                source: "archive_tweets_js",
                importRunId: "import-legacy-2",
                rawId: "1900000000000000002",
                sourceHash,
              },
            ],
          }),
        ]);

        const merged = await repository.loadStore();

        expect(merged.posts).toHaveLength(1);
        expect(
          merged.posts[0]?.metricSnapshots.map((snapshot) => snapshot.source).sort(),
        ).toEqual(["archive_tweets_js", "x_live_capture"]);
        expect(merged.posts[0]?.metricSnapshots).toHaveLength(2);
        expect(merged.posts[0]?.sourceRefs.map((ref) => ref.source).sort()).toEqual([
          "archive_tweets_js",
          "x_live_capture",
        ]);
        expect(merged.posts[0]?.sourceRefs).toHaveLength(2);
      });
    });

    it("dedups live source refs on captureSessionId and rawId without referencing sourceHash", async () => {
      await withTempRoot(async (root) => {
        // Two posts that merge into one platform key; both carry the SAME live ref key
        // ([source, captureSessionId, rawId]) so the live ref must dedup to one.
        const baseStore = JSON.stringify(
          {
            schemaVersion: 2,
            updatedAt: "2026-06-20T09:00:00.000Z",
            posts: [
              {
                id: "post-live-dedup",
                platform: "x",
                platformPostId: "1900000000000000003",
                text: "Live dedup probe.",
                createdAt: "2026-06-19T18:00:00.000Z",
                kind: "original",
                language: "en",
                replyReferences: {},
                entityFlags: {
                  hasUrls: false,
                  hasMedia: false,
                  hasHashtags: false,
                  hasMentions: false,
                },
                weakMetrics: {},
                metricSnapshots: [
                  {
                    source: "x_live_capture",
                    capturedAt: "2026-06-20T08:55:00.000Z",
                    impressions: 100,
                  },
                  {
                    source: "x_live_capture",
                    capturedAt: "2026-06-20T08:55:00.000Z",
                    impressions: 100,
                  },
                ],
                sourceRefs: [
                  {
                    source: "x_live_capture",
                    captureSessionId: "session-3",
                    rawId: "1900000000000000003",
                  },
                  {
                    source: "x_live_capture",
                    captureSessionId: "session-3",
                    rawId: "1900000000000000003",
                  },
                ],
                updatedAt: "2026-06-20T09:00:00.000Z",
              },
            ],
            importRuns: [],
            derivedInsights: [],
            activeContext: { status: "empty" },
            profileSnapshots: [],
          },
          null,
          2,
        );
        await writeFile(join(root, "post-library.json"), baseStore, "utf8");
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const repository = new JsonFilePostLibraryRepository({ root });

        // Re-upsert the same platform key carrying an identical live ref to force a
        // mergePost + uniqueBy(sourceRefKey) over the live variant. Pre-Green, upsertPosts
        // calls loadStore which rejects the v2 file (logs once) -> silence that log.
        await repository
          .upsertPosts([
            post({
              id: "post-live-dedup",
              platformPostId: "1900000000000000003",
              text: "Live dedup probe via archive re-upsert.",
              createdAt: "2026-06-19T18:00:00.000Z",
              weakMetrics: {},
              metricSnapshots: [],
              sourceRefs: [],
            }),
          ])
          .finally(() => errorSpy.mockRestore());

        const store = await repository.loadStore();

        expect(store.posts).toHaveLength(1);
        const liveSourceRefs = liveRefs(store.posts[0]?.sourceRefs ?? []);
        expect(liveSourceRefs).toHaveLength(1);
        expect(liveSourceRefs[0]?.captureSessionId).toBe("session-3");
      });
    });
  });
});
