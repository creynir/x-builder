/**
 * ExternalXSignalsCaptureObserver — observe-only capture of already-fetched X
 * profile/timeline GraphQL responses for registered external signal sources.
 *
 * Zero-trace: no page navigation, no GraphQL construction, no auth headers, no
 * scrolling, no following, and no synthetic network traffic. The observer only
 * listens to page-issued responses, parses their already-fetched JSON bodies,
 * and hands source-gated timeline batches to ExternalXSignalsService.
 */

import type {
  ExternalXObservedTimelineBatch,
  ExternalXObservedTimelinePost,
  ExternalXObservedTimelineResult,
} from "@x-builder/engine";
import type {
  ExternalXSignalSource,
  GetExternalXSignalsOverviewRequest,
  GetExternalXSignalsOverviewResponse,
  LiveCapturedPost,
} from "@x-builder/shared";

import { XGraphQlNormalizer } from "./x-graphql-normalizer.js";
import type { ContextLike, ResponseLike } from "./graphql-capture-observer.js";

export type ExternalXSignalsObserveService = {
  getOverview(input?: GetExternalXSignalsOverviewRequest): Promise<GetExternalXSignalsOverviewResponse>;
  ingestObservedTimeline(batch: ExternalXObservedTimelineBatch): Promise<ExternalXObservedTimelineResult>;
};

export type ExternalXSignalsObservation = {
  opName: string;
  body: unknown;
  capturedAt: string;
  posts: readonly LiveCapturedPost[];
};

const TWEET_OPERATIONS = ["UserTweets", "UserTweetsAndReplies"] as const;
const PROFILE_OPERATION = "UserByScreenName" as const;
const OPERATION_NAMES = [...TWEET_OPERATIONS, PROFILE_OPERATION];

const normalizeScreenName = (value: string): string =>
  value.trim().replace(/^@+/, "").trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const prop = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const sourceIsActive = (source: ExternalXSignalSource): boolean => source.status !== "removed";

const extractUserResult = (body: unknown): unknown => prop(prop(prop(body, "data"), "user"), "result");

const extractPlatformUserId = (body: unknown): string | undefined => {
  const value = prop(extractUserResult(body), "rest_id");
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const extractScreenName = (body: unknown): string | undefined => {
  const result = extractUserResult(body);
  const core = prop(result, "core");
  const legacy = prop(result, "legacy");
  const value = prop(core, "screen_name") ?? prop(legacy, "screen_name");
  return typeof value === "string" && value.trim().length > 0
    ? normalizeScreenName(value)
    : undefined;
};

const externalPostFromLivePost = (post: LiveCapturedPost): ExternalXObservedTimelinePost => ({
  platformPostId: post.platformPostId,
  text: post.text,
  createdAt: post.createdAt,
  kind: post.kind,
  ...(post.language === undefined ? {} : { language: post.language }),
  ...(post.replyReferences.inReplyToPostId === undefined
    ? {}
    : { inReplyToPostId: post.replyReferences.inReplyToPostId }),
  ...(post.replyReferences.inReplyToUserId === undefined
    ? {}
    : { inReplyToUserId: post.replyReferences.inReplyToUserId }),
  hasUrls: post.entityFlags.hasUrls,
  hasMedia: post.entityFlags.hasMedia,
  hasHashtags: post.entityFlags.hasHashtags,
  hasMentions: post.entityFlags.hasMentions,
  metrics: post.liveMetrics,
  rawId: post.platformPostId,
});

export class ExternalXSignalsCaptureObserver {
  private readonly screenNameByUserId = new Map<string, string>();
  private readonly pendingTweetsByUserId = new Map<
    string,
    Array<{ observedAt: string; posts: readonly LiveCapturedPost[] }>
  >();

  constructor(private readonly service: ExternalXSignalsObserveService) {}

  static attach(
    context: ContextLike,
    service: ExternalXSignalsObserveService,
  ): ExternalXSignalsCaptureObserver {
    return new ExternalXSignalsCaptureObserver(service).attachTo(context);
  }

  attachTo(context: ContextLike): this {
    context.on("response", (response) => this.handle(response));
    return this;
  }

  async isRegisteredExternalObservation(observation: ExternalXSignalsObservation): Promise<boolean> {
    const identity = this.identityFor(observation.body);
    if (identity.platformUserId !== undefined && identity.screenName !== undefined) {
      this.screenNameByUserId.set(identity.platformUserId, identity.screenName);
    }

    const source = await this.matchRegisteredSource(identity);
    return source !== undefined;
  }

  private async handle(response: ResponseLike): Promise<void> {
    try {
      const opName = OPERATION_NAMES.find((name) => response.url().includes(name));
      if (opName === undefined) {
        return;
      }

      const observedAt = new Date().toISOString();
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return;
      }

      if (opName === PROFILE_OPERATION) {
        await this.handleProfile(body);
        return;
      }

      const posts = XGraphQlNormalizer.normalizeUserTweets(body, observedAt);
      if (posts.length === 0) {
        return;
      }

      await this.handleTimeline(body, observedAt, posts);
    } catch {
      return;
    }
  }

  private async handleProfile(body: unknown): Promise<void> {
    const profile = XGraphQlNormalizer.normalizeUserProfile(body, new Date().toISOString());
    if (profile === undefined) {
      return;
    }

    const screenName = normalizeScreenName(profile.screenName);
    this.screenNameByUserId.set(profile.platformUserId, screenName);

    const source = await this.matchRegisteredSource({
      platformUserId: profile.platformUserId,
      screenName,
    });
    if (source === undefined) {
      return;
    }

    const pending = this.pendingTweetsByUserId.get(profile.platformUserId) ?? [];
    this.pendingTweetsByUserId.delete(profile.platformUserId);
    for (const batch of pending) {
      await this.ingest(source.screenName, batch.observedAt, batch.posts);
    }
  }

  private async handleTimeline(
    body: unknown,
    observedAt: string,
    posts: readonly LiveCapturedPost[],
  ): Promise<void> {
    const identity = this.identityFor(body);
    const source = await this.matchRegisteredSource(identity);

    if (source !== undefined) {
      await this.ingest(source.screenName, observedAt, posts);
      return;
    }

    if (identity.platformUserId !== undefined && identity.screenName === undefined) {
      const pending = this.pendingTweetsByUserId.get(identity.platformUserId) ?? [];
      pending.push({ observedAt, posts });
      this.pendingTweetsByUserId.set(identity.platformUserId, pending.slice(-5));
    }
  }

  private identityFor(body: unknown): { platformUserId?: string; screenName?: string } {
    const platformUserId = extractPlatformUserId(body);
    const directScreenName = extractScreenName(body);
    const cachedScreenName = platformUserId === undefined ? undefined : this.screenNameByUserId.get(platformUserId);
    const screenName = directScreenName ?? cachedScreenName;

    return {
      ...(platformUserId === undefined ? {} : { platformUserId }),
      ...(screenName === undefined ? {} : { screenName }),
    };
  }

  private async matchRegisteredSource(identity: {
    platformUserId?: string;
    screenName?: string;
  }): Promise<ExternalXSignalSource | undefined> {
    if (identity.platformUserId === undefined && identity.screenName === undefined) {
      return undefined;
    }

    const overview = await this.service.getOverview({
      includeRemoved: false,
      sourceLimit: 100,
      patternLimit: 1,
      recentEvidenceLimit: 1,
      refreshRunLimit: 1,
    });

    return overview.sources.find((source) => {
      if (!sourceIsActive(source)) {
        return false;
      }
      if (identity.screenName !== undefined && source.screenName === identity.screenName) {
        return true;
      }
      return identity.platformUserId !== undefined && source.platformUserId === identity.platformUserId;
    });
  }

  private async ingest(
    screenName: string,
    observedAt: string,
    posts: readonly LiveCapturedPost[],
  ): Promise<void> {
    await this.service.ingestObservedTimeline({
      screenName,
      observedAt,
      posts: posts.map(externalPostFromLivePost),
    });
  }
}
