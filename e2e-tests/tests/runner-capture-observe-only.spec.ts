// E2E: runner ⇄ local mock x.com — observe-only feed capture + the policy
// invariants that do NOT depend on the overlay UI rendering.
//
// These exercise the runner's real GraphQlCaptureObserver + the real engine
// capture/transport bindings against a route-mocked x.com. The overlay bundle is
// injected the same way production does, but these assertions ride the transport
// bindings directly (window.__xbuilder_*), so they hold regardless of whether the
// overlay React tree renders.

import { expect, test } from "@playwright/test";

import { startRunner, type RunnerHarness } from "./support/runner-harness";

// One capture summary read off the page-exposed binding.
async function captureSummary(h: RunnerHarness): Promise<{ postsCaptured: number; followers?: number; screenName?: string }> {
  return (await h.callBinding("getCaptureSummary")) as {
    postsCaptured: number;
    followers?: number;
    screenName?: string;
  };
}

// Flow D — observer ingests the canned GraphQL batch → corpus grows.
test("Flow D: the canned UserTweets/UserByScreenName responses the page fetches grow the corpus to >= 5, without double-counting on re-fetch", async () => {
  const h = await startRunner();
  try {
    // The mock page issues its own GET GraphQL requests on load (observe-only,
    // exactly as the logged-in X SPA does); GraphQlCaptureObserver normalizes the
    // already-fetched responses and LiveCaptureService.ingest accumulates them.
    await expect
      .poll(async () => (await captureSummary(h)).postsCaptured, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(5);

    const first = await captureSummary(h);
    // The UserByScreenName response is captured too (profile metrics auto-fed).
    expect(first.followers).toBe(4_200);
    expect(first.screenName).toBe("local_first_dev");

    // Re-fetch the SAME UserTweets operation: posts share their platformPostId, so
    // upsertPosts merges them — the corpus must not double-count.
    await h.page.evaluate(() =>
      fetch("/i/api/graphql/QID-tweets-2/UserTweets?variables=%7B%7D", { method: "GET" }),
    );
    await expect
      .poll(async () => (await captureSummary(h)).postsCaptured, { timeout: 8_000 })
      .toBe(first.postsCaptured);
  } finally {
    await h.stop();
  }
});

// Invariant #1 — capture is observe-only: no crafted GraphQL POST originates from
// the runner.
test("Invariant #1: after capture, the fixture request log contains zero crafted GraphQL write requests (only the page's own GET fetches)", async () => {
  const h = await startRunner();
  try {
    await expect
      .poll(async () => (await captureSummary(h)).postsCaptured, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(5);

    // Every GraphQL request the context issued was a GET (observe-only). A crafted,
    // authenticated GraphQL POST would appear here and fail this invariant.
    expect(h.log.craftedGraphQlWrites()).toEqual([]);
    // And at least one GraphQL response WAS observed (the capture actually ran).
    expect(h.log.graphQlFor("UserTweets").length).toBeGreaterThan(0);
  } finally {
    await h.stop();
  }
});

// Invariant #2 — the overlay/runner never posts, likes, follows, or interacts.
test("Invariant #2: the fixture mutation log contains zero non-GET requests to /i/api/** after capture", async () => {
  const h = await startRunner();
  try {
    await expect
      .poll(async () => (await captureSummary(h)).postsCaptured, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(5);

    // No write/interaction mutation (post/like/follow/repost/DM) was ever issued.
    expect(h.log.internalApiMutations()).toEqual([]);
  } finally {
    await h.stop();
  }
});
