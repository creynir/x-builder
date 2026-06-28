import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { FeedbackPredictionLink, FeedbackPredictionRecord } from "@x-builder/shared";
import { openEngineDatabase } from "../server/open-engine-database.js";
import { normalizeFeedbackContentHash } from "./normalize-feedback-content-hash.js";
import { SqliteFeedbackLoopRepository } from "./sqlite-feedback-loop-repository.js";

const now = "2026-06-28T09:00:00.000Z";

const prediction: FeedbackPredictionRecord["prediction"] = {
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

const record = (overrides: Partial<FeedbackPredictionRecord> = {}): FeedbackPredictionRecord => ({
  id: "feedback-1",
  clientEventId: "event-1",
  action: "generated_draft_written",
  platform: "x",
  text: "Local feedback loops need explicit matching.",
  contentHash: normalizeFeedbackContentHash("Local feedback loops need explicit matching."),
  detectedFormat: "insight_share",
  sourceFormat: "mini-framework",
  scoreValue: 72,
  prediction,
  scoringContext: { followers: 1_200, trailingMedianImpressions: 350 },
  analyzerVersion: "deterministic-v1",
  analyzedAt: now,
  createdAt: now,
  ...overrides,
});

const link = (overrides: Partial<FeedbackPredictionLink> = {}): FeedbackPredictionLink => ({
  predictionId: "feedback-1",
  platform: "x",
  platformPostId: "1800000000000000001",
  method: "manual_platform_post_id",
  linkedAt: now,
  ...overrides,
});

const withTempDbPath = async <T>(run: (dbPath: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-feedback-repo-"));

  try {
    return await run(join(root, "x-builder.db"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("SqliteFeedbackLoopRepository", () => {
  it("opens new databases at migration version 2", () => {
    const db = openEngineDatabase(":memory:");

    expect(db.pragma("user_version", { simple: true })).toBe(2);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(
        "feedback_prediction",
      ),
    ).toBeDefined();
  });

  it("records predictions and lists them after reopening the database", async () => {
    await withTempDbPath(async (dbPath) => {
      const first = openEngineDatabase(dbPath);
      const firstRepo = new SqliteFeedbackLoopRepository(first);

      const saved = await firstRepo.recordPrediction(record());

      expect(saved.duplicate).toBe(false);
      first.close();

      const second = openEngineDatabase(dbPath);
      const secondRepo = new SqliteFeedbackLoopRepository(second);
      const rows = await secondRepo.listPredictions({ windowDays: 365, limit: 10 });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "feedback-1",
        clientEventId: "event-1",
        prediction: { predictedMidImpressions: 480 },
      });
      second.close();
    });
  });

  it("returns the existing record for duplicate clientEventId", async () => {
    const repo = new SqliteFeedbackLoopRepository(openEngineDatabase(":memory:"));

    const first = await repo.recordPrediction(record());
    const second = await repo.recordPrediction(record({ id: "feedback-2" }));

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.record.id).toBe("feedback-1");
    expect(await repo.listPredictions({ windowDays: 365, limit: 10 })).toHaveLength(1);
  });

  it("upserts links for a prediction", async () => {
    const repo = new SqliteFeedbackLoopRepository(openEngineDatabase(":memory:"));
    await repo.recordPrediction(record());

    await repo.upsertLink(link());
    const updated = await repo.upsertLink(
      link({
        platformPostId: "1800000000000000002",
        linkedAt: "2026-06-28T10:00:00.000Z",
      }),
    );

    expect(updated.platformPostId).toBe("1800000000000000002");
    expect(await repo.listLinks(["feedback-1"])).toEqual([updated]);
  });

  it("normalizes equivalent whitespace and unicode before hashing", () => {
    expect(normalizeFeedbackContentHash("Cafe\u0301   launch"))
      .toBe(normalizeFeedbackContentHash("Café launch"));
  });
});
