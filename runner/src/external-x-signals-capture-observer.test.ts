import {
  LiveCaptureService,
  SqlitePostLibraryRepository,
  openEngineDatabase,
} from "@x-builder/engine";
import type {
  ExternalXSignalSource,
  GetExternalXSignalsOverviewResponse,
} from "@x-builder/shared";
import { describe, expect, it, vi } from "vitest";

import { ExternalXSignalsCaptureObserver } from "./external-x-signals-capture-observer.js";
import { GraphQlCaptureObserver, type ResponseLike } from "./graphql-capture-observer.js";

import userTweetsValid from "./__fixtures__/graphql/user-tweets-valid.json";
import userByScreenNameValid from "./__fixtures__/graphql/user-by-screen-name-valid.json";

const NOW = "2026-06-28T12:00:00.000Z";
const URL_USER_TWEETS = "https://x.com/i/api/graphql/abc123/UserTweets?variables=%7B%7D";
const URL_USER_BY_SCREEN_NAME =
  "https://x.com/i/api/graphql/ghi789/UserByScreenName?variables=%7B%7D";
const URL_HOME_TIMELINE = "https://x.com/i/api/graphql/zzz000/HomeTimeline?variables=%7B%7D";

const source = (overrides: Partial<ExternalXSignalSource> = {}): ExternalXSignalSource => ({
  id: "external-source-1",
  platform: "x",
  screenName: "indie_hacker",
  platformUserId: "44196397",
  status: "active",
  evidenceCount: 0,
  patternCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

type ResponseHandler = (response: ResponseLike) => unknown;

function createMultiContext() {
  const handlers: ResponseHandler[] = [];
  const on = vi.fn((event: string, handler: ResponseHandler) => {
    if (event === "response") {
      handlers.push(handler);
    }
  });

  return {
    context: { on },
    on,
    handlers,
    async fire(response: ResponseLike): Promise<void> {
      for (const handler of handlers) {
        await handler(response);
      }
    },
  };
}

function mockResponse(url: string, body: unknown): ResponseLike {
  return {
    url: () => url,
    json: async () => body,
  };
}

function rejectingResponse(url: string): ResponseLike {
  return {
    url: () => url,
    json: async () => {
      throw new Error("not json");
    },
  };
}

function overview(sources: ExternalXSignalSource[]): GetExternalXSignalsOverviewResponse {
  return {
    generatedAt: NOW,
    sources,
    totals: {
      sources: sources.length,
      activeSources: sources.filter((item) => item.status !== "removed").length,
      evidence: 0,
      patterns: 0,
      refreshRuns: 0,
    },
    patterns: [],
    recentEvidence: [],
    refreshRuns: [],
  };
}

function fakeExternalService(sources: ExternalXSignalSource[]) {
  return {
    getOverview: vi.fn(async () => overview(sources)),
    ingestObservedTimeline: vi.fn(async () => ({
      matched: true,
      sourceId: sources[0]?.id,
      insertedCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
    })),
  };
}

describe("ExternalXSignalsCaptureObserver", () => {
  it("ingests a registered external UserTweets response as an external timeline batch", async () => {
    const service = fakeExternalService([source()]);
    const ctx = createMultiContext();
    ExternalXSignalsCaptureObserver.attach(ctx.context, service);

    await ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid));

    expect(ctx.on).toHaveBeenCalledWith("response", expect.any(Function));
    expect(service.ingestObservedTimeline).toHaveBeenCalledTimes(1);
    expect(service.ingestObservedTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        screenName: "indie_hacker",
        posts: expect.arrayContaining([
          expect.objectContaining({
            platformPostId: expect.any(String),
            text: expect.any(String),
            rawId: expect.any(String),
          }),
        ]),
      }),
    );
  });

  it("ignores unregistered external UserTweets responses fail-closed", async () => {
    const service = fakeExternalService([]);
    const ctx = createMultiContext();
    ExternalXSignalsCaptureObserver.attach(ctx.context, service);

    await ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid));

    expect(service.getOverview).toHaveBeenCalled();
    expect(service.ingestObservedTimeline).not.toHaveBeenCalled();
  });

  it("uses a profile response to gate a later screen-name-only registered source", async () => {
    const service = fakeExternalService([source({ platformUserId: undefined })]);
    const ctx = createMultiContext();
    ExternalXSignalsCaptureObserver.attach(ctx.context, service);

    await ctx.fire(mockResponse(URL_USER_BY_SCREEN_NAME, userByScreenNameValid));
    await ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid));

    expect(service.ingestObservedTimeline).toHaveBeenCalledTimes(1);
    expect(service.ingestObservedTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ screenName: "indie_hacker" }),
    );
  });

  it("queues tweets that arrive before profile identity and flushes after profile", async () => {
    const service = fakeExternalService([source({ platformUserId: undefined })]);
    const ctx = createMultiContext();
    ExternalXSignalsCaptureObserver.attach(ctx.context, service);

    await ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid));
    expect(service.ingestObservedTimeline).not.toHaveBeenCalled();

    await ctx.fire(mockResponse(URL_USER_BY_SCREEN_NAME, userByScreenNameValid));

    expect(service.ingestObservedTimeline).toHaveBeenCalledTimes(1);
    expect(service.ingestObservedTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ screenName: "indie_hacker" }),
    );
  });

  it("tolerates malformed JSON and non-matching responses without throwing", async () => {
    const service = fakeExternalService([source()]);
    const ctx = createMultiContext();
    ExternalXSignalsCaptureObserver.attach(ctx.context, service);

    await expect(ctx.fire(rejectingResponse(URL_USER_TWEETS))).resolves.toBeUndefined();
    await expect(ctx.fire(mockResponse(URL_HOME_TIMELINE, userTweetsValid))).resolves.toBeUndefined();

    expect(service.ingestObservedTimeline).not.toHaveBeenCalled();
  });

  it("skips the own-post capture path for registered external responses", async () => {
    const service = fakeExternalService([source()]);
    const ctx = createMultiContext();
    const db = openEngineDatabase(":memory:");
    const ownRepository = new SqlitePostLibraryRepository(db);
    const liveCapture = new LiveCaptureService(ownRepository);
    const externalObserver = ExternalXSignalsCaptureObserver.attach(ctx.context, service);
    const ownBatch = vi.fn(async (batch) => {
      await liveCapture.ingest(batch);
    });
    GraphQlCaptureObserver.attach(ctx.context, ownBatch, {
      shouldSkip: (observation) => externalObserver.isRegisteredExternalObservation(observation),
    });

    await ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid));

    expect(service.ingestObservedTimeline).toHaveBeenCalledTimes(1);
    expect(ownBatch).not.toHaveBeenCalled();
    expect((await ownRepository.loadStore()).posts).toHaveLength(0);
    db.close();
  });

  it("leaves normal own-post capture intact when the response is not registered external", async () => {
    const service = fakeExternalService([source({ platformUserId: "not-this-user" })]);
    const ctx = createMultiContext();
    const externalObserver = ExternalXSignalsCaptureObserver.attach(ctx.context, service);
    const ownBatch = vi.fn(async () => undefined);
    GraphQlCaptureObserver.attach(ctx.context, ownBatch, {
      shouldSkip: (observation) => externalObserver.isRegisteredExternalObservation(observation),
    });

    await ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid));

    expect(service.ingestObservedTimeline).not.toHaveBeenCalled();
    expect(ownBatch).toHaveBeenCalledTimes(1);
  });
});
