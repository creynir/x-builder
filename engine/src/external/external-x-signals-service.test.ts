import { describe, expect, it } from "vitest";

import { openEngineDatabase } from "../server/open-engine-database.js";
import { ExternalXSignalsService } from "./external-x-signals-service.js";
import { SqliteExternalXSignalsRepository } from "./sqlite-external-x-signals-repository.js";

const now = "2026-06-28T12:00:00.000Z";

const makeService = () => {
  let nextId = 0;
  const db = openEngineDatabase(":memory:");
  const repository = new SqliteExternalXSignalsRepository(db, {
    now: () => now,
    id: () => `source-${++nextId}`,
  });
  const service = new ExternalXSignalsService({
    repository,
    now: () => new Date(now),
    idGenerator: () => `id-${++nextId}`,
  });

  return { db, service };
};

describe("ExternalXSignalsService", () => {
  it("adds sources idempotently and exposes them in overview", async () => {
    const { service } = makeService();

    const first = await service.addSource({ screenName: "@External_Builder" });
    const second = await service.addSource({ screenName: "external_builder" });
    const overview = await service.getOverview({});

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(overview.sources).toHaveLength(1);
    expect(overview.sources[0]?.screenName).toBe("external_builder");
  });

  it("skips unregistered observed batches fail-closed", async () => {
    const { service } = makeService();

    const result = await service.ingestObservedTimeline({
      screenName: "unknown_builder",
      observedAt: now,
      posts: [
        {
          platformPostId: "1800000000000000001",
          text: "This should not be persisted.",
        },
      ],
    });
    const overview = await service.getOverview({});

    expect(result.matched).toBe(false);
    expect(overview.totals.evidence).toBe(0);
  });

  it("persists registered observed evidence and derives persisted patterns", async () => {
    const { service } = makeService();
    await service.addSource({ screenName: "external_builder" });

    const result = await service.ingestObservedTimeline({
      screenName: "@External_Builder",
      observedAt: now,
      posts: [
        {
          platformPostId: "1800000000000000001",
          text: "Ship the smallest paid thing first. Proof beats positioning.",
          metrics: { likes: 10, reposts: 2 },
        },
        {
          platformPostId: "1800000000000000002",
          text: "Ship the smallest paid thing first. Specific proof makes people believe.",
          metrics: { likes: 14, reposts: 3 },
        },
        {
          platformPostId: "1800000000000000003",
          text: "Ship the smallest paid thing first. Evidence converts vague advice into trust.",
          metrics: { likes: 20, reposts: 4 },
        },
      ],
    });
    const overview = await service.getOverview({});

    expect(result).toMatchObject({ matched: true, insertedCount: 3 });
    expect(overview.totals.evidence).toBe(3);
    expect(overview.totals.patterns).toBeGreaterThan(0);
    expect(overview.patterns[0]?.supportCount).toBe(3);
    expect(overview.patterns[0]?.evidenceIds).toHaveLength(3);
  });

  it("records no-observation refresh without fabricating evidence", async () => {
    const { service } = makeService();
    const source = await service.addSource({ screenName: "external_builder" });

    const response = await service.refreshSource({ sourceId: source.source.id });
    const overview = await service.getOverview({});

    expect(response.run.status).toBe("no_observation");
    expect(response.run.evidenceCount).toBe(0);
    expect(overview.totals.evidence).toBe(0);
    expect(overview.refreshRuns[0]?.status).toBe("no_observation");
  });

  it("soft-removes sources and excludes them from default overview", async () => {
    const { service } = makeService();
    const source = await service.addSource({ screenName: "external_builder" });

    await service.removeSource({ sourceId: source.source.id });

    expect((await service.getOverview({})).sources).toEqual([]);
    expect((await service.getOverview({ includeRemoved: true })).sources[0]?.status).toBe("removed");
    await expect(service.refreshSource({ sourceId: source.source.id })).rejects.toThrow(
      "removed",
    );
  });
});
