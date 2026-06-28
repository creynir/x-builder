import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiErrorSchema,
  getFeedbackLoopSummaryResponseSchema,
  linkFeedbackPredictionResponseSchema,
  recordFeedbackPredictionResponseSchema,
  type FeedbackPredictionSnapshot,
  type RecordFeedbackPredictionRequest,
} from "@x-builder/shared";
import { describe, expect, it, vi } from "vitest";

import type { FeedbackLoopService } from "../../feedback/feedback-loop-service.js";
import type { CanonicalOwnPost } from "../post-library-repository.js";
import { openEngineDatabase } from "../open-engine-database.js";
import { seedPosts } from "../sqlite-test-helpers.js";
import { buildServer } from "../server.js";

const now = "2026-06-28T09:00:00.000Z";
const later = "2026-06-28T10:00:00.000Z";

const prediction: FeedbackPredictionSnapshot["prediction"] = {
  status: "available",
  signals: [
    { signal_key: "quality_score", label: "Score 72", multiplier: 0.9 },
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

const recordRequest = (text: string): RecordFeedbackPredictionRequest => ({
  clientEventId: "event-1",
  action: "generated_draft_written",
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

const parseJson = (body: string): unknown => JSON.parse(body);

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-feedback-routes-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("feedback routes", () => {
  it("records and summarizes feedback against the storageRoot SQLite post library", async () => {
    await withTempRoot(async (root) => {
      const storageDir = join(root, "storage");
      await mkdir(storageDir, { recursive: true });
      const db = openEngineDatabase(join(storageDir, "x-builder.db"));
      await seedPosts(db, [post()]);
      db.close();

      const app = buildServer({ storageRoot: root });

      try {
        const recordResponse = await app.inject({
          method: "POST",
          url: "/feedback/predictions",
          payload: recordRequest("Local feedback loops need explicit matching."),
        });

        expect(recordResponse.statusCode).toBe(200);
        const recorded = recordFeedbackPredictionResponseSchema.parse(
          parseJson(recordResponse.body),
        );
        expect(recorded.record.id).toEqual(expect.any(String));

        const summaryResponse = await app.inject({
          method: "POST",
          url: "/feedback/summary",
          payload: { windowDays: 365, limit: 10 },
        });

        expect(summaryResponse.statusCode).toBe(200);
        const summary = getFeedbackLoopSummaryResponseSchema.parse(
          parseJson(summaryResponse.body),
        );
        expect(summary.recent[0]).toMatchObject({
          status: "linked",
          link: { method: "normalized_content_hash" },
          actual: { impressions: 960 },
        });
      } finally {
        await app.close();
      }
    });
  });

  it("reports ambiguous hash matches and refreshes after an explicit manual link", async () => {
    await withTempRoot(async (root) => {
      const storageDir = join(root, "storage");
      await mkdir(storageDir, { recursive: true });
      const db = openEngineDatabase(join(storageDir, "x-builder.db"));
      await seedPosts(db, [
        post({ platformPostId: "1800000000000000001" }),
        post({ id: "post-2", platformPostId: "1800000000000000002" }),
      ]);
      db.close();

      const app = buildServer({ storageRoot: root });

      try {
        const recordResponse = await app.inject({
          method: "POST",
          url: "/feedback/predictions",
          payload: recordRequest("Local feedback loops need explicit matching."),
        });
        const recorded = recordFeedbackPredictionResponseSchema.parse(parseJson(recordResponse.body));

        const ambiguousResponse = await app.inject({
          method: "POST",
          url: "/feedback/summary",
          payload: { windowDays: 365, limit: 10 },
        });
        const ambiguous = getFeedbackLoopSummaryResponseSchema.parse(
          parseJson(ambiguousResponse.body),
        );
        expect(ambiguous.recent[0]).toMatchObject({
          status: "ambiguous",
          ambiguity: {
            candidatePlatformPostIds: [
              "1800000000000000001",
              "1800000000000000002",
            ],
          },
        });

        await app.inject({
          method: "POST",
          url: "/feedback/predictions/link",
          payload: {
            predictionId: recorded.record.id,
            platformPostId: "1800000000000000002",
            method: "manual_platform_post_id",
          },
        });

        const linkedResponse = await app.inject({
          method: "POST",
          url: "/feedback/summary",
          payload: { windowDays: 365, limit: 10 },
        });
        const linked = getFeedbackLoopSummaryResponseSchema.parse(parseJson(linkedResponse.body));
        expect(linked.recent[0]).toMatchObject({
          status: "linked",
          link: {
            method: "manual_platform_post_id",
            platformPostId: "1800000000000000002",
          },
          actual: { impressions: 960 },
        });
      } finally {
        await app.close();
      }
    });
  });

  it("links a prediction explicitly through /feedback/predictions/link", async () => {
    const app = buildServer();

    try {
      const recordResponse = await app.inject({
        method: "POST",
        url: "/feedback/predictions",
        payload: recordRequest("A draft waiting for manual linking."),
      });
      const recorded = recordFeedbackPredictionResponseSchema.parse(parseJson(recordResponse.body));

      const linkResponse = await app.inject({
        method: "POST",
        url: "/feedback/predictions/link",
        payload: {
          predictionId: recorded.record.id,
          platformPostId: "1800000000000000009",
          method: "manual_platform_post_id",
        },
      });

      expect(linkResponse.statusCode).toBe(200);
      expect(linkFeedbackPredictionResponseSchema.parse(parseJson(linkResponse.body))).toMatchObject({
        link: {
          predictionId: recorded.record.id,
          platformPostId: "1800000000000000009",
          method: "manual_platform_post_id",
        },
      });
    } finally {
      await app.close();
    }
  });

  it("maps feedback service failures to feedback-scoped API errors", async () => {
    const feedbackLoopService = {
      recordPrediction: vi.fn(async () => {
        throw new Error("local sqlite path /tmp/secret.db leaked");
      }),
      linkPrediction: vi.fn(),
      getSummary: vi.fn(),
    } as unknown as FeedbackLoopService;
    const app = buildServer({ feedbackLoopService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/feedback/predictions",
        payload: recordRequest("A feedback failure fixture."),
      });

      const payload = parseJson(response.body);
      const error = apiErrorSchema.parse(payload);

      expect(response.statusCode).toBe(500);
      expect(error).toMatchObject({
        code: "feedback_record_failed",
        scope: "feedback",
        retryable: true,
      });
      expect(JSON.stringify(payload)).not.toContain("secret.db");
    } finally {
      await app.close();
    }
  });
});
