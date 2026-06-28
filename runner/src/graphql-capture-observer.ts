/**
 * GraphQlCaptureObserver (XOB-017) — observe-only capture of X (Twitter) GraphQL
 * responses that the page itself fetches.
 *
 * Zero-trace: this observer never crafts GraphQL requests, never constructs auth
 * headers (bearer / ct0 / x-client-transaction-id), never auto-paginates or
 * auto-scrolls, never scrapes the DOM or evaluates page script, and never talks
 * to real x.com. It only listens to `context.on("response")`, filters by the
 * operation-name substring in the response URL, reads the already-fetched body
 * via `response.json()`, and hands it to the pure `XGraphQlNormalizer`.
 *
 * Never-block: the response handler runs off the page's critical path and is
 * wrapped so it NEVER throws to Playwright's listener chain. A failed
 * `response.json()` (non-JSON / aborted / oversized body) and a failed `onBatch`
 * (ingestion error) are both tolerated and logged at `debug` level only — no
 * `console.error` on the tolerate paths.
 *
 * The single `unknown` body boundary is narrowed by `XGraphQlNormalizer`; there
 * are no `any` escapes past that boundary here.
 */

import type { CaptureIngestRequest } from "@x-builder/shared";

import { XGraphQlNormalizer } from "./x-graphql-normalizer.js";

/** A real Playwright `Response` is structurally assignable to this. */
export type ResponseLike = { url(): string; json(): Promise<unknown> };

/** A real Playwright `BrowserContext` is structurally assignable to this. */
export type ContextLike = {
  on(event: "response", handler: (response: ResponseLike) => unknown): void;
};

/** Callback the observer hands each normalized batch to. */
export type OnBatch = (batch: CaptureIngestRequest) => Promise<void> | void;

export type GraphQlCaptureObservation = {
  opName: string;
  body: unknown;
  capturedAt: string;
  posts: CaptureIngestRequest["posts"];
  profile?: CaptureIngestRequest["profile"];
};

export type GraphQlCaptureObserverOptions = {
  shouldSkip?: (observation: GraphQlCaptureObservation) => Promise<boolean> | boolean;
};

/**
 * Operation names whose responses carry capturable data. Matched as a
 * case-sensitive substring of the response URL — query ids rotate and are
 * intentionally NOT matched.
 */
const TWEET_OPERATIONS = ["UserTweets", "UserTweetsAndReplies"] as const;
const PROFILE_OPERATION = "UserByScreenName" as const;
const OPERATION_NAMES = [...TWEET_OPERATIONS, PROFILE_OPERATION];

export class GraphQlCaptureObserver {
  state: "ok" | "paused" | "layout_changed" = "paused";
  lastCaptureAt?: string;

  /**
   * Registers a response listener on `context` and returns the observer so the
   * caller (RunnerApp) can pass it to `getOverlayReadiness`. The handler is
   * async and never throws to the page.
   */
  static attach(
    context: ContextLike,
    onBatch: OnBatch,
    options: GraphQlCaptureObserverOptions = {},
  ): GraphQlCaptureObserver {
    return new GraphQlCaptureObserver().attachTo(context, onBatch, options);
  }

  /**
   * Registers this observer's response listener on `context`. Lets the caller
   * (RunnerApp) construct the observer first — so the readiness composer can
   * hold its live `state`/`lastCaptureAt` reference — then attach it once the
   * context exists. Returns `this` for fluent use by {@link attach}.
   */
  attachTo(
    context: ContextLike,
    onBatch: OnBatch,
    options: GraphQlCaptureObserverOptions = {},
  ): this {
    context.on("response", (response) => this.handle(response, onBatch, options));
    return this;
  }

  private async handle(
    response: ResponseLike,
    onBatch: OnBatch,
    options: GraphQlCaptureObserverOptions,
  ): Promise<void> {
    try {
      const opName = OPERATION_NAMES.find((name) => response.url().includes(name));
      if (opName === undefined) {
        // Not a GraphQL response we capture (images / JS / CSS / other ops).
        return;
      }

      // Stamp the capture instant before awaiting the body read.
      const capturedAt = new Date().toISOString();

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        // Non-JSON / aborted / oversized body: not a layout change. State is
        // left unchanged and nothing is ingested.
        console.debug("[GraphQlCaptureObserver] response.json() failed; skipping");
        return;
      }

      const posts = XGraphQlNormalizer.normalizeUserTweets(body, capturedAt);
      const profile =
        opName === PROFILE_OPERATION
          ? XGraphQlNormalizer.normalizeUserProfile(body, capturedAt)
          : undefined;

      if (
        await options.shouldSkip?.({
          opName,
          body,
          capturedAt,
          posts,
          ...(profile ? { profile } : {}),
        })
      ) {
        return;
      }

      // State machine — computed BEFORE onBatch (AC#4): a downstream ingestion
      // failure must not retroactively change the health derived from parsing.
      if (posts.length > 0) {
        this.state = "ok";
        this.lastCaptureAt = capturedAt;
      } else if (opName !== PROFILE_OPERATION) {
        // A tweets op parsed successfully but yielded zero usable posts: X's
        // GraphQL shape likely drifted. UserByScreenName never drives this.
        this.state = "layout_changed";
      }

      const batch: CaptureIngestRequest = {
        posts,
        ...(profile ? { profile } : {}),
      };

      if (posts.length === 0 && !profile) {
        // Nothing to ingest.
        return;
      }

      try {
        await onBatch(batch);
      } catch {
        // Ingestion failure never propagates to the page.
        console.debug("[GraphQlCaptureObserver] onBatch failed; ingestion skipped");
      }
    } catch {
      // Catch-all: the handler must NEVER throw to Playwright's listener chain.
      console.debug("[GraphQlCaptureObserver] response handler error; ignored");
    }
  }
}
