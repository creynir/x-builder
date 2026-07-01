import { describe, expect, it } from "vitest";

import { openEngineDatabase } from "../../server/open-engine-database.js";
import { SqliteObservedThreadRepository } from "../../server/sqlite-observed-thread-repository.js";
import { SqlitePostLibraryRepository } from "../../server/sqlite-post-library-repository.js";
import { LiveCaptureService } from "../live-capture-service.js";

describe("LiveCaptureService observed thread storage", () => {
  it("stores observed thread posts without treating non-own observed posts as canonical own posts", async () => {
    const db = openEngineDatabase(":memory:");
    const postLibraryRepository = new SqlitePostLibraryRepository(db);
    const observedThreadRepository = new SqliteObservedThreadRepository(db);
    const service = new LiveCaptureService(postLibraryRepository, observedThreadRepository);

    await service.ingest({
      posts: [
        {
          platformPostId: "200",
          text: "Own reply from live capture.",
          createdAt: "2026-07-01T08:00:00.000Z",
          kind: "reply",
          replyReferences: { inReplyToPostId: "100" },
          entityFlags: {
            hasUrls: false,
            hasMedia: false,
            hasHashtags: false,
            hasMentions: false,
          },
          liveMetrics: { likes: 1, replies: 0 },
          capturedAt: "2026-07-01T08:01:00.000Z",
        },
      ],
      observedThreadPosts: [
        {
          source: "x_graphql_observed",
          statusId: "100",
          text: "Parent post from observed GraphQL.",
          authorHandle: "alice",
          observedAt: "2026-07-01T08:01:00.000Z",
        },
      ],
    });

    expect((await postLibraryRepository.loadStore()).posts.map((post) => post.platformPostId)).toEqual([
      "200",
    ]);
    await expect(observedThreadRepository.findByStatusId("100")).resolves.toMatchObject({
      source: "x_graphql_observed",
      statusId: "100",
      text: "Parent post from observed GraphQL.",
    });
    await expect(observedThreadRepository.findByStatusId("200")).resolves.toMatchObject({
      source: "x_live_capture",
      statusId: "200",
      inReplyToStatusId: "100",
      text: "Own reply from live capture.",
    });
  });

  it("does not let duplicate or invalid own projections clobber observed thread storage", async () => {
    const db = openEngineDatabase(":memory:");
    const postLibraryRepository = new SqlitePostLibraryRepository(db);
    const observedThreadRepository = new SqliteObservedThreadRepository(db);
    const service = new LiveCaptureService(postLibraryRepository, observedThreadRepository);

    const response = await service.ingest({
      posts: [
        {
          platformPostId: "201",
          text: "First own reply.",
          createdAt: "2026-07-01T08:00:00.000Z",
          kind: "reply",
          replyReferences: { inReplyToPostId: "100" },
          entityFlags: {
            hasUrls: false,
            hasMedia: false,
            hasHashtags: false,
            hasMentions: false,
          },
          liveMetrics: { likes: 2 },
          capturedAt: "2026-07-01T08:01:00.000Z",
        },
        {
          platformPostId: "201",
          text: "Duplicate own reply.",
          createdAt: "2026-07-01T08:00:00.000Z",
          kind: "reply",
          replyReferences: { inReplyToPostId: "100" },
          entityFlags: {
            hasUrls: false,
            hasMedia: false,
            hasHashtags: false,
            hasMentions: false,
          },
          liveMetrics: { likes: 9 },
          capturedAt: "2026-07-01T08:02:00.000Z",
        },
        {
          platformPostId: "not-a-status-id",
          text: "Canonical capture remains valid even though thread projection is not.",
          createdAt: "2026-07-01T08:03:00.000Z",
          kind: "original",
          replyReferences: {},
          entityFlags: {
            hasUrls: false,
            hasMedia: false,
            hasHashtags: false,
            hasMentions: false,
          },
          liveMetrics: {},
          capturedAt: "2026-07-01T08:03:00.000Z",
        },
      ],
    });

    expect(response.duplicateCount).toBe(1);
    expect(
      (await postLibraryRepository.loadStore()).posts
        .map((post) => post.platformPostId)
        .sort(),
    ).toEqual(["201", "not-a-status-id"]);
    await expect(observedThreadRepository.findByStatusId("201")).resolves.toMatchObject({
      statusId: "201",
      text: "First own reply.",
      weakMetrics: { likes: 2 },
    });
    await expect(observedThreadRepository.findByStatusId("not-a-status-id")).resolves.toBeUndefined();
  });
});
