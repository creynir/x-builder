import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DetectedPostFormat, ExternalXSignalEvidence, ExternalXSignalPattern } from "@x-builder/shared";
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

const standalonePattern = (overrides: Partial<ExternalXSignalPattern> = {}): ExternalXSignalPattern =>
  pattern({
    sourceIds: [],
    evidenceIds: [],
    evidence: [],
    ...overrides,
  });

type ExternalPatternSnapshotReader = {
  listGenerationPatterns(request: {
    format?: DetectedPostFormat;
    patternTypes?: ExternalXSignalPattern["patternType"][];
    minConfidence?: number;
    minSupportCount?: number;
    limit?: number;
  }): Promise<ExternalXSignalPattern[]>;
};

const snapshotReader = (repo: SqliteExternalXSignalsRepository): ExternalPatternSnapshotReader =>
  repo as unknown as ExternalPatternSnapshotReader;

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

  describe("pattern snapshot reader", () => {
    it("returns persisted pattern snapshots without joining overview-only rows", async () => {
      const repo = new SqliteExternalXSignalsRepository(openEngineDatabase(":memory:"), {
        now: () => now,
        id: () => "source-1",
      });

      await repo.addSource({ screenName: "external_builder" });
      await repo.upsertObservedEvidence([
        evidence({
          text: "RAW X PAYLOAD SENTINEL SHOULD NOT BE JOINED INTO THE SNAPSHOT READER",
          previewText: "External builders win with concrete evidence.",
        }),
      ]);
      await repo.saveRefreshRun({
        id: "run-1",
        sourceId: "source-1",
        status: "captured",
        startedAt: now,
        completedAt: now,
        evidenceCount: 1,
        warningCount: 0,
      });
      const persistedPattern = pattern({
        id: "pattern-format",
        patternType: "format",
        format: "insight_share",
        confidence: 0.82,
        supportCount: 4,
        evidence: [],
      });
      await repo.replacePatterns([
        persistedPattern,
        pattern({
          id: "pattern-hook",
          patternType: "hook",
          confidence: 0.99,
          supportCount: 10,
        }),
      ]);

      const snapshots = await snapshotReader(repo).listGenerationPatterns({});

      expect(snapshots).toEqual([persistedPattern]);
      expect(Array.isArray(snapshots)).toBe(true);
      expect(JSON.stringify(snapshots)).not.toContain("RAW X PAYLOAD SENTINEL");
      expect(snapshots).not.toHaveProperty("sources");
      expect(snapshots).not.toHaveProperty("recentEvidence");
      expect(snapshots).not.toHaveProperty("refreshRuns");
      expect(snapshots).not.toHaveProperty("totals");
    });

    it("ranks requested-format patterns before other formats and then by stable pattern priority", async () => {
      const repo = new SqliteExternalXSignalsRepository(openEngineDatabase(":memory:"), {
        now: () => now,
      });
      const patterns = [
        standalonePattern({
          id: "other-higher-confidence",
          patternType: "format",
          format: "hot_take",
          confidence: 0.99,
          supportCount: 20,
          generatedAt: "2026-06-29T12:00:00.000Z",
        }),
        standalonePattern({
          id: "requested-confidence-top",
          patternType: "format",
          format: "insight_share",
          confidence: 0.9,
          supportCount: 2,
          generatedAt: "2026-06-28T12:00:00.000Z",
        }),
        standalonePattern({
          id: "requested-support-top",
          patternType: "format",
          format: "insight_share",
          confidence: 0.8,
          supportCount: 8,
          generatedAt: "2026-06-27T12:00:00.000Z",
        }),
        standalonePattern({
          id: "requested-newer",
          patternType: "format",
          format: "insight_share",
          confidence: 0.8,
          supportCount: 5,
          generatedAt: "2026-06-29T12:00:00.000Z",
        }),
        standalonePattern({
          id: "requested-older-a",
          patternType: "format",
          format: "insight_share",
          confidence: 0.8,
          supportCount: 5,
          generatedAt: "2026-06-28T12:00:00.000Z",
        }),
        standalonePattern({
          id: "requested-older-b",
          patternType: "format",
          format: "insight_share",
          confidence: 0.8,
          supportCount: 5,
          generatedAt: "2026-06-28T12:00:00.000Z",
        }),
      ];
      await repo.replacePatterns(patterns);

      const snapshots = await snapshotReader(repo).listGenerationPatterns({ format: "insight_share" });

      expect(snapshots.map((item) => item.id)).toEqual([
        "requested-confidence-top",
        "requested-support-top",
        "requested-newer",
        "requested-older-a",
        "requested-older-b",
        "other-higher-confidence",
      ]);
    });

    it("uses default format confidence support and bounded limit filters", async () => {
      const repo = new SqliteExternalXSignalsRepository(openEngineDatabase(":memory:"), {
        now: () => now,
      });
      await repo.replacePatterns([
        ...Array.from({ length: 25 }, (_, index) =>
          standalonePattern({
            id: `valid-format-${String(index).padStart(2, "0")}`,
            patternType: "format",
            format: "genuine_question",
            confidence: 0.7,
            supportCount: 3,
            generatedAt: `2026-06-${String(28 - Math.floor(index / 10)).padStart(2, "0")}T12:${String(
              index % 10,
            ).padStart(2, "0")}:00.000Z`,
          }),
        ),
        standalonePattern({
          id: "low-confidence-format",
          patternType: "format",
          format: "genuine_question",
          confidence: 0.49,
          supportCount: 10,
        }),
        standalonePattern({
          id: "low-support-format",
          patternType: "format",
          format: "genuine_question",
          confidence: 0.95,
          supportCount: 1,
        }),
        standalonePattern({
          id: "default-excluded-hook",
          patternType: "hook",
          confidence: 1,
          supportCount: 20,
        }),
      ]);

      const snapshots = await snapshotReader(repo).listGenerationPatterns({ limit: 100 });

      expect(snapshots).toHaveLength(20);
      expect(snapshots.every((item) => item.patternType === "format")).toBe(true);
      expect(snapshots.every((item) => item.confidence >= 0.5)).toBe(true);
      expect(snapshots.every((item) => item.supportCount >= 2)).toBe(true);
      expect(snapshots.map((item) => item.id)).not.toContain("low-confidence-format");
      expect(snapshots.map((item) => item.id)).not.toContain("low-support-format");
      expect(snapshots.map((item) => item.id)).not.toContain("default-excluded-hook");
    });

    it("applies requested pattern type and threshold filters", async () => {
      const repo = new SqliteExternalXSignalsRepository(openEngineDatabase(":memory:"), {
        now: () => now,
      });
      await repo.replacePatterns([
        standalonePattern({
          id: "included-hook",
          patternType: "hook",
          confidence: 0.4,
          supportCount: 1,
        }),
        standalonePattern({
          id: "excluded-format",
          patternType: "format",
          format: "story",
          confidence: 0.95,
          supportCount: 9,
        }),
        standalonePattern({
          id: "excluded-low-confidence-hook",
          patternType: "hook",
          confidence: 0.39,
          supportCount: 3,
        }),
        standalonePattern({
          id: "excluded-low-support-hook",
          patternType: "hook",
          confidence: 0.9,
          supportCount: 0,
        }),
      ]);

      const snapshots = await snapshotReader(repo).listGenerationPatterns({
        patternTypes: ["hook"],
        minConfidence: 0.4,
        minSupportCount: 1,
      });

      expect(snapshots.map((item) => item.id)).toEqual(["included-hook"]);
    });

    it("throws when a stored pattern payload cannot be parsed as a pattern", async () => {
      const db = openEngineDatabase(":memory:");
      const repo = new SqliteExternalXSignalsRepository(db, {
        now: () => now,
      });
      db.prepare(
        `INSERT INTO external_x_signal_pattern (
          id, pattern_type, label, statement, confidence, support_count, generated_at, version, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "malformed-pattern",
        "format",
        "Malformed pattern",
        "This row should fail payload validation.",
        0.9,
        3,
        now,
        "external-x-signals:v1",
        JSON.stringify({
          id: "malformed-pattern",
          patternType: "format",
          confidence: 0.9,
          supportCount: 3,
          generatedAt: now,
          version: "external-x-signals:v1",
        }),
      );

      await expect(snapshotReader(repo).listGenerationPatterns({})).rejects.toThrow();
    });

    it("returns an empty list when no patterns are stored", async () => {
      const repo = new SqliteExternalXSignalsRepository(openEngineDatabase(":memory:"), {
        now: () => now,
      });

      await expect(snapshotReader(repo).listGenerationPatterns({})).resolves.toEqual([]);
    });
  });
});
