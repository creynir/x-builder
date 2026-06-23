import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiErrorSchema,
  captureSummarySchema,
  type CaptureIngestRequest,
  type CaptureSummary,
  type LiveCapturedPost,
} from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  JsonFilePostLibraryRepository,
  PostLibraryStorageError,
  type CanonicalOwnPostInput,
  type MetricSnapshot,
  type PostLibraryRepository,
} from "../../server/post-library-repository";
import { buildServer } from "../../server/server";
import { LiveCaptureService } from "../live-capture-service";

// The store's metricSnapshots is a TRUE discriminated union on `source`. Narrow to the
// live arm before reading capturedAt/impressions so those reads are statically the live
// variant — no casts, and a read of an archive-only field becomes a compile error.
const liveSnapshots = (snapshots: readonly MetricSnapshot[]) =>
  snapshots.filter(
    (snapshot): snapshot is Extract<MetricSnapshot, { source: "x_live_capture" }> =>
      snapshot.source === "x_live_capture",
  );

// ---------------------------------------------------------------------------
// Per-test isolation: a fresh mkdtemp root and a real repository instance.
// No shared mutable state between tests.
// ---------------------------------------------------------------------------
let root: string;
let repository: JsonFilePostLibraryRepository;
let service: LiveCaptureService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "x-builder-live-capture-"));
  repository = new JsonFilePostLibraryRepository({ root });
  service = new LiveCaptureService(repository);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// A valid LiveCapturedPost fixture. capturedAt comes from the post (not an injected clock),
// so the fixture controls snapshot identity.
const livePost = (overrides: Partial<LiveCapturedPost> = {}): LiveCapturedPost => ({
  platformPostId: "1900000000000000001",
  text: "A live-captured post from the timeline.",
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
  liveMetrics: {
    impressions: 4200,
    likes: 31,
    reposts: 4,
    replies: 2,
    quotes: 1,
    bookmarks: 6,
  },
  capturedAt: "2026-06-20T08:55:00.000Z",
  ...overrides,
});

const request = (overrides: Partial<CaptureIngestRequest> = {}): CaptureIngestRequest => ({
  posts: [livePost()],
  ...overrides,
});

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

// ---------------------------------------------------------------------------
// Canonical-post fixtures for summary(): seeded directly through upsertPosts so
// each test controls the exact post count and the archive-vs-live snapshot mix
// (ingest() would force every post to carry a live snapshot, which the
// archive-only and mixed-snapshot summary cases must avoid).
// ---------------------------------------------------------------------------
const baseEntityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

let summaryIdCounter = 0;

// An archive-only post: no x_live_capture snapshot, so it contributes to
// postsCaptured but never to lastCaptureAt.
const archiveOnlyPost = (
  overrides: Partial<CanonicalOwnPostInput> = {},
): CanonicalOwnPostInput => {
  summaryIdCounter += 1;
  const platformPostId = `180000000000000${String(summaryIdCounter).padStart(4, "0")}`;
  const observedAt = "2026-05-01T00:00:00.000Z";

  return {
    id: `summary-archive-${summaryIdCounter}`,
    platform: "x",
    platformPostId,
    text: "An archive-imported post.",
    createdAt: observedAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt,
        importedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
    sourceRefs: [
      {
        source: "archive_tweets_js",
        importRunId: "summary-import-1",
        rawId: platformPostId,
        sourceHash:
          "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd",
      },
    ],
    ...overrides,
  };
};

// A post carrying a single x_live_capture snapshot with an explicit capturedAt,
// the value that feeds lastCaptureAt.
const liveSnapshotPost = (
  capturedAt: string,
  overrides: Partial<CanonicalOwnPostInput> = {},
): CanonicalOwnPostInput => {
  summaryIdCounter += 1;
  const platformPostId = `190000000000000${String(summaryIdCounter).padStart(4, "0")}`;

  return {
    id: `summary-live-${summaryIdCounter}`,
    platform: "x",
    platformPostId,
    text: "A live-captured post.",
    createdAt: "2026-06-19T18:00:00.000Z",
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "x_live_capture",
        capturedAt,
        impressions: 1200,
      },
    ],
    sourceRefs: [
      {
        source: "x_live_capture",
        captureSessionId: "summary-session-1",
        rawId: platformPostId,
      },
    ],
    ...overrides,
  };
};

// A repository whose every read fails with PostLibraryStorageError. Drives
// summary() (and the route) into the storage-failure path for the 500 test.
const failingRepository = (): PostLibraryRepository => ({
  loadStore: async () => {
    throw new PostLibraryStorageError("boom");
  },
  upsertPosts: async () => {
    throw new PostLibraryStorageError("boom");
  },
  saveImportRun: async () => undefined,
  saveDerivedInsights: async () => undefined,
  setActiveContext: async () => undefined,
  pushProfileSnapshot: async () => undefined,
});

beforeEach(() => {
  summaryIdCounter = 0;
});

describe("LiveCaptureService.ingest", () => {
  // Coverage 1 + AC (empty corpus, single insert).
  it("inserts a single live post into an empty corpus with profile unapplied", async () => {
    const response = await service.ingest(request());

    expect(response.insertedCount).toBe(1);
    expect(response.updatedCount).toBe(0);
    expect(response.duplicateCount).toBe(0);
    expect(response.corpusSize).toBe(1);
    expect(response.profileApplied).toBe(false);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.platformPostId).toBe("1900000000000000001");
  });

  // Coverage 2 + AC (accumulate two snapshots on the same post across two calls).
  it("accumulates two live metric snapshots for the same platform post across two calls", async () => {
    await service.ingest(
      request({
        posts: [
          livePost({
            capturedAt: "2026-06-20T08:55:00.000Z",
            liveMetrics: { impressions: 4200, likes: 31 },
          }),
        ],
      }),
    );

    const second = await service.ingest(
      request({
        posts: [
          livePost({
            capturedAt: "2026-06-20T10:30:00.000Z",
            liveMetrics: { impressions: 5100, likes: 40 },
          }),
        ],
      }),
    );

    expect(second.updatedCount).toBe(1);
    expect(second.insertedCount).toBe(0);
    expect(second.corpusSize).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);

    const snapshots = liveSnapshots(store.posts[0]?.metricSnapshots ?? []);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.capturedAt).sort()).toEqual([
      "2026-06-20T08:55:00.000Z",
      "2026-06-20T10:30:00.000Z",
    ]);
    expect(snapshots.map((snapshot) => snapshot.impressions).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      4200, 5100,
    ]);
  });

  // Coverage 3 + AC (profile present -> applied and persisted as a profile snapshot).
  it("applies and persists a profile snapshot when the request carries a profile", async () => {
    const response = await service.ingest(
      request({
        profile: {
          platformUserId: "user-123",
          screenName: "founder",
          followers: 980,
          capturedAt: "2026-06-20T08:55:00.000Z",
        },
      }),
    );

    expect(response.profileApplied).toBe(true);

    const store = await repository.loadStore();
    expect(store.profileSnapshots).toHaveLength(1);
    expect(store.profileSnapshots[0]?.platformUserId).toBe("user-123");
    expect(store.profileSnapshots[0]?.screenName).toBe("founder");
    expect(store.profileSnapshots[0]?.followers).toBe(980);
  });

  // Coverage 4 + AC (malformed item: platformPostId > 160 chars -> tolerated/skipped, no throw).
  it("tolerates and skips a malformed item while inserting the valid items", async () => {
    const overlongId = "9".repeat(161);

    const response = await service.ingest({
      posts: [
        livePost({ platformPostId: overlongId, text: "Malformed: platformPostId too long." }),
        livePost({ platformPostId: "1900000000000000010", text: "Valid neighbour post." }),
      ],
    });

    expect(response.insertedCount).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.platformPostId).toBe("1900000000000000010");
  });

  // Coverage 5 + Edge (duplicate platformPostId within one batch -> duplicate counted, one post,
  // first item's data wins).
  it("counts an in-batch duplicate platform post id and keeps a single post with the first item's data", async () => {
    const response = await service.ingest({
      posts: [
        livePost({ platformPostId: "1900000000000000020", text: "First occurrence text." }),
        livePost({ platformPostId: "1900000000000000020", text: "Second occurrence text." }),
      ],
    });

    expect(response.duplicateCount).toBeGreaterThanOrEqual(1);
    expect(response.corpusSize).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.text).toBe("First occurrence text.");
  });

  // Coverage 6 / AC (batch of 200 distinct posts -> all inserted).
  it("inserts a full batch of 200 distinct posts", async () => {
    const posts = Array.from({ length: 200 }, (_, index) =>
      livePost({
        platformPostId: `19000000000000${String(index).padStart(5, "0")}`,
        text: `Distinct post number ${index}.`,
      }),
    );

    const response = await service.ingest({ posts });

    expect(response.insertedCount).toBe(200);
    expect(response.corpusSize).toBe(200);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(200);
  });

  // Edge 7a (empty posts, no profile -> succeeds, no write, corpus reflects existing).
  it("succeeds without writing posts when the batch is empty and reflects the existing corpus", async () => {
    await service.ingest(request({ posts: [livePost({ platformPostId: "1900000000000000030" })] }));

    const response = await service.ingest({ posts: [] });

    expect(response.insertedCount).toBe(0);
    expect(response.updatedCount).toBe(0);
    expect(response.duplicateCount).toBe(0);
    expect(response.profileApplied).toBe(false);
    expect(response.corpusSize).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
  });

  // Edge 7b (empty posts but a profile present -> profileApplied tracks the profile, profile persisted).
  it("applies a profile even when the posts batch is empty", async () => {
    const response = await service.ingest({
      posts: [],
      profile: {
        platformUserId: "user-456",
        screenName: "ghost",
        capturedAt: "2026-06-20T09:00:00.000Z",
      },
    });

    expect(response.insertedCount).toBe(0);
    expect(response.corpusSize).toBe(0);
    expect(response.profileApplied).toBe(true);

    const store = await repository.loadStore();
    expect(store.profileSnapshots).toHaveLength(1);
    expect(store.profileSnapshots[0]?.platformUserId).toBe("user-456");
  });

  // Edge 8 (liveMetrics fields absent -> snapshot created, all metric fields undefined, no error).
  it("creates a live snapshot with all metric fields undefined when liveMetrics is absent", async () => {
    const { liveMetrics: _omit, ...withoutMetrics } = livePost({
      platformPostId: "1900000000000000040",
    });

    const response = await service.ingest({ posts: [withoutMetrics as LiveCapturedPost] });

    expect(response.insertedCount).toBe(1);

    const store = await repository.loadStore();
    const snapshots = liveSnapshots(store.posts[0]?.metricSnapshots ?? []);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.source).toBe("x_live_capture");
    expect(snapshots[0]?.capturedAt).toBe("2026-06-20T08:55:00.000Z");
    expect(snapshots[0]?.impressions).toBeUndefined();
    expect(snapshots[0]?.likes).toBeUndefined();
    expect(snapshots[0]?.reposts).toBeUndefined();
    expect(snapshots[0]?.replies).toBeUndefined();
    expect(snapshots[0]?.quotes).toBeUndefined();
    expect(snapshots[0]?.bookmarks).toBeUndefined();
  });

  // Edge 9a (text exactly 8000 chars -> accepted).
  it("accepts a post whose text is exactly 8000 characters", async () => {
    const response = await service.ingest({
      posts: [livePost({ platformPostId: "1900000000000000050", text: "a".repeat(8_000) })],
    });

    expect(response.insertedCount).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.text.length).toBe(8_000);
  });

  // Edge 9b (text over 8000 chars -> skipped, valid neighbour inserted, no throw).
  it("skips a post whose text exceeds 8000 characters while inserting valid items", async () => {
    const response = await service.ingest({
      posts: [
        livePost({ platformPostId: "1900000000000000060", text: "b".repeat(8_001) }),
        livePost({ platformPostId: "1900000000000000061", text: "Valid post alongside the oversized one." }),
      ],
    });

    expect(response.insertedCount).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.platformPostId).toBe("1900000000000000061");
  });

  // Coverage 2 cross-check: the live source ref is keyed by captureSessionId + rawId(=platformPostId).
  it("attaches a live source ref keyed by the platform post id as rawId", async () => {
    await service.ingest({
      posts: [livePost({ platformPostId: "1900000000000000070" })],
    });

    const store = await repository.loadStore();
    const refs = (store.posts[0]?.sourceRefs ?? []).filter(
      (ref): ref is Extract<(typeof store.posts)[number]["sourceRefs"][number], { source: "x_live_capture" }> =>
        ref.source === "x_live_capture",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]?.rawId).toBe("1900000000000000070");
    expect(refs[0]?.captureSessionId.length).toBeGreaterThan(0);
  });
});

describe("LiveCaptureService.summary", () => {
  // Coverage 1 + AC: 3 posts plus a single profile snapshot ->
  // postsCaptured 3, followers/screenName/profileCapturedAt from that snapshot.
  it("returns post count plus the most-recent profile fields", async () => {
    await repository.upsertPosts([
      liveSnapshotPost("2026-06-20T08:00:00.000Z"),
      liveSnapshotPost("2026-06-20T09:00:00.000Z"),
      liveSnapshotPost("2026-06-20T10:00:00.000Z"),
    ]);
    await repository.pushProfileSnapshot({
      platformUserId: "user-alice",
      screenName: "alice",
      followers: 8000,
      capturedAt: "2026-06-20T10:05:00.000Z",
    });

    const summary: CaptureSummary = await service.summary();

    expect(captureSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.postsCaptured).toBe(3);
    expect(summary.followers).toBe(8000);
    expect(summary.screenName).toBe("alice");
    expect(summary.profileCapturedAt).toBe("2026-06-20T10:05:00.000Z");
  });

  // Coverage 2: lastCaptureAt is the max capturedAt across every x_live_capture
  // snapshot in the store (here spread across three separate posts).
  it("reports the maximum capturedAt across all live snapshots as lastCaptureAt", async () => {
    await repository.upsertPosts([
      liveSnapshotPost("2026-06-20T08:00:00.000Z"),
      liveSnapshotPost("2026-06-20T11:30:00.000Z"),
      liveSnapshotPost("2026-06-20T09:15:00.000Z"),
    ]);

    const summary = await service.summary();

    expect(summary.postsCaptured).toBe(3);
    expect(summary.lastCaptureAt).toBe("2026-06-20T11:30:00.000Z");
  });

  // Coverage 3 + AC: empty store -> only postsCaptured: 0, every optional field
  // ABSENT (not null), and no exception.
  it("returns only postsCaptured: 0 for an empty store with all optionals absent", async () => {
    const summary = await service.summary();

    expect(captureSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.postsCaptured).toBe(0);
    expect(summary).not.toHaveProperty("lastCaptureAt");
    expect(summary).not.toHaveProperty("followers");
    expect(summary).not.toHaveProperty("screenName");
    expect(summary).not.toHaveProperty("profileCapturedAt");
  });

  // Coverage 4 + AC: archive-only corpus (no live snapshots, no profiles) ->
  // postsCaptured counts the posts; lastCaptureAt/followers/screenName/
  // profileCapturedAt all absent.
  it("counts archive-only posts but omits live and profile fields", async () => {
    await repository.upsertPosts([
      archiveOnlyPost(),
      archiveOnlyPost(),
      archiveOnlyPost(),
      archiveOnlyPost(),
    ]);

    const summary = await service.summary();

    expect(summary.postsCaptured).toBe(4);
    expect(summary).not.toHaveProperty("lastCaptureAt");
    expect(summary).not.toHaveProperty("followers");
    expect(summary).not.toHaveProperty("screenName");
    expect(summary).not.toHaveProperty("profileCapturedAt");
  });

  // Coverage 5: two profile snapshots, the most-recent (by capturedAt) carries
  // followers 9000 -> that value wins.
  it("reads followers from the most-recent profile snapshot", async () => {
    await repository.pushProfileSnapshot({
      platformUserId: "user-x",
      screenName: "earlier",
      followers: 5000,
      capturedAt: "2026-06-20T08:00:00.000Z",
    });
    await repository.pushProfileSnapshot({
      platformUserId: "user-x",
      screenName: "later",
      followers: 9000,
      capturedAt: "2026-06-20T12:00:00.000Z",
    });

    const summary = await service.summary();

    expect(summary.followers).toBe(9000);
    expect(summary.screenName).toBe("later");
    expect(summary.profileCapturedAt).toBe("2026-06-20T12:00:00.000Z");
  });

  // Edge: most-recent profile snapshot has no follower count -> followers field
  // absent while screenName and profileCapturedAt are still present.
  it("omits followers when the most-recent profile snapshot has no follower count", async () => {
    await repository.pushProfileSnapshot({
      platformUserId: "user-y",
      screenName: "countless",
      capturedAt: "2026-06-20T13:00:00.000Z",
    });

    const summary = await service.summary();

    expect(summary).not.toHaveProperty("followers");
    expect(summary.screenName).toBe("countless");
    expect(summary.profileCapturedAt).toBe("2026-06-20T13:00:00.000Z");
  });

  // Edge: two profile snapshots share the same capturedAt -> the tie breaks to
  // the first in array order (followers 1111, the earlier-pushed entry).
  it("breaks a same-capturedAt profile tie toward the first in array order", async () => {
    await repository.pushProfileSnapshot({
      platformUserId: "user-tie",
      screenName: "first-in-order",
      followers: 1111,
      capturedAt: "2026-06-20T14:00:00.000Z",
    });
    await repository.pushProfileSnapshot({
      platformUserId: "user-tie",
      screenName: "second-in-order",
      followers: 2222,
      capturedAt: "2026-06-20T14:00:00.000Z",
    });

    const summary = await service.summary();

    expect(summary.followers).toBe(1111);
    expect(summary.screenName).toBe("first-in-order");
    expect(summary.profileCapturedAt).toBe("2026-06-20T14:00:00.000Z");
  });

  // Edge: a post carrying both an archive and a live snapshot. lastCaptureAt
  // considers only the live snapshot; postsCaptured counts every post regardless
  // of source mix.
  it("considers only live snapshots for lastCaptureAt while counting every post", async () => {
    const mixedPost = liveSnapshotPost("2026-06-20T07:00:00.000Z", {
      metricSnapshots: [
        {
          source: "archive_tweets_js",
          observedAt: "2026-06-25T00:00:00.000Z",
          importedAt: "2026-06-25T01:00:00.000Z",
        },
        {
          source: "x_live_capture",
          capturedAt: "2026-06-20T07:00:00.000Z",
          impressions: 900,
        },
      ],
    });
    await repository.upsertPosts([
      mixedPost,
      archiveOnlyPost(),
    ]);

    const summary = await service.summary();

    // Both posts counted; the archive snapshot's later observedAt is ignored, so
    // lastCaptureAt is the lone live capturedAt.
    expect(summary.postsCaptured).toBe(2);
    expect(summary.lastCaptureAt).toBe("2026-06-20T07:00:00.000Z");
  });

  // Edge / AC: summary() re-throws PostLibraryStorageError from loadStore.
  it("re-throws PostLibraryStorageError raised by the repository read", async () => {
    const throwingService = new LiveCaptureService(failingRepository());

    await expect(throwingService.summary()).rejects.toBeInstanceOf(PostLibraryStorageError);
  });
});

describe("GET /capture/summary route", () => {
  // Coverage 6 + AC: a seeded corpus served over HTTP -> 200, body parses as
  // captureSummarySchema with the expected post count and profile fields.
  it("responds 200 with a captureSummarySchema body for a seeded corpus", async () => {
    await repository.upsertPosts([
      liveSnapshotPost("2026-06-20T08:00:00.000Z"),
      liveSnapshotPost("2026-06-20T09:30:00.000Z"),
    ]);
    await repository.pushProfileSnapshot({
      platformUserId: "user-bob",
      screenName: "bob",
      followers: 12000,
      capturedAt: "2026-06-20T09:45:00.000Z",
    });

    const liveCaptureService = new LiveCaptureService(repository);
    const app = buildServer({
      postLibraryRepository: repository,
      liveCaptureService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/summary",
      });

      expect(response.statusCode).toBe(200);
      const body = captureSummarySchema.parse(parseJsonPayload(response.body));
      expect(body.postsCaptured).toBe(2);
      expect(body.followers).toBe(12000);
      expect(body.screenName).toBe("bob");
      expect(body.lastCaptureAt).toBe("2026-06-20T09:30:00.000Z");
      expect(body.profileCapturedAt).toBe("2026-06-20T09:45:00.000Z");
    } finally {
      await app.close();
    }
  });

  // Coverage 7 + AC: the route's service reads through a repository that throws
  // PostLibraryStorageError -> 500 with code "library_storage_failed".
  it("responds 500 with library_storage_failed when the repository read fails", async () => {
    const repo = failingRepository();
    const throwingService = new LiveCaptureService(repo);
    const app = buildServer({
      postLibraryRepository: repo,
      liveCaptureService: throwingService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/summary",
      });

      expect(response.statusCode).toBe(500);
      const error = apiErrorSchema.parse(parseJsonPayload(response.body));
      expect(error.code).toBe("library_storage_failed");
    } finally {
      await app.close();
    }
  });
});
