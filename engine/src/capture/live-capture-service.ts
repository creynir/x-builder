import {
  liveCapturedPostSchema,
  liveCapturedProfileSchema,
  type CaptureIngestRequest,
  type CaptureIngestResponse,
  type LiveCapturedPost,
} from "@x-builder/shared";
import { z } from "zod";

import {
  type CanonicalOwnPostInput,
  type LiveMetricSnapshot,
  type PostLibraryRepository,
} from "../server/post-library-repository.js";

// Validate the request envelope (post-count ceiling, optional profile) without
// rejecting the whole batch when a single post is malformed. Individual posts are
// run through liveCapturedPostSchema.safeParse below so they can be tolerated and
// skipped one at a time.
const captureIngestEnvelopeSchema = z.object({
  posts: z.array(z.unknown()).max(200).default([]),
  profile: liveCapturedProfileSchema.optional(),
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
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async ingest(request: CaptureIngestRequest): Promise<CaptureIngestResponse> {
    const parsed = captureIngestEnvelopeSchema.parse(request);
    const captureSessionId = crypto.randomUUID();
    const inputs: CanonicalOwnPostInput[] = [];
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

    const writeResult = await this.repo.upsertPosts(inputs);

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
}
