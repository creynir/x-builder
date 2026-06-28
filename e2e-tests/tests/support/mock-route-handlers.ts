// Mock x.com route layer + request log for the runner-driven overlay E2E.
//
// THE BOUNDARY THIS MOCKS: x.com's network. The runner navigates to a hardcoded
// https://x.com (runner-app.ts), so we intercept every request on the persistent
// context and fulfill x.com's document + GraphQL endpoints from the checked-in
// fixtures under e2e-tests/fixtures/. No real x.com, no internet, no credentials.
//
// THE BOUNDARY THIS DOES NOT MOCK: the engine. The engine services run in-process
// in the runner over tmpdir repositories; only the LLM provider round-trip is a
// fake (see runner-harness.ts). The overlay→engine transport rides the Playwright
// exposeFunction CDP pipe, never the network — so it is invisible to this layer.
//
// THE REQUEST LOG is the falsifiability instrument for invariants #1 and #2: every
// inbound request the context issues is recorded with its method, URL, and the
// page's own resource type, so a test can assert that ZERO crafted GraphQL POSTs
// and ZERO /i/api write mutations originated from the runner. The mock page issues
// its own GET GraphQL fetches (observe-only, just like the real X SPA); those are
// recorded too and are distinguishable from any runner-crafted call by method.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BrowserContext, Route, Request } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
// tests/support → ../../fixtures
const fixturesDir = join(here, "..", "..", "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function fixtureBody(name: string, screenName: string | null): string {
  if (screenName === null || screenName.trim().length === 0) {
    return readFixture(name);
  }

  const body = JSON.parse(readFixture(name)) as {
    data?: { user?: { result?: { core?: { screen_name?: string }; legacy?: { screen_name?: string } } } };
  };
  const result = body.data?.user?.result;
  if (result?.core !== undefined) result.core.screen_name = screenName;
  if (result?.legacy !== undefined) result.legacy.screen_name = screenName;
  return JSON.stringify(body);
}

/** One recorded inbound request the context issued while a test ran. */
export interface RecordedRequest {
  method: string;
  url: string;
  /** Playwright resourceType ("document" | "fetch" | "xhr" | ...). */
  resourceType: string;
  /** True when the request targets an X GraphQL endpoint (path contains /graphql). */
  isGraphQl: boolean;
  /** True when the request targets an X internal write API (path under /i/api). */
  isInternalApi: boolean;
}

/** The shared request log + helpers, returned by {@link installMockX}. */
export interface MockXLog {
  /** Every recorded inbound request, in arrival order. */
  readonly requests: ReadonlyArray<RecordedRequest>;
  /** GraphQL requests issued with a write method (POST/PUT/PATCH/DELETE). */
  craftedGraphQlWrites(): RecordedRequest[];
  /** Any non-GET request to an /i/api/** path (a write/interaction mutation). */
  internalApiMutations(): RecordedRequest[];
  /** GraphQL requests whose URL path contains the given operation-name substring. */
  graphQlFor(operationName: string): RecordedRequest[];
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function classify(request: Request): RecordedRequest {
  const url = request.url();
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // A non-absolute URL (should not happen on a context route) — fall back to
    // the raw string for the substring tests below.
  }
  return {
    method: request.method(),
    url,
    resourceType: request.resourceType(),
    isGraphQl: pathname.includes("/graphql"),
    isInternalApi: pathname.includes("/i/api/"),
  };
}

/**
 * Install the mock x.com route layer on a persistent context BEFORE any
 * navigation, and return the live request log. Routes are attached with
 * `context.route("**\/*", ...)` so they cover the document, the canned GraphQL
 * endpoints, and any stray request the page makes; everything else x.com-shaped
 * is fulfilled with an empty 200 so nothing escapes to the internet.
 */
export async function installMockX(context: BrowserContext): Promise<MockXLog> {
  const requests: RecordedRequest[] = [];

  await context.route("**/*", async (route: Route) => {
    const request = route.request();
    const record = classify(request);
    requests.push(record);

    let pathname = record.url;
    try {
      pathname = new URL(record.url).pathname;
    } catch {
      /* keep raw */
    }

    // --- The canned GraphQL endpoints (observe-only data the page fetches) ----
    if (pathname.includes("/graphql")) {
      if (pathname.includes("UserByScreenName")) {
        const screenName = new URL(record.url).searchParams.get("screenName");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: fixtureBody("user-by-screen-name-response.json", screenName),
        });
        return;
      }
      if (pathname.includes("UserTweets")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: readFixture("user-tweets-response.json"),
        });
        return;
      }
      // Any other GraphQL op: an empty, schema-shaped envelope (no posts).
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {} }),
      });
      return;
    }

    // --- Any /i/api write/interaction endpoint -------------------------------
    // The overlay must never fire one of these. We still fulfill (so a violation
    // would "succeed" at the network layer and the test catches it via the log,
    // not via a network error that could be mistaken for the guard working).
    if (pathname.includes("/i/api/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {} }),
      });
      return;
    }

    // --- The x.com document --------------------------------------------------
    // The runner navigates to https://x.com (and the SPA might request a few
    // top-level paths). Serve the mock composer page for any x.com document.
    if (record.resourceType === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: readFixture("mock-x.html"),
      });
      return;
    }

    // --- Everything else (favicons, fonts, sourcemaps, …) --------------------
    // Fulfilled empty so nothing reaches the real network.
    await route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });

  return {
    requests,
    craftedGraphQlWrites: () =>
      requests.filter((r) => r.isGraphQl && WRITE_METHODS.has(r.method)),
    internalApiMutations: () =>
      requests.filter((r) => r.isInternalApi && r.method !== "GET"),
    graphQlFor: (operationName: string) =>
      requests.filter((r) => r.isGraphQl && r.url.includes(operationName)),
  };
}
