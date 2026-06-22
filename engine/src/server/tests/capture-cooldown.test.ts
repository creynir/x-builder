import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  apiErrorSchema,
  cooldownReportSchema,
  type CooldownReport,
} from "@x-builder/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { classifyPostFormat } from "../../deterministic/format-classifier";
import { RepetitionWindowService } from "../../capture/repetition-window-service";
import {
  JsonFilePostLibraryRepository,
  PostLibraryStorageError,
  type CanonicalOwnPostInput,
  type PostLibraryRepository,
} from "../post-library-repository";
import { buildServer } from "../server";

// ---------------------------------------------------------------------------
// Deterministic clock. RepetitionWindowService computes its window as
// now() - windowDays * 86_400_000. Every fixture's createdAt is expressed
// relative to this fixed instant so the in/out-of-window partition is exact
// and independent of the wall clock.
// ---------------------------------------------------------------------------
const FIXED_NOW_ISO = "2026-06-20T12:00:00.000Z";
const fixedNow = (): Date => new Date(FIXED_NOW_ISO);
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDaysAgo = (days: number): string =>
  new Date(new Date(FIXED_NOW_ISO).getTime() - days * DAY_MS).toISOString();

// ---------------------------------------------------------------------------
// Fixture text whose classification is verified against the real classifier
// (engine/src/deterministic/format-classifier.ts) by the guard test below.
// Each string starts with a hot_take opinion prefix (rule 1), so all four
// classify as hot_take.
// ---------------------------------------------------------------------------
const HOT_TAKE_TEXTS = [
  "Hot take: shipping fast beats shipping perfect every single time.",
  "Unpopular opinion: most startup advice is survivorship bias dressed up as wisdom.",
  "Real talk: your landing page does not need another testimonial section.",
  "Popular opinion: writing tests first actually saves you time later on.",
] as const;

const baseEntityFlags = {
  hasUrls: false,
  hasMedia: false,
  hasHashtags: false,
  hasMentions: false,
} as const;

let idCounter = 0;

// An original-kind post carrying an x_live_capture snapshot. corpusSource is
// derived from snapshot.source, so a live snapshot makes the corpus "live".
const liveOriginal = (text: string, createdAt: string): CanonicalOwnPostInput => {
  idCounter += 1;
  const platformPostId = `190000000000000${String(idCounter).padStart(4, "0")}`;

  return {
    id: `live-${idCounter}`,
    platform: "x",
    platformPostId,
    text,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "x_live_capture",
        capturedAt: createdAt,
        impressions: 300,
        likes: 6,
      },
    ],
    sourceRefs: [
      {
        source: "x_live_capture",
        captureSessionId: "session-1",
        rawId: platformPostId,
      },
    ],
  };
};

// An original-kind post carrying only an archive_tweets_js snapshot. With no
// live snapshot anywhere, corpusSource resolves to "archive".
const archiveOriginal = (text: string, createdAt: string): CanonicalOwnPostInput => {
  idCounter += 1;
  const platformPostId = `180000000000000${String(idCounter).padStart(4, "0")}`;

  return {
    id: `archive-${idCounter}`,
    platform: "x",
    platformPostId,
    text,
    createdAt,
    kind: "original",
    language: "en",
    replyReferences: {},
    entityFlags: { ...baseEntityFlags },
    weakMetrics: {},
    metricSnapshots: [
      {
        source: "archive_tweets_js",
        observedAt: createdAt,
        importedAt: FIXED_NOW_ISO,
      },
    ],
    sourceRefs: [
      {
        source: "archive_tweets_js",
        importRunId: "import-1",
        rawId: platformPostId,
        sourceHash:
          "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd",
      },
    ],
  };
};

// A repository whose every read fails with PostLibraryStorageError. Wrapping a
// RepetitionWindowService around it drives compute() into the storage-failure
// path that the route must translate into a 500 library_storage_failed.
const failingRepository = (): PostLibraryRepository => ({
  loadStore: async () => {
    throw new PostLibraryStorageError("boom");
  },
  upsertPosts: async () => {
    throw new PostLibraryStorageError("boom");
  },
  saveImportRun: async () => undefined,
  saveDerivedInsights: async () => undefined,
  setActiveContext: async () => undefined,
  pushProfileSnapshot: async () => undefined,
});

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);
const parseReport = (payload: unknown): CooldownReport =>
  cooldownReportSchema.parse(payload);
const parseApiError = (payload: unknown) => apiErrorSchema.parse(payload);

// ---------------------------------------------------------------------------
// Per-test isolation: fresh mkdtemp root + real repository + a real
// RepetitionWindowService pinned to the deterministic clock. The service is
// passed to buildServer via `repetitionWindowService`, the injection seam Green
// adds to BuildServerOptions. Referencing it here is the expected
// pre-implementation (RED) state — a TS2353 typecheck error until Green adds
// the option.
// ---------------------------------------------------------------------------
let root: string;
let repository: JsonFilePostLibraryRepository;
let repetitionWindowService: RepetitionWindowService;

beforeEach(async () => {
  idCounter = 0;
  root = await mkdtemp(join(tmpdir(), "x-builder-capture-cooldown-"));
  repository = new JsonFilePostLibraryRepository({ root });
  repetitionWindowService = new RepetitionWindowService(repository, fixedNow);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("capture cooldown fixture classification guard", () => {
  // Pins the fixture-to-format mapping the cooldown assertions depend on; if the
  // classifier drifts, this fails loudly instead of silently weakening the
  // hot_take cooldown test.
  it("classifies every hot_take fixture as hot_take", () => {
    for (const text of HOT_TAKE_TEXTS) {
      expect(classifyPostFormat(text)).toBe("hot_take");
    }
  });
});

describe("GET /capture/cooldown route", () => {
  // Coverage 1 + AC: four in-window hot_take originals -> 200, a schema-valid
  // report whose hot_take signal is in cooldown with countInWindow 4.
  it("returns a cooldown hot_take signal with countInWindow 4 for four in-window originals", async () => {
    // 1..4 days old, all inside the default 7-day window against the fixed clock.
    await repository.upsertPosts(
      HOT_TAKE_TEXTS.map((text, index) => liveOriginal(text, isoDaysAgo(index + 1))),
    );

    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=7",
      });

      expect(response.statusCode).toBe(200);

      const report = parseReport(parseJsonPayload(response.body));
      expect(report.windowDays).toBe(7);

      const hotTake = report.signals.find((signal) => signal.format === "hot_take");
      expect(hotTake).toBeDefined();
      expect(hotTake?.status).toBe("cooldown");
      expect(hotTake?.countInWindow).toBe(4);
    } finally {
      await app.close();
    }
  });

  // Coverage 2 + Edge: an empty corpus is a valid 200 with corpusSource "empty"
  // and no signals.
  it("returns an empty report for an empty corpus", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=7",
      });

      expect(response.statusCode).toBe(200);

      const report = parseReport(parseJsonPayload(response.body));
      expect(report.corpusSource).toBe("empty");
      expect(report.signals).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // Coverage 3 + AC: no windowDays query param -> the route's Zod default of 7
  // applies.
  it("defaults windowDays to 7 when no query parameter is supplied", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown",
      });

      expect(response.statusCode).toBe(200);

      const report = parseReport(parseJsonPayload(response.body));
      expect(report.windowDays).toBe(7);
    } finally {
      await app.close();
    }
  });

  // Coverage 4: an explicit windowDays=30 flows through to the report.
  it("honors an explicit windowDays of 30", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=30",
      });

      expect(response.statusCode).toBe(200);

      const report = parseReport(parseJsonPayload(response.body));
      expect(report.windowDays).toBe(30);
    } finally {
      await app.close();
    }
  });

  // Edge: windowDays=90 (the max) is valid -> 200.
  it("accepts windowDays at the maximum of 90", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=90",
      });

      expect(response.statusCode).toBe(200);

      const report = parseReport(parseJsonPayload(response.body));
      expect(report.windowDays).toBe(90);
    } finally {
      await app.close();
    }
  });

  // Coverage 5 + AC: windowDays=0 is below the min of 1 -> 400 validation_failed.
  it("rejects windowDays of 0 as a validation failure", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=0",
      });

      expect(response.statusCode).toBe(400);

      const error = parseApiError(parseJsonPayload(response.body));
      expect(error.code).toBe("validation_failed");
    } finally {
      await app.close();
    }
  });

  // Coverage 6: windowDays=91 is above the max of 90 -> 400 validation_failed.
  it("rejects windowDays of 91 as a validation failure", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=91",
      });

      expect(response.statusCode).toBe(400);

      const error = parseApiError(parseJsonPayload(response.body));
      expect(error.code).toBe("validation_failed");
    } finally {
      await app.close();
    }
  });

  // Edge: a non-numeric windowDays fails z.coerce.number() -> 400.
  it("rejects a non-numeric windowDays as a validation failure", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=abc",
      });

      expect(response.statusCode).toBe(400);

      const error = parseApiError(parseJsonPayload(response.body));
      expect(error.code).toBe("validation_failed");
    } finally {
      await app.close();
    }
  });

  // Edge: a non-integer windowDays fails z.coerce.number().int() -> 400.
  it("rejects a fractional windowDays as a validation failure", async () => {
    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=7.5",
      });

      expect(response.statusCode).toBe(400);

      const error = parseApiError(parseJsonPayload(response.body));
      expect(error.code).toBe("validation_failed");
    } finally {
      await app.close();
    }
  });

  // Edge: an archive-only corpus (no live capture) -> corpusSource "archive",
  // with signals computed from the archive posts' createdAt values.
  it("reports corpusSource archive for an archive-only corpus", async () => {
    await repository.upsertPosts(
      HOT_TAKE_TEXTS.map((text, index) => archiveOriginal(text, isoDaysAgo(index + 1))),
    );

    const app = buildServer({
      postLibraryRepository: repository,
      repetitionWindowService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=7",
      });

      expect(response.statusCode).toBe(200);

      const report = parseReport(parseJsonPayload(response.body));
      expect(report.corpusSource).toBe("archive");

      const hotTake = report.signals.find((signal) => signal.format === "hot_take");
      expect(hotTake).toBeDefined();
      expect(hotTake?.countInWindow).toBe(4);
    } finally {
      await app.close();
    }
  });

  // Coverage 7 + AC: the injected window service reads through a repository that
  // throws PostLibraryStorageError -> 500 library_storage_failed.
  it("responds 500 with library_storage_failed when the store read fails", async () => {
    const repo = failingRepository();
    const throwingService = new RepetitionWindowService(repo, fixedNow);

    const app = buildServer({
      postLibraryRepository: repo,
      repetitionWindowService: throwingService,
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/capture/cooldown?windowDays=7",
      });

      expect(response.statusCode).toBe(500);

      const error = parseApiError(parseJsonPayload(response.body));
      expect(error.code).toBe("library_storage_failed");
    } finally {
      await app.close();
    }
  });
});
