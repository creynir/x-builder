import { randomUUID } from "node:crypto";

import {
  feedbackOutcomeSchema,
  getFeedbackLoopSummaryRequestSchema,
  getFeedbackLoopSummaryResponseSchema,
  linkFeedbackPredictionRequestSchema,
  linkFeedbackPredictionResponseSchema,
  recordFeedbackPredictionRequestSchema,
  recordFeedbackPredictionResponseSchema,
  type FeedbackActualMetrics,
  type FeedbackFormatLearning,
  type FeedbackOutcome,
  type FeedbackPredictionDelta,
  type FeedbackPredictionLink,
  type FeedbackPredictionRecord,
  type GetFeedbackLoopSummaryRequest,
  type GetFeedbackLoopSummaryResponse,
  type LinkFeedbackPredictionRequest,
  type LinkFeedbackPredictionResponse,
  type RecordFeedbackPredictionRequest,
  type RecordFeedbackPredictionResponse,
} from "@x-builder/shared";

import type { CanonicalOwnPost, MetricSnapshot, PostLibraryRepository } from "../server/post-library-repository.js";
import type { FeedbackLoopRepository } from "./feedback-loop-repository.js";
import { normalizeFeedbackContentHash } from "./normalize-feedback-content-hash.js";

export interface FeedbackLoopServiceOptions {
  feedbackRepository: FeedbackLoopRepository;
  postLibraryRepository: PostLibraryRepository;
  now?: () => Date;
  idGenerator?: () => string;
}

const dayMs = 24 * 60 * 60 * 1_000;

const median = (values: number[]): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  const left = sorted[mid - 1];
  const right = sorted[mid];

  return left === undefined || right === undefined ? undefined : (left + right) / 2;
};

const round = (value: number): number => Math.round(value * 100) / 100;

const bucketFor = (
  record: FeedbackPredictionRecord,
  actualImpressions: number | undefined,
): FeedbackPredictionDelta["bucket"] => {
  if (actualImpressions === undefined) {
    return "unknown";
  }

  if (actualImpressions < record.prediction.stallRange.low) {
    return "below_stall";
  }

  if (actualImpressions <= record.prediction.stallRange.high) {
    return "within_stall";
  }

  if (actualImpressions < record.prediction.escapeRange.low) {
    return "between_ranges";
  }

  if (actualImpressions <= record.prediction.escapeRange.high) {
    return "within_escape";
  }

  return "above_escape";
};

const deltaFor = (
  record: FeedbackPredictionRecord,
  actualImpressions: number | undefined,
): FeedbackPredictionDelta => {
  const base = {
    predictedMidImpressions: record.prediction.predictedMidImpressions,
    bucket: bucketFor(record, actualImpressions),
  };

  if (actualImpressions === undefined) {
    return base;
  }

  const predicted = record.prediction.predictedMidImpressions;

  return {
    ...base,
    actualImpressions,
    absoluteDelta: actualImpressions - predicted,
    ratio: predicted === 0 ? undefined : round(actualImpressions / predicted),
  };
};

const snapshotObservedAt = (snapshot: MetricSnapshot): string =>
  snapshot.source === "x_live_capture" ? snapshot.capturedAt : snapshot.observedAt;

const latestByObservedAt = <T extends MetricSnapshot>(items: T[]): T | undefined =>
  [...items].sort((a, b) => snapshotObservedAt(b).localeCompare(snapshotObservedAt(a)))[0];

const actualMetricsForPost = (post: CanonicalOwnPost | undefined): FeedbackActualMetrics | undefined => {
  if (!post) {
    return undefined;
  }

  const liveWithImpressions = latestByObservedAt(
    post.metricSnapshots.filter(
      (snapshot): snapshot is Extract<MetricSnapshot, { source: "x_live_capture" }> =>
        snapshot.source === "x_live_capture" && snapshot.impressions !== undefined,
    ),
  );

  if (liveWithImpressions) {
    return {
      platformPostId: post.platformPostId,
      postCreatedAt: post.createdAt,
      observedAt: liveWithImpressions.capturedAt,
      source: "x_live_capture",
      impressions: liveWithImpressions.impressions,
      likes: liveWithImpressions.likes,
      reposts: liveWithImpressions.reposts,
      replies: liveWithImpressions.replies,
      quotes: liveWithImpressions.quotes,
      bookmarks: liveWithImpressions.bookmarks,
    };
  }

  const livePartial = latestByObservedAt(
    post.metricSnapshots.filter(
      (snapshot): snapshot is Extract<MetricSnapshot, { source: "x_live_capture" }> =>
        snapshot.source === "x_live_capture",
    ),
  );

  if (livePartial) {
    return {
      platformPostId: post.platformPostId,
      postCreatedAt: post.createdAt,
      observedAt: livePartial.capturedAt,
      source: "x_live_capture",
      likes: livePartial.likes,
      reposts: livePartial.reposts,
      replies: livePartial.replies,
      quotes: livePartial.quotes,
      bookmarks: livePartial.bookmarks,
    };
  }

  const archive = latestByObservedAt(
    post.metricSnapshots.filter(
      (snapshot): snapshot is Extract<MetricSnapshot, { source: "archive_tweets_js" }> =>
        snapshot.source === "archive_tweets_js",
    ),
  );

  if (archive) {
    return {
      platformPostId: post.platformPostId,
      postCreatedAt: post.createdAt,
      observedAt: archive.observedAt,
      source: "archive_tweets_js",
      favoriteCount: archive.favoriteCount,
      retweetCount: archive.retweetCount,
    };
  }

  return {
    platformPostId: post.platformPostId,
    postCreatedAt: post.createdAt,
    source: "archive_tweets_js",
  };
};

const linkByPredictionId = (links: FeedbackPredictionLink[]): Map<string, FeedbackPredictionLink> =>
  new Map(links.map((link) => [link.predictionId, link]));

const postsByPlatformPostId = (posts: CanonicalOwnPost[]): Map<string, CanonicalOwnPost> =>
  new Map(posts.map((post) => [post.platformPostId, post]));

const postsByFeedbackHash = (posts: CanonicalOwnPost[]): Map<string, CanonicalOwnPost[]> => {
  const map = new Map<string, CanonicalOwnPost[]>();

  for (const post of posts) {
    const hash = normalizeFeedbackContentHash(post.text);
    const existing = map.get(hash) ?? [];
    existing.push(post);
    map.set(hash, existing);
  }

  return map;
};

const formatLearningFor = (
  format: FeedbackPredictionRecord["detectedFormat"],
  outcomes: FeedbackOutcome[],
): FeedbackFormatLearning => {
  const actualOutcomes = outcomes.filter((outcome) => outcome.delta?.actualImpressions !== undefined);
  const predicted = actualOutcomes.map((outcome) => outcome.prediction.prediction.predictedMidImpressions);
  const actual = actualOutcomes
    .map((outcome) => outcome.delta?.actualImpressions)
    .filter((value): value is number => value !== undefined);
  const ratios = actualOutcomes
    .map((outcome) => outcome.delta?.ratio)
    .filter((value): value is number => value !== undefined);
  const medianRatio = median(ratios);
  const escapeHits = actualOutcomes.filter((outcome) => {
    const actualImpressions = outcome.delta?.actualImpressions;
    return (
      actualImpressions !== undefined &&
      actualImpressions >= outcome.prediction.prediction.escapeRange.low
    );
  }).length;

  const direction =
    medianRatio === undefined
      ? "insufficient_data"
      : medianRatio > 1.15
        ? "up"
        : medianRatio < 0.85
          ? "down"
          : "stable";

  const adjustment =
    direction === "up"
      ? "This format is beating the current prediction baseline for this account."
      : direction === "down"
        ? "This format is under the current prediction baseline for this account."
        : direction === "stable"
          ? "This format is tracking close to the current prediction baseline."
          : "More linked outcomes are needed before adjusting this format.";

  return {
    format,
    predictionCount: outcomes.length,
    linkedCount: outcomes.filter((outcome) => outcome.link !== undefined).length,
    actualCount: actual.length,
    ...(median(predicted) === undefined
      ? {}
      : { medianPredictedImpressions: Math.round(median(predicted) ?? 0) }),
    ...(median(actual) === undefined ? {} : { medianActualImpressions: Math.round(median(actual) ?? 0) }),
    ...(medianRatio === undefined ? {} : { medianRatio: round(medianRatio) }),
    ...(actualOutcomes.length === 0 ? {} : { escapeRate: round(escapeHits / actualOutcomes.length) }),
    direction,
    adjustment,
  };
};

export class FeedbackLoopService {
  private readonly feedbackRepository: FeedbackLoopRepository;
  private readonly postLibraryRepository: PostLibraryRepository;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(options: FeedbackLoopServiceOptions) {
    this.feedbackRepository = options.feedbackRepository;
    this.postLibraryRepository = options.postLibraryRepository;
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => `feedback_${randomUUID()}`);
  }

  async recordPrediction(
    request: RecordFeedbackPredictionRequest,
  ): Promise<RecordFeedbackPredictionResponse> {
    const parsed = recordFeedbackPredictionRequestSchema.parse(request);
    const now = this.now().toISOString();
    const record: FeedbackPredictionRecord = {
      id: this.idGenerator(),
      clientEventId: parsed.clientEventId,
      action: parsed.action,
      platform: parsed.platform,
      text: parsed.text,
      contentHash: normalizeFeedbackContentHash(parsed.text),
      detectedFormat: parsed.snapshot.detectedFormat,
      sourceFormat: parsed.snapshot.sourceFormat,
      scoreValue: parsed.snapshot.scoreValue,
      prediction: parsed.snapshot.prediction,
      scoringContext: parsed.snapshot.scoringContext,
      analyzerVersion: parsed.snapshot.analyzerVersion,
      analyzedAt: parsed.snapshot.analyzedAt,
      createdAt: now,
    };

    const saved = await this.feedbackRepository.recordPrediction(record);
    let link: FeedbackPredictionLink | undefined;

    if (parsed.platformPostId !== undefined) {
      link = await this.feedbackRepository.upsertLink({
        predictionId: saved.record.id,
        platform: parsed.platform,
        platformPostId: parsed.platformPostId,
        method: "recorded_platform_post_id",
        linkedAt: now,
      });
    }

    return recordFeedbackPredictionResponseSchema.parse({
      record: saved.record,
      link,
      duplicate: saved.duplicate,
    });
  }

  async linkPrediction(
    request: LinkFeedbackPredictionRequest,
  ): Promise<LinkFeedbackPredictionResponse> {
    const parsed = linkFeedbackPredictionRequestSchema.parse(request);
    const link = await this.feedbackRepository.upsertLink({
      predictionId: parsed.predictionId,
      platform: parsed.platform,
      platformPostId: parsed.platformPostId,
      method: parsed.method,
      linkedAt: this.now().toISOString(),
    });

    return linkFeedbackPredictionResponseSchema.parse({ link });
  }

  async getSummary(
    request: GetFeedbackLoopSummaryRequest = {},
  ): Promise<GetFeedbackLoopSummaryResponse> {
    const parsed = getFeedbackLoopSummaryRequestSchema.parse(request);
    const predictions = await this.feedbackRepository.listPredictions(parsed);
    const links = linkByPredictionId(
      await this.feedbackRepository.listLinks(predictions.map((prediction) => prediction.id)),
    );
    const store = await this.postLibraryRepository.loadStore();
    const byPostId = postsByPlatformPostId(store.posts);
    const byHash = postsByFeedbackHash(store.posts);
    const outcomes: FeedbackOutcome[] = [];

    for (const prediction of predictions) {
      let link = links.get(prediction.id);

      if (!link) {
        const candidates = byHash.get(prediction.contentHash) ?? [];

        if (candidates.length === 1) {
          const candidate = candidates[0];
          if (candidate) {
            link = await this.feedbackRepository.upsertLink({
              predictionId: prediction.id,
              platform: "x",
              platformPostId: candidate.platformPostId,
              method: "normalized_content_hash",
              linkedAt: this.now().toISOString(),
            });
          }
        } else if (candidates.length > 1) {
          outcomes.push(
            feedbackOutcomeSchema.parse({
              status: "ambiguous",
              prediction,
              ambiguity: {
                candidatePlatformPostIds: candidates
                  .map((candidate) => candidate.platformPostId)
                  .slice(0, 20),
              },
            }),
          );
          continue;
        }
      }

      if (!link) {
        outcomes.push(feedbackOutcomeSchema.parse({ status: "pending_unlinked", prediction }));
        continue;
      }

      const actual = actualMetricsForPost(byPostId.get(link.platformPostId));
      const status = actual?.impressions === undefined ? "partial_actuals" : "linked";
      const delta = deltaFor(prediction, actual?.impressions);

      outcomes.push(
        feedbackOutcomeSchema.parse({
          status,
          prediction,
          link,
          actual,
          delta,
        }),
      );
    }

    const byFormat = new Map<FeedbackPredictionRecord["detectedFormat"], FeedbackOutcome[]>();
    for (const outcome of outcomes) {
      const list = byFormat.get(outcome.prediction.detectedFormat) ?? [];
      list.push(outcome);
      byFormat.set(outcome.prediction.detectedFormat, list);
    }

    const formatLearnings = [...byFormat.entries()].map(([format, formatOutcomes]) =>
      formatLearningFor(format, formatOutcomes),
    );

    const response = {
      generatedAt: this.now().toISOString(),
      windowDays: parsed.windowDays,
      totals: {
        predictions: outcomes.length,
        linked: outcomes.filter((outcome) => outcome.status === "linked").length,
        pendingUnlinked: outcomes.filter((outcome) => outcome.status === "pending_unlinked").length,
        ambiguous: outcomes.filter((outcome) => outcome.status === "ambiguous").length,
        partialActuals: outcomes.filter((outcome) => outcome.status === "partial_actuals").length,
        actuals: outcomes.filter((outcome) => outcome.delta?.actualImpressions !== undefined).length,
      },
      formatLearnings,
      recent: outcomes,
    };

    return getFeedbackLoopSummaryResponseSchema.parse(response);
  }
}
