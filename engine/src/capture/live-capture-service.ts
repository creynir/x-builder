import {
  captureSummarySchema,
  liveCapturedPostSchema,
  liveCapturedProfileSchema,
  replyThreadPostSchema,
  type CaptureIngestRequest,
  type CaptureIngestResponse,
  type CaptureSummary,
  type LiveCapturedPost,
} from "@x-builder/shared";
import { z } from "zod";

import {
  type CanonicalOwnPostInput,
  type LiveMetricSnapshot,
  type PostLibraryRepository,
} from "../server/post-library-repository.js";
import type { ObservedThreadRepository } from "../reply-thread-context-repository.js";

// Validate the request envelope (post-count ceiling, optional profile) without
// rejecting the whole batch when a single post is malformed. Individual posts are
// run through liveCapturedPostSchema.safeParse below so they can be tolerated and
// skipped one at a time.
const captureIngestEnvelopeSchema = z.object({
  posts: z.array(z.unknown()).max(200).default([]),
  profile: liveCapturedProfileSchema.optional(),
  observedThreadPosts: z.array(z.unknown()).max(400).default([]),
});

const buildLiveMetricSnapshot = (post: LiveCapturedPost): LiveMetricSnapshot => {
  const { impressions, likes, reposts, replies, quotes, bookmarks } = post.liveMetrics;

  // Omit absent metric fields so the stored snapshot mirrors what was captured.
  return {
    source: "x_live_capture",
    capturedAt: post.capturedAt,
    ...(impressions !== undefined ? { impressions } : {}),
    ...(likes !== undefined ? { likes } : {}),
    ...(reposts !== undefined ? { reposts } : {}),
    ...(replies !== undefined ? { replies } : {}),
    ...(quotes !== undefined ? { quotes } : {}),
    ...(bookmarks !== undefined ? { bookmarks } : {}),
  };
};

export class LiveCaptureService {
  constructor(
    private readonly repo: PostLibraryRepository,
    private readonly observedThreadRepository?: ObservedThreadRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async ingest(request: CaptureIngestRequest): Promise<CaptureIngestResponse> {
    const parsed = captureIngestEnvelopeSchema.parse(request);
    const captureSessionId = crypto.randomUUID();
    const inputs: CanonicalOwnPostInput[] = [];
    const observedThreadPosts: CaptureIngestRequest["observedThreadPosts"] = [];
    const seenPlatformPostIds = new Set<string>();
    let inBatchDuplicateCount = 0;

    for (const rawPost of parsed.posts) {
      const result = liveCapturedPostSchema.safeParse(rawPost);

      if (!result.success) {
        // Tolerate-and-skip: a malformed item is logged and dropped, the batch continues.
        console.warn(
          "[live-capture] skipping malformed captured post",
          result.error.flatten(),
        );
        continue;
      }

      const post = result.data;
      // In-batch duplicates resolve to the first occurrence (the live merge logic in
      // the repository is last-write-wins for cross-call updates; an intra-batch repeat
      // must not let a later item clobber the earlier one). Drop the repeat and count it.
      if (seenPlatformPostIds.has(post.platformPostId)) {
        inBatchDuplicateCount += 1;
        continue;
      }
      seenPlatformPostIds.add(post.platformPostId);

      const observedResult = replyThreadPostSchema.safeParse({
        source: "x_live_capture",
        statusId: post.platformPostId,
        text: post.text,
        createdAt: post.createdAt,
        ...(post.replyReferences.inReplyToPostId === undefined
          ? {}
          : { inReplyToStatusId: post.replyReferences.inReplyToPostId }),
        ...(post.replyReferences.inReplyToUserId === undefined
          ? {}
          : { inReplyToUserId: post.replyReferences.inReplyToUserId }),
        weakMetrics: post.liveMetrics,
        observedAt: post.capturedAt,
      });

      if (observedResult.success) {
        observedThreadPosts.push(observedResult.data);
      } else {
        console.warn(
          "[live-capture] skipping malformed own observed thread projection",
          observedResult.error.flatten(),
        );
      }

      inputs.push({
        id: crypto.randomUUID(),
        platform: "x",
        platformPostId: post.platformPostId,
        text: post.text,
        createdAt: post.createdAt,
        kind: post.kind,
        language: post.language,
        replyReferences: post.replyReferences,
        entityFlags: post.entityFlags,
        weakMetrics: {},
        metricSnapshots: [buildLiveMetricSnapshot(post)],
        sourceRefs: [
          {
            source: "x_live_capture",
            captureSessionId,
            rawId: post.platformPostId,
          },
        ],
      });
    }

    for (const rawPost of parsed.observedThreadPosts) {
      const result = replyThreadPostSchema.safeParse(rawPost);

      if (!result.success) {
        console.warn(
          "[live-capture] skipping malformed observed thread post",
          result.error.flatten(),
        );
        continue;
      }

      observedThreadPosts.push(result.data);
    }

    const writeResult = await this.repo.upsertPosts(inputs);

    if (this.observedThreadRepository !== undefined && observedThreadPosts.length > 0) {
      await this.observedThreadRepository.upsertThreadPosts(observedThreadPosts);
    }

    if (parsed.profile !== undefined) {
      await this.repo.pushProfileSnapshot(parsed.profile);
    }

    const corpusSize = (await this.repo.loadStore()).posts.length;

    return {
      ...writeResult,
      duplicateCount: writeResult.duplicateCount + inBatchDuplicateCount,
      profileApplied: parsed.profile !== undefined,
      corpusSize,
    };
  }

  async summary(): Promise<CaptureSummary> {
    const store = await this.repo.loadStore();

    // lastCaptureAt: the max capturedAt across every x_live_capture snapshot in
    // the corpus. Narrowing the discriminated union on `.source` keeps the read
    // statically the live arm, so capturedAt is always defined. Archive-only
    // corpora yield no live snapshots and the field stays absent.
    let lastCaptureAt: string | undefined;
    for (const post of store.posts) {
      for (const snapshot of post.metricSnapshots) {
        if (snapshot.source === "x_live_capture") {
          if (lastCaptureAt === undefined || snapshot.capturedAt > lastCaptureAt) {
            lastCaptureAt = snapshot.capturedAt;
          }
        }
      }
    }

    // Most-recent profile snapshot by capturedAt; ties resolve to the first in
    // array order (a strictly-greater comparison never replaces an equal one).
    let latestProfile = store.profileSnapshots[0];
    for (const profile of store.profileSnapshots) {
      if (latestProfile === undefined || profile.capturedAt > latestProfile.capturedAt) {
        latestProfile = profile;
      }
    }

    // Build the result adding ONLY the keys that are actually available, so an
    // absent optional is genuinely missing (not a null/undefined-valued key).
    const result: CaptureSummary = {
      postsCaptured: store.posts.length,
      ...(lastCaptureAt !== undefined ? { lastCaptureAt } : {}),
      ...(latestProfile !== undefined
        ? {
            ...(latestProfile.followers !== undefined
              ? { followers: latestProfile.followers }
              : {}),
            screenName: latestProfile.screenName,
            profileCapturedAt: latestProfile.capturedAt,
          }
        : {}),
    };

    return captureSummarySchema.parse(result);
  }
}
