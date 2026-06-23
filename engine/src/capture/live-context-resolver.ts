import type { AnalyzePostsRequest, ScoringContext } from "@x-builder/shared";

import type {
  CanonicalOwnPost,
  LiveProfileSnapshot,
  PostLibraryRepository,
} from "../server/post-library-repository.js";
import { RepetitionWindowService } from "./repetition-window-service.js";

// The subset of scoringContext this resolver may auto-derive from the local
// library. Each field is patched only when the request leaves it undefined, so
// caller-supplied values always win.
type LiveScoringContextPatch = {
  followers?: ScoringContext["followers"];
  trailingMedianImpressions?: ScoringContext["trailingMedianImpressions"];
  repeatHistory?: ScoringContext["repeatHistory"];
};

// Cap the trailing-median sample to the 20 most recent originals (by createdAt).
const TRAILING_MEDIAN_SAMPLE_SIZE = 20;

export class LiveContextResolver {
  constructor(
    private readonly repo: PostLibraryRepository,
    private readonly windowService: RepetitionWindowService,
  ) {}

  async mergeAnalysisRequest(request: AnalyzePostsRequest): Promise<AnalyzePostsRequest> {
    // A PostLibraryStorageError thrown here propagates unchanged by design.
    const store = await this.repo.loadStore();

    const patch: LiveScoringContextPatch = {};

    if (request.scoringContext.followers === undefined) {
      const followers = this.deriveFollowers(store.profileSnapshots);

      if (followers !== undefined) {
        patch.followers = followers;
      }
    }

    if (request.scoringContext.trailingMedianImpressions === undefined) {
      const median = this.deriveTrailingMedianImpressions(store.posts);

      if (median !== undefined) {
        patch.trailingMedianImpressions = median;
      }
    }

    if (request.scoringContext.repeatHistory === undefined) {
      const repeatHistory = await this.deriveRepeatHistory();

      if (repeatHistory.length > 0) {
        patch.repeatHistory = repeatHistory;
      }
    }

    return {
      ...request,
      scoringContext: { ...request.scoringContext, ...patch },
    };
  }

  // Most-recent profile snapshot by capturedAt; its followers when present.
  private deriveFollowers(
    snapshots: LiveProfileSnapshot[],
  ): number | undefined {
    let latest: LiveProfileSnapshot | undefined;

    for (const snapshot of snapshots) {
      if (latest === undefined || snapshot.capturedAt > latest.capturedAt) {
        latest = snapshot;
      }
    }

    return latest?.followers;
  }

  // Integer median of the per-post most-recent live impressions across the 20
  // most recent original posts that carry an x_live_capture metricSnapshot.
  private deriveTrailingMedianImpressions(
    posts: CanonicalOwnPost[],
  ): number | undefined {
    type LiveSample = { createdAt: string; impressions: number };
    const samples: LiveSample[] = [];

    for (const post of posts) {
      if (post.kind !== "original") {
        continue;
      }

      // The most-recent live snapshot on this post by capturedAt. The store's
      // metricSnapshots is a true discriminated union on `source`, so narrow on
      // `.source === "x_live_capture"` before reading impressions/capturedAt.
      let latestImpressions: number | undefined;
      let latestCapturedAt: string | undefined;

      for (const snapshot of post.metricSnapshots) {
        if (snapshot.source !== "x_live_capture") {
          continue;
        }

        if (latestCapturedAt === undefined || snapshot.capturedAt > latestCapturedAt) {
          latestCapturedAt = snapshot.capturedAt;
          latestImpressions = snapshot.impressions;
        }
      }

      if (latestCapturedAt === undefined || latestImpressions === undefined) {
        continue;
      }

      samples.push({ createdAt: post.createdAt, impressions: latestImpressions });
    }

    if (samples.length === 0) {
      return undefined;
    }

    // Keep the 20 most recent by post createdAt (descending).
    const recent = samples
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, TRAILING_MEDIAN_SAMPLE_SIZE)
      .map((sample) => sample.impressions);

    const ascending = [...recent].sort((a, b) => a - b);
    // Integer median; an even count takes the floor of the lower-middle index.
    const medianIndex = Math.floor((ascending.length - 1) / 2);

    return ascending[medianIndex];
  }

  private async deriveRepeatHistory(): Promise<
    NonNullable<ScoringContext["repeatHistory"]>
  > {
    const report = await this.windowService.compute(7);

    return this.windowService.asRepeatHistory(report);
  }
}
