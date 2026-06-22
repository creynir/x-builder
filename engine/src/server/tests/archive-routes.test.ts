import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  apiErrorSchema,
  archiveImportOverviewSchema,
  archiveContextActivationResponseSchema,
  archiveInsightsLatestResponseSchema,
  archivePostsPageSchema,
  archiveTweetsImportResponseSchema,
  archiveTweetsValidateResponseSchema,
} from "@x-builder/shared";
import { describe, expect, it } from "vitest";

import { buildServer } from "../server";
import {
  JsonFilePostLibraryRepository,
  PostLibraryStorageError,
  type PostLibraryRepository,
} from "../post-library-repository";

const tweetsJs = `window.YTD.tweets.part0 = [
  {
    "tweet": {
      "id_str": "1800000000000000001",
      "full_text": "A compact archive post",
      "created_at": "Fri Jan 05 12:00:00 +0000 2024",
      "favorite_count": "12",
      "retweet_count": "3"
    }
  }
];`;

const request = {
  fileName: "tweets.js",
  fileSizeBytes: tweetsJs.length,
  contents: tweetsJs,
};

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-archive-routes-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("archive routes", () => {
  it("validates supported tweets.js contents without persisting posts", async () => {
    await withTempRoot(async (root) => {
      const postLibraryRepository = new JsonFilePostLibraryRepository({ root });
      const app = buildServer({ postLibraryRepository });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/archive/tweets/validate",
          payload: request,
        });
        const result = archiveTweetsValidateResponseSchema.parse(parseJsonPayload(response.body));
        const overview = await postLibraryRepository.loadStore();

        expect(response.statusCode).toBe(200);
        expect(result.status).toBe("valid");
        expect(result.counts.validPosts).toBe(1);
        expect(overview.posts).toHaveLength(0);
      } finally {
        await app.close();
      }
    });
  });

  it("imports tweets.js contents once and merges duplicates on a second import", async () => {
    await withTempRoot(async (root) => {
      const app = buildServer({
        postLibraryRepository: new JsonFilePostLibraryRepository({ root }),
      });

      try {
        const first = await app.inject({
          method: "POST",
          url: "/archive/tweets/import",
          payload: {
            ...request,
            duplicatePolicy: "merge_update",
          },
        });
        const second = await app.inject({
          method: "POST",
          url: "/archive/tweets/import",
          payload: {
            ...request,
            duplicatePolicy: "merge_update",
          },
        });
        const latest = await app.inject({
          method: "GET",
          url: "/archive/imports/latest",
        });
        const page = await app.inject({
          method: "GET",
          url: "/archive/posts?limit=10",
        });

        const firstImport = archiveTweetsImportResponseSchema.parse(parseJsonPayload(first.body));
        const secondImport = archiveTweetsImportResponseSchema.parse(parseJsonPayload(second.body));
        const overview = archiveImportOverviewSchema.parse(parseJsonPayload(latest.body));
        const postsPage = archivePostsPageSchema.parse(parseJsonPayload(page.body));

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(200);
        expect(firstImport.importRun.counts.insertedPosts).toBe(1);
        expect(secondImport.importRun.counts.insertedPosts).toBe(0);
        expect(secondImport.importRun.counts.updatedPosts + secondImport.importRun.counts.unchangedPosts).toBe(1);
        expect(overview.status).toBe("ready");
        if (overview.status !== "ready") {
          throw new Error("Expected latest import overview.");
        }
        expect(overview.postCount).toBe(1);
        expect(postsPage.items).toHaveLength(1);
      } finally {
        await app.close();
      }
    });
  });

  it("rejects malformed archive post cursors", async () => {
    await withTempRoot(async (root) => {
      const app = buildServer({
        postLibraryRepository: new JsonFilePostLibraryRepository({ root }),
      });

      try {
        const response = await app.inject({
          method: "GET",
          url: "/archive/posts?cursor=not-a-cursor",
        });
        const error = apiErrorSchema.parse(parseJsonPayload(response.body));

        expect(response.statusCode).toBe(400);
        expect(error).toMatchObject({
          code: "validation_failed",
          scope: "field",
          retryable: false,
        });
        expect(error.fieldErrors).toHaveProperty("cursor");
      } finally {
        await app.close();
      }
    });
  });

  it("returns invalid validation for unrelated archive contents without persisting posts", async () => {
    await withTempRoot(async (root) => {
      const repository = new JsonFilePostLibraryRepository({ root });
      const app = buildServer({ postLibraryRepository: repository });

      try {
        const response = await app.inject({
          method: "POST",
          url: "/archive/tweets/validate",
          payload: {
            fileName: "like.js",
            fileSizeBytes: 28,
            contents: "window.YTD.like.part0 = [];",
          },
        });
        const result = archiveTweetsValidateResponseSchema.parse(parseJsonPayload(response.body));
        const store = await repository.loadStore();

        expect(response.statusCode).toBe(200);
        expect(result.status).toBe("invalid");
        expect(store.posts).toHaveLength(0);
      } finally {
        await app.close();
      }
    });
  });

  it("normalizes storage failures during import", async () => {
    const failingRepository: PostLibraryRepository = {
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
    };
    const app = buildServer({ postLibraryRepository: failingRepository });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/archive/tweets/import",
        payload: {
          ...request,
          duplicatePolicy: "merge_update",
        },
      });
      const error = apiErrorSchema.parse(parseJsonPayload(response.body));

      expect(response.statusCode).toBe(500);
      expect(error).toMatchObject({
        code: "archive_storage_failed",
        scope: "archive",
        retryable: true,
      });
    } finally {
      await app.close();
    }
  });

  it("returns latest insights and activates/deactivates archive context", async () => {
    await withTempRoot(async (root) => {
      const app = buildServer({
        postLibraryRepository: new JsonFilePostLibraryRepository({ root }),
      });

      try {
        const manyTweets = `window.YTD.tweets.part0 = [${Array.from(
          { length: 20 },
          (_, index) => `{"tweet":{"id_str":"${index + 1}","full_text":"Useful writing loop ${index + 1}","created_at":"Fri Jan ${String((index % 9) + 10).padStart(2, "0")} 12:00:00 +0000 2024","favorite_count":"${index + 1}","retweet_count":"1"}}`,
        ).join(",")}];`;
        await app.inject({
          method: "POST",
          url: "/archive/tweets/import",
          payload: {
            fileName: "tweets.js",
            fileSizeBytes: manyTweets.length,
            contents: manyTweets,
            duplicatePolicy: "merge_update",
          },
        });

        const insightsResponse = await app.inject({
          method: "GET",
          url: "/archive/insights/latest",
        });
        const activateResponse = await app.inject({
          method: "POST",
          url: "/archive/context/activate",
        });
        const activeResponse = await app.inject({
          method: "GET",
          url: "/archive/context/active",
        });
        const deactivateResponse = await app.inject({
          method: "POST",
          url: "/archive/context/deactivate",
        });

        const insights = archiveInsightsLatestResponseSchema.parse(parseJsonPayload(insightsResponse.body));
        const activated = archiveContextActivationResponseSchema.parse(parseJsonPayload(activateResponse.body));
        const active = archiveContextActivationResponseSchema.shape.activeContext.parse(
          parseJsonPayload(activeResponse.body),
        );
        const deactivated = archiveContextActivationResponseSchema.parse(
          parseJsonPayload(deactivateResponse.body),
        );

        expect(insightsResponse.statusCode).toBe(200);
        expect(insights.status).toBe("ready");
        expect(activated.activeContext.status).toBe("active");
        expect(active.status).toBe("active");
        expect(deactivated.activeContext).toEqual({ status: "empty" });
      } finally {
        await app.close();
      }
    });
  });
});
