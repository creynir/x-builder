import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CaptureIngestRequest, LiveCapturedPost } from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  JsonFilePostLibraryRepository,
  type MetricSnapshot,
} from "../../server/post-library-repository";
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
