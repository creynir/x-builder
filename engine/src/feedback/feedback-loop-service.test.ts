import { describe, expect, it } from "vitest";

import type { FeedbackPredictionSnapshot, RecordFeedbackPredictionRequest } from "@x-builder/shared";
import { openEngineDatabase } from "../server/open-engine-database.js";
import { SqlitePostLibraryRepository } from "../server/sqlite-post-library-repository.js";
import { seedPosts } from "../server/sqlite-test-helpers.js";
import type { CanonicalOwnPost } from "../server/post-library-repository.js";
import { FeedbackLoopService } from "./feedback-loop-service.js";
import { SqliteFeedbackLoopRepository } from "./sqlite-feedback-loop-repository.js";

const now = "2026-06-28T09:00:00.000Z";
const later = "2026-06-28T10:00:00.000Z";

const prediction: FeedbackPredictionSnapshot["prediction"] = {
  status: "available",
  signals: [
    {
      signal_key: "quality_score",
      label: "Score 72",
      multiplier: 0.9,
    },
  ],
  predictedMidImpressions: 480,
  stallRange: { low: 200, high: 420 },
  escapeRange: { low: 900, high: 2600 },
  escapeProbability: 0.18,
  expectedReplies: 4,
  baseImpressions: 320,
  baseSource: "follower_estimate",
  qualityBasis: "static",
  reachModelVersion: "reach-v1",
};

const request = (text: string, id = "event-1"): RecordFeedbackPredictionRequest => ({
  clientEventId: id,
  action: "generated_draft_written",
  platform: "x",
  text,
  snapshot: {
    detectedFormat: "insight_share",
    sourceFormat: "mini-framework",
    scoreValue: 72,
    prediction,
    scoringContext: { followers: 1_200, trailingMedianImpressions: 350 },
    analyzerVersion: "deterministic-v1",
    analyzedAt: now,
  },
});

const post = (overrides: Partial<CanonicalOwnPost> = {}): CanonicalOwnPost => ({
  id: overrides.platformPostId ?? "post-1",
  platform: "x",
  platformPostId: "1800000000000000001",
  text: "Local feedback loops need explicit matching.",
  createdAt: "2026-06-28T08:30:00.000Z",
  kind: "original",
  language: "en",
  replyReferences: {},
  entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
  weakMetrics: {},
  metricSnapshots: [
    {
      source: "x_live_capture",
      capturedAt: later,
      impressions: 960,
      likes: 42,
      reposts: 3,
      replies: 7,
    },
  ],
  sourceRefs: [],
  updatedAt: later,
  ...overrides,
});

const makeService = () => {
  const db = openEngineDatabase(":memory:");
  const feedbackRepository = new SqliteFeedbackLoopRepository(db);
  const postLibraryRepository = new SqlitePostLibraryRepository(db);
  let next = 1;
  const service = new FeedbackLoopService({
    feedbackRepository,
    postLibraryRepository,
    now: () => new Date(now),
    idGenerator: () => `feedback-${next++}`,
  });

  return { db, feedbackRepository, postLibraryRepository, service };
};

describe("FeedbackLoopService", () => {
  it("auto-links a prediction when exactly one captured post has the same normalized content hash", async () => {
    const { db, service } = makeService();
    await seedPosts(db, [post()]);
    await service.recordPrediction(request("Local   feedback loops need explicit matching."));

    const summary = await service.getSummary({ windowDays: 90, limit: 10 });

    expect(summary.totals).toMatchObject({ predictions: 1, linked: 1, actuals: 1 });
    expect(summary.recent[0]).toMatchObject({
      status: "linked",
      link: { method: "normalized_content_hash", platformPostId: "1800000000000000001" },
      actual: { impressions: 960 },
      delta: { actualImpressions: 960, bucket: "within_escape", ratio: 2 },
    });
    expect(summary.formatLearnings[0]).toMatchObject({
      format: "insight_share",
      actualCount: 1,
      direction: "up",
    });
  });

  it("marks multiple normalized hash matches ambiguous and creates no automatic link", async () => {
    const { db, feedbackRepository, service } = makeService();
    await seedPosts(db, [
      post({ platformPostId: "1800000000000000001" }),
      post({ id: "post-2", platformPostId: "1800000000000000002" }),
    ]);
    const recorded = await service.recordPrediction(request("Local feedback loops need explicit matching."));

    const summary = await service.getSummary({ windowDays: 90, limit: 10 });

    expect(summary.recent[0]).toMatchObject({
      status: "ambiguous",
      ambiguity: { candidatePlatformPostIds: [
        "1800000000000000001",
        "1800000000000000002",
      ] },
    });
    expect(await feedbackRepository.listLinks([recorded.record.id])).toEqual([]);
  });

  it("uses an explicit manual platform link over hash matching", async () => {
    const { db, service } = makeService();
    await seedPosts(db, [post({ text: "A different captured post." })]);
    const recorded = await service.recordPrediction(request("Local feedback loops need explicit matching."));

    await service.linkPrediction({
      predictionId: recorded.record.id,
      platformPostId: "1800000000000000001",
      method: "manual_platform_post_id",
    });

    const summary = await service.getSummary({ windowDays: 90, limit: 10 });

    expect(summary.recent[0]).toMatchObject({
      status: "linked",
      link: { method: "manual_platform_post_id", platformPostId: "1800000000000000001" },
      actual: { impressions: 960 },
    });
  });

  it("returns partial_actuals for linked archive-only metrics", async () => {
    const { db, service } = makeService();
    await seedPosts(db, [
      post({
        metricSnapshots: [
          {
            source: "archive_tweets_js",
            observedAt: "2026-06-28T08:30:00.000Z",
            importedAt: later,
            favoriteCount: 12,
            retweetCount: 2,
          },
        ],
        weakMetrics: { favoriteCount: 12, retweetCount: 2 },
      }),
    ]);

    await service.recordPrediction({
      ...request("Local feedback loops need explicit matching."),
      platformPostId: "1800000000000000001",
    });

    const summary = await service.getSummary({ windowDays: 90, limit: 10 });

    expect(summary.recent[0]).toMatchObject({
      status: "partial_actuals",
      link: { method: "recorded_platform_post_id" },
      actual: { source: "archive_tweets_js", favoriteCount: 12 },
      delta: { bucket: "unknown" },
    });
  });
});
