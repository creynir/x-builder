import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addExternalXSignalSourceResponseSchema,
  apiErrorSchema,
  getExternalXSignalsOverviewResponseSchema,
  refreshExternalXSignalSourceResponseSchema,
  removeExternalXSignalSourceResponseSchema,
  type ExternalXSignalSource,
  type GetExternalXSignalsOverviewResponse,
} from "@x-builder/shared";
import { describe, expect, it, vi } from "vitest";

import type { ExternalXSignalsService } from "../../external/external-x-signals-service.js";
import { buildServer } from "../server.js";

const now = "2026-06-28T12:00:00.000Z";

const source = (overrides: Partial<ExternalXSignalSource> = {}): ExternalXSignalSource => ({
  id: "source-1",
  platform: "x",
  screenName: "external_builder",
  status: "active",
  evidenceCount: 0,
  patternCount: 0,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const overview = (
  overrides: Partial<GetExternalXSignalsOverviewResponse> = {},
): GetExternalXSignalsOverviewResponse => ({
  generatedAt: now,
  sources: [],
  totals: {
    sources: 0,
    activeSources: 0,
    evidence: 0,
    patterns: 0,
    refreshRuns: 0,
  },
  patterns: [],
  recentEvidence: [],
  refreshRuns: [],
  ...overrides,
});

const parseJson = (body: string): unknown => JSON.parse(body);

const fakeService = (overrides: Partial<ExternalXSignalsService> = {}): ExternalXSignalsService => ({
  addSource: vi.fn(async () => ({ source: source(), duplicate: false })),
  removeSource: vi.fn(async () => ({ source: source({ status: "removed" }), removed: true })),
  refreshSource: vi.fn(async () => ({
    source: source(),
    run: {
      id: "run-1",
      sourceId: "source-1",
      status: "no_observation",
      startedAt: now,
      completedAt: now,
      evidenceCount: 0,
      warningCount: 0,
      message: "No already-observed X traffic matched this source.",
    },
  })),
  getOverview: vi.fn(async () => overview()),
  ingestObservedTimeline: vi.fn(),
  ...overrides,
} as unknown as ExternalXSignalsService);

const withTempRoot = async <T>(run: (root: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-external-x-routes-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("external X signals routes", () => {
  it("adds a source through the canonical route with parsed shared input", async () => {
    const externalXSignalsService = fakeService();
    const app = buildServer({ externalXSignalsService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/external-x/signals/sources",
        payload: { screenName: "@External_Builder" },
      });

      expect(response.statusCode).toBe(200);
      expect(addExternalXSignalSourceResponseSchema.parse(parseJson(response.body))).toMatchObject({
        source: { screenName: "external_builder" },
      });
      expect(externalXSignalsService.addSource).toHaveBeenCalledWith({
        screenName: "external_builder",
      });
    } finally {
      await app.close();
    }
  });

  it("rejects invalid add-source input before calling the service", async () => {
    const externalXSignalsService = fakeService();
    const app = buildServer({ externalXSignalsService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/external-x/signals/sources",
        payload: { screenName: " @ " },
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorSchema.parse(parseJson(response.body))).toMatchObject({
        code: "validation_failed",
        scope: "field",
      });
      expect(externalXSignalsService.addSource).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns bounded overview data from query params", async () => {
    const externalXSignalsService = fakeService({
      getOverview: vi.fn(async () => overview({ sources: [source()], totals: {
        sources: 1,
        activeSources: 1,
        evidence: 0,
        patterns: 0,
        refreshRuns: 0,
      } })),
    } as Partial<ExternalXSignalsService>);
    const app = buildServer({ externalXSignalsService });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/external-x/signals/overview?includeRemoved=true&sourceLimit=2&patternLimit=3&recentEvidenceLimit=4&refreshRunLimit=5",
      });

      expect(response.statusCode).toBe(200);
      const parsed = getExternalXSignalsOverviewResponseSchema.parse(parseJson(response.body));
      expect(parsed.sources[0]?.screenName).toBe("external_builder");
      expect(externalXSignalsService.getOverview).toHaveBeenCalledWith({
        includeRemoved: true,
        sourceLimit: 2,
        patternLimit: 3,
        recentEvidenceLimit: 4,
        refreshRunLimit: 5,
      });
    } finally {
      await app.close();
    }
  });

  it("removes and refreshes sources through path-param routes", async () => {
    const externalXSignalsService = fakeService();
    const app = buildServer({ externalXSignalsService });

    try {
      const removeResponse = await app.inject({
        method: "DELETE",
        url: "/external-x/signals/sources/source-1",
      });
      const refreshResponse = await app.inject({
        method: "POST",
        url: "/external-x/signals/sources/source-1/refresh",
        payload: { sourceId: "ignored-body-id" },
      });

      expect(removeResponse.statusCode).toBe(200);
      expect(refreshResponse.statusCode).toBe(200);
      expect(removeExternalXSignalSourceResponseSchema.parse(parseJson(removeResponse.body))).toMatchObject({
        source: { status: "removed" },
        removed: true,
      });
      expect(refreshExternalXSignalSourceResponseSchema.parse(parseJson(refreshResponse.body))).toMatchObject({
        run: { status: "no_observation" },
      });
      expect(externalXSignalsService.removeSource).toHaveBeenCalledWith({ sourceId: "source-1" });
      expect(externalXSignalsService.refreshSource).toHaveBeenCalledWith({ sourceId: "source-1" });
    } finally {
      await app.close();
    }
  });

  it("maps service failures to scoped external-x-signals API errors", async () => {
    const externalXSignalsService = fakeService({
      refreshSource: vi.fn(async () => {
        throw new Error("sqlite path /private/customer.db leaked");
      }),
    } as Partial<ExternalXSignalsService>);
    const app = buildServer({ externalXSignalsService });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/external-x/signals/sources/source-1/refresh",
      });
      const payload = parseJson(response.body);

      expect(response.statusCode).toBe(500);
      expect(apiErrorSchema.parse(payload)).toMatchObject({
        code: "external_x_signals_refresh_failed",
        scope: "external-x-signals",
        retryable: true,
      });
      expect(JSON.stringify(payload)).not.toContain("customer.db");
    } finally {
      await app.close();
    }
  });

  it("persists sources through storageRoot-backed default service wiring", async () => {
    await withTempRoot(async (root) => {
      const app = buildServer({ storageRoot: root });

      try {
        const addResponse = await app.inject({
          method: "POST",
          url: "/external-x/signals/sources",
          payload: { screenName: "external_builder" },
        });
        const overviewResponse = await app.inject({
          method: "GET",
          url: "/external-x/signals/overview",
        });

        expect(addResponse.statusCode).toBe(200);
        expect(overviewResponse.statusCode).toBe(200);
        expect(getExternalXSignalsOverviewResponseSchema.parse(parseJson(overviewResponse.body))).toMatchObject({
          sources: [{ screenName: "external_builder" }],
          totals: { sources: 1, activeSources: 1 },
        });
      } finally {
        await app.close();
      }
    });
  });
});
