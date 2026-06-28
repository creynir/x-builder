import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ENGINE_TRANSPORT_BINDINGS,
  addExternalXSignalSourceResponseSchema,
  getExternalXSignalsOverviewResponseSchema,
  removeExternalXSignalSourceResponseSchema,
} from "@x-builder/shared";
import {
  ExternalXSignalsService,
  JsonFileAppSettingsRepository,
  LiveCaptureService,
  SqliteExternalXSignalsRepository,
  SqlitePostLibraryRepository,
  openEngineDatabase,
} from "@x-builder/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import userTweetsValid from "./__fixtures__/graphql/user-tweets-valid.json";
import { createBoundEngineServices } from "./bound-engine-services.js";
import { ExposeFunctionTransport } from "./expose-function-transport.js";
import { ExternalXSignalsCaptureObserver } from "./external-x-signals-capture-observer.js";
import { GraphQlCaptureObserver, type ResponseLike } from "./graphql-capture-observer.js";

const NOW = "2026-06-28T12:00:00.000Z";
const USER_TWEETS_URL = "https://x.com/i/api/graphql/abc123/UserTweets?variables=%7B%7D";

type ResponseHandler = (response: ResponseLike) => unknown;

let tempDir: string;

function createMultiContext() {
  const handlers: ResponseHandler[] = [];
  return {
    context: {
      on: vi.fn((event: string, handler: ResponseHandler) => {
        if (event === "response") handlers.push(handler);
      }),
    },
    async fire(response: ResponseLike): Promise<void> {
      for (const handler of handlers) {
        await handler(response);
      }
    },
  };
}

function mockResponse(body: unknown): ResponseLike {
  return {
    url: () => USER_TWEETS_URL,
    json: async () => body,
  };
}

function createMockPage() {
  const handlers = new Map<string, (arg?: unknown) => unknown>();
  const exposeFunction = vi.fn(async (name: string, handler: (arg?: unknown) => unknown) => {
    handlers.set(name, handler);
  });
  return { page: { exposeFunction }, handlers };
}

const tableCount = (
  db: ReturnType<typeof openEngineDatabase>,
  table: "post" | "metric_obs" | "source_ref",
): number => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

function createFakeLlm() {
  return {
    generateStructured: vi.fn(async () => {
      throw new Error("LLM should not be called by external X signal integration tests.");
    }),
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "x-builder-external-x-runner-"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("external X signals runner integration", () => {
  it("keeps the transport method set exact and exposes only the four external signal methods", () => {
    const methods = Object.keys(ENGINE_TRANSPORT_BINDINGS);
    const externalMethods = methods.filter((method) => method.includes("ExternalXSignal"));

    expect(methods).toHaveLength(24);
    expect(externalMethods.sort()).toEqual([
      "addExternalXSignalSource",
      "getExternalXSignalsOverview",
      "refreshExternalXSignalSource",
      "removeExternalXSignalSource",
    ]);
  });

  it("round-trips transport and observer ingestion without leaking into own-post capture", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));

    const externalDb = openEngineDatabase(":memory:");
    const ownDb = openEngineDatabase(":memory:");
    let nextRepositoryId = 0;
    let nextServiceId = 0;
    const externalRepository = new SqliteExternalXSignalsRepository(externalDb, {
      now: () => NOW,
      id: () => `external-source-${++nextRepositoryId}`,
    });
    const externalService = new ExternalXSignalsService({
      repository: externalRepository,
      now: () => new Date(NOW),
      idGenerator: () => `external-record-${++nextServiceId}`,
    });
    const ownRepository = new SqlitePostLibraryRepository(ownDb);
    const liveCapture = new LiveCaptureService(ownRepository);
    const llm = createFakeLlm();
    const services = createBoundEngineServices({
      settingsRepository: new JsonFileAppSettingsRepository({ root: join(tempDir, "settings") }),
      postLibraryRepository: ownRepository,
      liveCapture,
      externalXSignalsService: externalService,
      llm,
      judgeLlm: llm as never,
      observer: { state: "ok", lastCaptureAt: undefined },
    });
    const mockPage = createMockPage();
    await ExposeFunctionTransport.bindAll(mockPage.page as never, services);

    const addHandler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.addExternalXSignalSource)!;
    const overviewHandler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.getExternalXSignalsOverview)!;
    const removeHandler = mockPage.handlers.get(ENGINE_TRANSPORT_BINDINGS.removeExternalXSignalSource)!;

    const added = addExternalXSignalSourceResponseSchema.parse(
      await addHandler({ screenName: "indie_hacker", platformUserId: "44196397" }),
    );

    const ctx = createMultiContext();
    const externalObserver = ExternalXSignalsCaptureObserver.attach(ctx.context, externalService);
    const ownBatch = vi.fn(async (batch) => {
      await liveCapture.ingest(batch);
    });
    GraphQlCaptureObserver.attach(ctx.context, ownBatch, {
      shouldSkip: (observation) => externalObserver.isRegisteredExternalObservation(observation),
    });

    await ctx.fire(mockResponse(userTweetsValid));
    const afterFirst = getExternalXSignalsOverviewResponseSchema.parse(
      await overviewHandler({ includeRemoved: true, recentEvidenceLimit: 20, refreshRunLimit: 20 }),
    );

    await ctx.fire(mockResponse(userTweetsValid));
    const afterDuplicate = getExternalXSignalsOverviewResponseSchema.parse(
      await overviewHandler({ includeRemoved: true, recentEvidenceLimit: 20, refreshRunLimit: 20 }),
    );

    expect(added.source).toMatchObject({
      screenName: "indie_hacker",
      platformUserId: "44196397",
    });
    expect(afterFirst.totals.evidence).toBeGreaterThan(0);
    expect(afterDuplicate.totals.evidence).toBe(afterFirst.totals.evidence);
    expect(afterDuplicate.totals.refreshRuns).toBe(2);
    expect(afterDuplicate.recentEvidence).toHaveLength(afterFirst.totals.evidence);
    expect(ownBatch).not.toHaveBeenCalled();
    expect((await ownRepository.loadStore()).posts).toHaveLength(0);
    expect(tableCount(ownDb, "post")).toBe(0);
    expect(tableCount(ownDb, "metric_obs")).toBe(0);
    expect(tableCount(ownDb, "source_ref")).toBe(0);

    const removed = removeExternalXSignalSourceResponseSchema.parse(
      await removeHandler({ sourceId: added.source.id }),
    );
    const defaultOverview = getExternalXSignalsOverviewResponseSchema.parse(
      await overviewHandler({ recentEvidenceLimit: 20 }),
    );
    const includeRemovedOverview = getExternalXSignalsOverviewResponseSchema.parse(
      await overviewHandler({ includeRemoved: true, recentEvidenceLimit: 20 }),
    );

    expect(removed.source.status).toBe("removed");
    expect(defaultOverview.sources).toEqual([]);
    expect(defaultOverview.recentEvidence).toEqual([]);
    expect(defaultOverview.totals.evidence).toBe(afterFirst.totals.evidence);
    expect(includeRemovedOverview.sources[0]).toMatchObject({
      id: added.source.id,
      status: "removed",
    });
    expect(includeRemovedOverview.recentEvidence).toHaveLength(afterFirst.totals.evidence);

    externalDb.close();
    ownDb.close();
  });
});
