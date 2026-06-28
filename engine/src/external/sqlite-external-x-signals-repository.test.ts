import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ExternalXSignalEvidence, ExternalXSignalPattern } from "@x-builder/shared";
import { openEngineDatabase } from "../server/open-engine-database.js";
import { SqliteExternalXSignalsRepository } from "./sqlite-external-x-signals-repository.js";

const now = "2026-06-28T12:00:00.000Z";

const withTempDbPath = async <T>(run: (dbPath: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-external-signals-"));

  try {
    return await run(join(root, "x-builder.db"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const evidence = (overrides: Partial<ExternalXSignalEvidence> = {}): ExternalXSignalEvidence => ({
  id: "evidence-1",
  sourceId: "source-1",
  platform: "x",
  platformPostId: "1800000000000000001",
  screenName: "external_builder",
  text: "External builders win when launch posts show concrete before and after evidence.",
  previewText: "External builders win with concrete evidence.",
  kind: "original",
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
  metrics: { likes: 12, reposts: 3 },
  evidenceSource: "external_x_graphql_observe",
  observedAt: now,
  ...overrides,
});

const pattern = (overrides: Partial<ExternalXSignalPattern> = {}): ExternalXSignalPattern => ({
  id: "pattern-1",
  patternType: "hook",
  label: "Concrete launch proof",
  statement: "High-signal external examples open with specific proof.",
  confidence: 0.72,
  supportCount: 3,
  sourceIds: ["source-1"],
  evidenceIds: ["evidence-1"],
  evidence: [
    {
      evidenceId: "evidence-1",
      sourceId: "source-1",
      screenName: "external_builder",
      platformPostId: "1800000000000000001",
      text: "External builders win with concrete evidence.",
      metrics: { likes: 12 },
    },
  ],
  generatedAt: now,
  version: "external-x-signals:v1",
  ...overrides,
});

describe("SqliteExternalXSignalsRepository", () => {
  it("opens new databases at migration version 3 with external ledger tables", () => {
    const db = openEngineDatabase(":memory:");

    expect(db.pragma("user_version", { simple: true })).toBe(3);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(
        "external_x_signal_source",
      ),
    ).toBeDefined();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(
        "external_x_signal_pattern",
      ),
    ).toBeDefined();
  });

  it("adds sources idempotently by normalized handle", async () => {
    const repo = new SqliteExternalXSignalsRepository(openEngineDatabase(":memory:"), {
      now: () => now,
      id: () => "source-1",
    });

    const first = await repo.addSource({ screenName: "@External_Builder" });
    const second = await repo.addSource({ screenName: " external_builder " });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.source.id).toBe("source-1");
    expect(second.source.screenName).toBe("external_builder");
  });

  it("persists evidence, refresh runs, and pattern snapshots after reopening", async () => {
    await withTempDbPath(async (dbPath) => {
      const firstDb = openEngineDatabase(dbPath);
      const first = new SqliteExternalXSignalsRepository(firstDb, {
        now: () => now,
        id: () => "source-1",
      });

      await first.addSource({ screenName: "external_builder" });
      await first.upsertObservedEvidence([evidence()]);
      await first.saveRefreshRun({
        id: "run-1",
        sourceId: "source-1",
        status: "captured",
        startedAt: now,
        completedAt: now,
        evidenceCount: 1,
        warningCount: 0,
      });
      await first.replacePatterns([pattern()]);
      firstDb.close();

      const second = new SqliteExternalXSignalsRepository(openEngineDatabase(dbPath), {
        now: () => now,
      });
      const overview = await second.getOverview({});

      expect(overview.sources).toHaveLength(1);
      expect(overview.totals).toMatchObject({ sources: 1, evidence: 1, patterns: 1, refreshRuns: 1 });
      expect(overview.patterns[0]?.evidenceIds).toEqual(["evidence-1"]);
      expect(overview.refreshRuns[0]?.status).toBe("captured");
    });
  });

  it("dedupes repeated evidence and never writes own-post tables", async () => {
    const db = openEngineDatabase(":memory:");
    const repo = new SqliteExternalXSignalsRepository(db, {
      now: () => now,
      id: () => "source-1",
    });

    await repo.addSource({ screenName: "external_builder" });
    const beforePosts = db.prepare("SELECT COUNT(*) AS count FROM post").get() as { count: number };
    const beforeMetrics = db.prepare("SELECT COUNT(*) AS count FROM metric_obs").get() as { count: number };

    const result = await repo.upsertObservedEvidence([
      evidence(),
      evidence({ id: "evidence-duplicate" }),
    ]);

    const afterPosts = db.prepare("SELECT COUNT(*) AS count FROM post").get() as { count: number };
    const afterMetrics = db.prepare("SELECT COUNT(*) AS count FROM metric_obs").get() as { count: number };

    expect(result).toMatchObject({ insertedCount: 1, duplicateCount: 1 });
    expect(afterPosts.count).toBe(beforePosts.count);
    expect(afterMetrics.count).toBe(beforeMetrics.count);
  });

  it("soft-removes sources while preserving evidence", async () => {
    const repo = new SqliteExternalXSignalsRepository(openEngineDatabase(":memory:"), {
      now: () => now,
      id: () => "source-1",
    });

    await repo.addSource({ screenName: "external_builder" });
    await repo.upsertObservedEvidence([evidence()]);
    await repo.removeSource({ sourceId: "source-1" });

    const activeOverview = await repo.getOverview({});
    const fullOverview = await repo.getOverview({ includeRemoved: true });

    expect(activeOverview.sources).toEqual([]);
    expect(fullOverview.sources[0]?.status).toBe("removed");
    expect(fullOverview.recentEvidence).toHaveLength(1);
  });
});
