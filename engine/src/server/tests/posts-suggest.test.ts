import { describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  suggestPostResponseSchema,
  type CooldownReport,
  type SuggestPostRequest,
  type SuggestPostResponse,
} from "@x-builder/shared";

import { buildServer } from "../server";
import { PostLibraryStorageError } from "../post-library-repository";

const parseJson = (payload: string): unknown => JSON.parse(payload);

// The structural shape the route depends on: an object with `suggest`. The
// service class is authored by Green; tests inject this fake through the new
// `suggestPostService` option on BuildServerOptions.
type SuggestPostServiceLike = {
  suggest: (request: SuggestPostRequest) => Promise<SuggestPostResponse>;
};

// `suggestPostService` is the NEW option Green adds to BuildServerOptions. Until
// then this cast is the expected typecheck RED surface for the route tests.
type BuildServerSuggestOptions = Parameters<typeof buildServer>[0] & {
  suggestPostService?: SuggestPostServiceLike;
};

const buildSuggestServer = (suggestPostService: SuggestPostServiceLike) =>
  buildServer({ suggestPostService } as BuildServerSuggestOptions);

const emptyCooldown = (): CooldownReport => ({
  windowDays: 7,
  generatedAt: "2026-06-01T00:00:00.000Z",
  corpusSource: "live",
  signals: [],
});

const readyResponse = (): SuggestPostResponse => ({
  status: "ready",
  suggestions: [
    {
      id: "suggestion-1",
      format: "hot_take",
      angle: "caution",
      text: "An original drafted post in the chosen lane.",
      rationale: "Drafted in the top non-cooldown format.",
      cooldownStatus: "clear",
      sourceExamplePostIds: ["live-000001"],
      generatedBy: "llm",
    },
  ],
  cooldown: emptyCooldown(),
  minimumCorpusSize: 10,
});

const insufficientResponse = (): SuggestPostResponse => ({
  status: "insufficient_corpus",
  suggestions: [],
  cooldown: emptyCooldown(),
  minimumCorpusSize: 10,
});

describe("POST /posts/suggest", () => {
  it("returns 200 with a ready suggestion set", async () => {
    const suggest = vi.fn(async () => readyResponse());
    const app = buildSuggestServer({ suggest });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/suggest",
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(suggest).toHaveBeenCalledOnce();

      const body = suggestPostResponseSchema.parse(parseJson(response.body));
      expect(body.status).toBe("ready");
      expect(body.minimumCorpusSize).toBe(10);
      expect(body.suggestions.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("returns 200 with an insufficient_corpus status", async () => {
    const suggest = vi.fn(async () => insufficientResponse());
    const app = buildSuggestServer({ suggest });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/suggest",
        payload: {},
      });

      expect(response.statusCode).toBe(200);

      const body = suggestPostResponseSchema.parse(parseJson(response.body));
      expect(body.status).toBe("insufficient_corpus");
      expect(body.suggestions).toEqual([]);
      expect(body.minimumCorpusSize).toBe(10);
    } finally {
      await app.close();
    }
  });

  it("maps a PostLibraryStorageError to a 500 library_storage_failed error", async () => {
    const suggest = vi.fn(async () => {
      throw new PostLibraryStorageError("The local post library could not be read.");
    });
    const app = buildSuggestServer({ suggest });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/posts/suggest",
        payload: {},
      });

      expect(response.statusCode).toBe(500);

      const error = apiErrorSchema.parse(parseJson(response.body));
      expect(error).toMatchObject({
        code: "library_storage_failed",
        scope: "library",
        retryable: true,
        status: 500,
      });
    } finally {
      await app.close();
    }
  });
});
