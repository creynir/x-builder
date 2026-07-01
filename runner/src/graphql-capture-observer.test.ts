/**
 * Failing tests for GraphQlCaptureObserver.
 *
 * The module under test (`./graphql-capture-observer`) does not exist yet, so
 * the import below resolves to nothing until the implementation lands. That is
 * the intended Red state: these tests fail on a missing module, not on a logic
 * error in the test itself.
 *
 * Subject:
 *   class GraphQlCaptureObserver {
 *     static attach(context: ContextLike, onBatch): GraphQlCaptureObserver
 *     state: "ok" | "paused" | "layout_changed"   // initial: "paused"
 *     lastCaptureAt?: string
 *   }
 *
 * Structural seams Green must expose (a real Playwright BrowserContext / Response
 * is structurally assignable to these):
 *   type ResponseLike = { url(): string; json(): Promise<unknown> };
 *   type ContextLike  = {
 *     on(event: "response", handler: (response: ResponseLike) => unknown): void;
 *   };
 *   static attach(
 *     context: ContextLike,
 *     onBatch: (batch: CaptureIngestRequest) => Promise<void> | void,
 *   ): GraphQlCaptureObserver;
 *
 * Non-empty vs empty tweets are driven through the REAL XGraphQlNormalizer:
 *   - the valid UserTweets fixture yields >= 1 post (drives "ok");
 *   - an empty object `{}` parses successfully but yields zero posts (drives
 *     "layout_changed" for UserTweets / UserTweetsAndReplies);
 *   - the valid UserByScreenName fixture yields a profile;
 *   - an empty object yields an undefined profile.
 * This exercises the true normalize path rather than a mock.
 */

import { describe, expect, it, vi } from "vitest";
import type { CaptureIngestRequest } from "@x-builder/shared";

import { GraphQlCaptureObserver } from "./graphql-capture-observer";

import userTweetsValid from "./__fixtures__/graphql/user-tweets-valid.json";
import userByScreenNameValid from "./__fixtures__/graphql/user-by-screen-name-valid.json";

// ---------------------------------------------------------------------------
// Structural test doubles
// ---------------------------------------------------------------------------

type ResponseLike = { url(): string; json(): Promise<unknown> };

type ResponseHandler = (response: ResponseLike) => unknown;

/**
 * A mock context that captures the single response handler registered via
 * `on("response", ...)` so a test can fire mock responses through it. The
 * handler is async; `fire` awaits its returned value so post-conditions
 * (state transitions, onBatch calls) are observable after the await settles.
 */
function createMockContext() {
  let handler: ResponseHandler | undefined;
  const on = vi.fn((event: string, fn: ResponseHandler) => {
    if (event === "response") {
      handler = fn;
    }
  });

  return {
    context: { on },
    on,
    async fire(response: ResponseLike): Promise<void> {
      if (!handler) {
        throw new Error("No response handler was registered on the context.");
      }
      await handler(response);
    },
    get registered(): boolean {
      return handler !== undefined;
    },
  };
}

/** Builds a mock response whose `json()` resolves to `body`. */
function mockResponse(url: string, body: unknown): ResponseLike {
  return {
    url: () => url,
    json: async () => body,
  };
}

/** Builds a mock response whose `json()` rejects. */
function rejectingResponse(url: string, error: unknown): ResponseLike {
  return {
    url: () => url,
    json: async () => {
      throw error;
    },
  };
}

// Representative X GraphQL endpoint URLs. Query ids are opaque/rotating; the
// observer matches on the operation-name substring only.
const URL_USER_TWEETS = "https://x.com/i/api/graphql/abc123/UserTweets?variables=%7B%7D";
const URL_USER_TWEETS_AND_REPLIES =
  "https://x.com/i/api/graphql/def456/UserTweetsAndReplies?variables=%7B%7D";
const URL_USER_BY_SCREEN_NAME =
  "https://x.com/i/api/graphql/ghi789/UserByScreenName?variables=%7B%7D";
const URL_HOME_TIMELINE = "https://x.com/i/api/graphql/zzz000/HomeTimeline?variables=%7B%7D";

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// ---------------------------------------------------------------------------
// attach — registration
// ---------------------------------------------------------------------------

describe("GraphQlCaptureObserver.attach — registration & initial state", () => {
  it("registers a response listener and returns an observer in the paused state", () => {
    const onBatch = vi.fn(async () => {});
    const ctx = createMockContext();

    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    expect(observer).toBeInstanceOf(GraphQlCaptureObserver);
    expect(ctx.on).toHaveBeenCalledWith("response", expect.any(Function));
    expect(ctx.registered).toBe(true);
    expect(observer.state).toBe("paused");
    expect(observer.lastCaptureAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// attach — matching UserTweets response (happy path)
// ---------------------------------------------------------------------------

describe("GraphQlCaptureObserver — matching UserTweets response", () => {
  it("normalizes the body, calls onBatch with posts, and transitions to ok", async () => {
    const onBatch = vi.fn(async (_batch: CaptureIngestRequest) => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    await ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid));

    expect(onBatch).toHaveBeenCalledTimes(1);
    const batch = onBatch.mock.calls[0]![0];
    expect(Array.isArray(batch.posts)).toBe(true);
    expect(batch.posts.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(batch.observedThreadPosts)).toBe(true);
    expect(batch.observedThreadPosts?.length).toBe(batch.posts.length);
    expect(batch.observedThreadPosts?.[0]).toMatchObject({
      source: "x_graphql_observed",
      statusId: "1700000000000000001",
    });

    expect(observer.state).toBe("ok");
    expect(observer.lastCaptureAt).toBeDefined();
    expect(observer.lastCaptureAt).toMatch(ISO_DATETIME);
    // A valid, round-trippable ISO instant.
    expect(Number.isNaN(Date.parse(observer.lastCaptureAt!))).toBe(false);
  });

  it("also matches the UserTweetsAndReplies operation name", async () => {
    const onBatch = vi.fn(async (_batch: CaptureIngestRequest) => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    await ctx.fire(mockResponse(URL_USER_TWEETS_AND_REPLIES, userTweetsValid));

    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch.mock.calls[0]![0].posts.length).toBeGreaterThanOrEqual(1);
    expect(observer.state).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// attach — non-matching URL
// ---------------------------------------------------------------------------

describe("GraphQlCaptureObserver — non-matching URL", () => {
  it("ignores a HomeTimeline response: no onBatch, state stays paused", async () => {
    const onBatch = vi.fn(async () => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    await ctx.fire(mockResponse(URL_HOME_TIMELINE, userTweetsValid));

    expect(onBatch).not.toHaveBeenCalled();
    expect(observer.state).toBe("paused");
    expect(observer.lastCaptureAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// attach — layout_changed (matches but parses to zero tweets)
// ---------------------------------------------------------------------------

describe("GraphQlCaptureObserver — empty parse (layout_changed)", () => {
  it("sets state to layout_changed and skips onBatch when UserTweets yields zero posts", async () => {
    const onBatch = vi.fn(async () => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    // `{}` is valid JSON that the real normalizer walks to an empty post list.
    await ctx.fire(mockResponse(URL_USER_TWEETS, {}));

    expect(observer.state).toBe("layout_changed");
    // posts empty AND no profile -> nothing to ingest -> onBatch skipped.
    expect(onBatch).not.toHaveBeenCalled();
    expect(observer.lastCaptureAt).toBeUndefined();
  });

  it("treats an empty UserTweetsAndReplies parse as layout_changed too", async () => {
    const onBatch = vi.fn(async () => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    await ctx.fire(mockResponse(URL_USER_TWEETS_AND_REPLIES, {}));

    expect(observer.state).toBe("layout_changed");
    expect(onBatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// attach — response.json() throws
// ---------------------------------------------------------------------------

describe("GraphQlCaptureObserver — response.json() throws", () => {
  it("catches the error, does not call onBatch, and leaves state unchanged", async () => {
    const onBatch = vi.fn(async () => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    await expect(
      ctx.fire(rejectingResponse(URL_USER_TWEETS, new Error("body not JSON"))),
    ).resolves.toBeUndefined();

    expect(onBatch).not.toHaveBeenCalled();
    // json() failure is NOT a layout change; state remains the initial paused.
    expect(observer.state).toBe("paused");
    expect(observer.lastCaptureAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// attach — onBatch throws (never propagates to the page)
// ---------------------------------------------------------------------------

describe("GraphQlCaptureObserver — onBatch throws", () => {
  it("swallows the ingestion error so it never propagates to the response listener", async () => {
    const onBatch = vi.fn(async () => {
      throw new Error("ingest failed");
    });
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    // Firing the handler must resolve, not reject: the page is never blocked.
    await expect(
      ctx.fire(mockResponse(URL_USER_TWEETS, userTweetsValid)),
    ).resolves.toBeUndefined();

    expect(onBatch).toHaveBeenCalledTimes(1);
    // Per AC#4 the state reflects the normalize result computed before the
    // batch call; the tweets parsed, so the observer reports ok.
    expect(observer.state).toBe("ok");
    expect(observer.lastCaptureAt).toBeDefined();
    expect(observer.lastCaptureAt).toMatch(ISO_DATETIME);
  });
});

// ---------------------------------------------------------------------------
// attach — UserByScreenName (profile-only batch)
// ---------------------------------------------------------------------------

describe("GraphQlCaptureObserver — UserByScreenName profile", () => {
  it("ingests a profile-only batch and does NOT transition to ok", async () => {
    const onBatch = vi.fn(async (_batch: CaptureIngestRequest) => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    await ctx.fire(mockResponse(URL_USER_BY_SCREEN_NAME, userByScreenNameValid));

    expect(onBatch).toHaveBeenCalledTimes(1);
    const batch = onBatch.mock.calls[0]![0];
    expect(batch.posts).toEqual([]);
    expect(batch.profile).toBeDefined();
    expect(batch.profile?.screenName).toBe("indie_hacker");

    // Only UserTweets / UserTweetsAndReplies drive the tweets-ok signal.
    expect(observer.state).toBe("paused");
    expect(observer.lastCaptureAt).toBeUndefined();
  });

  it("does not call onBatch and leaves state unchanged when the profile is unrecoverable", async () => {
    const onBatch = vi.fn(async () => {});
    const ctx = createMockContext();
    const observer = GraphQlCaptureObserver.attach(ctx.context, onBatch);

    // `{}` normalizes to an undefined profile and zero posts: nothing to ingest.
    await ctx.fire(mockResponse(URL_USER_BY_SCREEN_NAME, {}));

    expect(onBatch).not.toHaveBeenCalled();
    expect(observer.state).toBe("paused");
    expect(observer.lastCaptureAt).toBeUndefined();
  });
});
