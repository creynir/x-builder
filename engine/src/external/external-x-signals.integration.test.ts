import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addExternalXSignalSourceResponseSchema,
  getExternalXSignalsOverviewResponseSchema,
  removeExternalXSignalSourceResponseSchema,
} from "@x-builder/shared";
import { describe, expect, it } from "vitest";

import { buildServer } from "../server/server.js";
import { openEngineDatabase } from "../server/open-engine-database.js";
import { ExternalXSignalsService } from "./external-x-signals-service.js";
import { SqliteExternalXSignalsRepository } from "./sqlite-external-x-signals-repository.js";

const NOW = "2026-06-28T12:00:00.000Z";

const observedPosts = [
  {
    platformPostId: "1900000000000000001",
    text: "hot take: Proof beats positioning when buyers can inspect the receipt.",
    createdAt: NOW,
    kind: "original" as const,
    metrics: { likes: 21, reposts: 4 },
  },
  {
    platformPostId: "1900000000000000002",
    text: "hot take: Proof beats positioning because screenshots carry more trust than adjectives.",
    createdAt: NOW,
    kind: "original" as const,
    metrics: { likes: 34, reposts: 6 },
  },
  {
    platformPostId: "1900000000000000003",
    text: "hot take: Proof beats positioning when the example shows the exact before and after.",
    createdAt: NOW,
    kind: "original" as const,
    metrics: { likes: 55, reposts: 9 },
  },
];

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-external-x-int-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const tableCount = (
  db: ReturnType<typeof openEngineDatabase>,
  table: "post" | "metric_obs" | "source_ref" | "external_x_signal_pattern_evidence",
): number => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

describe("external X signals backend integration", () => {
  it("round-trips route, service, storage, dedupe, removed defaults, and pattern evidence links", async () => {
    await withTempRoot(async (root) => {
      const db = openEngineDatabase(join(root, "x-builder.db"));
      let nextRepositoryId = 0;
      let nextServiceId = 0;
      const repository = new SqliteExternalXSignalsRepository(db, {
        now: () => NOW,
        id: () => `external-source-${++nextRepositoryId}`,
      });
      const service = new ExternalXSignalsService({
        repository,
        now: () => new Date(NOW),
        idGenerator: () => `external-record-${++nextServiceId}`,
      });
      const app = buildServer({ externalXSignalsService: service });

      try {
        const addResponse = await app.inject({
          method: "POST",
          url: "/external-x/signals/sources",
          payload: { screenName: "@External_Builder" },
        });
        const added = addExternalXSignalSourceResponseSchema.parse(JSON.parse(addResponse.body));

        const firstIngest = await service.ingestObservedTimeline({
          screenName: "external_builder",
          observedAt: NOW,
          posts: observedPosts,
        });
        const duplicateIngest = await service.ingestObservedTimeline({
          screenName: "@External_Builder",
          observedAt: NOW,
          posts: observedPosts,
        });

        const overviewResponse = await app.inject({
          method: "GET",
          url: "/external-x/signals/overview?includeRemoved=true&sourceLimit=10&patternLimit=10&recentEvidenceLimit=10&refreshRunLimit=10",
        });
        const overview = getExternalXSignalsOverviewResponseSchema.parse(JSON.parse(overviewResponse.body));
        const pattern = overview.patterns[0];

        expect(addResponse.statusCode).toBe(200);
        expect(added.source.screenName).toBe("external_builder");
        expect(firstIngest).toMatchObject({ matched: true, insertedCount: 3, duplicateCount: 0 });
        expect(duplicateIngest).toMatchObject({ matched: true, insertedCount: 0 });
        expect(
          duplicateIngest.updatedCount + duplicateIngest.unchangedCount + duplicateIngest.duplicateCount,
        ).toBe(3);
        expect(overview.totals).toMatchObject({
          sources: 1,
          activeSources: 1,
          evidence: 3,
          refreshRuns: 2,
        });
        expect(overview.recentEvidence).toHaveLength(3);
        expect(pattern).toBeDefined();
        expect(pattern!.sourceIds).toEqual([added.source.id]);
        expect(pattern!.evidenceIds).toHaveLength(3);
        expect(pattern!.evidence).toHaveLength(3);
        expect(tableCount(db, "external_x_signal_pattern_evidence")).toBe(
          pattern!.evidenceIds.length,
        );
        expect(tableCount(db, "post")).toBe(0);
        expect(tableCount(db, "metric_obs")).toBe(0);
        expect(tableCount(db, "source_ref")).toBe(0);

        const removeResponse = await app.inject({
          method: "DELETE",
          url: `/external-x/signals/sources/${added.source.id}`,
        });
        const removed = removeExternalXSignalSourceResponseSchema.parse(JSON.parse(removeResponse.body));
        const defaultOverview = getExternalXSignalsOverviewResponseSchema.parse(
          JSON.parse((await app.inject({ method: "GET", url: "/external-x/signals/overview" })).body),
        );
        const includeRemovedOverview = getExternalXSignalsOverviewResponseSchema.parse(
          JSON.parse((await app.inject({
            method: "GET",
            url: "/external-x/signals/overview?includeRemoved=true&recentEvidenceLimit=10",
          })).body),
        );

        expect(removeResponse.statusCode).toBe(200);
        expect(removed.source.status).toBe("removed");
        expect(defaultOverview.sources).toEqual([]);
        expect(defaultOverview.recentEvidence).toEqual([]);
        expect(defaultOverview.totals).toMatchObject({ sources: 1, activeSources: 0, evidence: 3 });
        expect(includeRemovedOverview.sources[0]).toMatchObject({
          id: added.source.id,
          status: "removed",
        });
        expect(includeRemovedOverview.recentEvidence).toHaveLength(3);
      } finally {
        await app.close();
        db.close();
      }
    });
  });
});
