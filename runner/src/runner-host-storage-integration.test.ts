/**
 * Integration suite for the runner host-construction path against the SQLite
 * storage foundation (code that ALREADY exists on this branch; expected to PASS).
 *
 * RunnerApp's default `defaultCreateServices({ engineSettingsDir })` opens the
 * engine database at `<engineSettingsDir>/storage/x-builder.db`, runs the one-time
 * JSON->SQLite importer there, and serves the corpus from SQLite. The existing
 * runner-app-sqlite-host-swap.test.ts pins the behavioral surface (served corpus,
 * rename, subsequent write). This suite is disjoint: it verifies the falsifiable
 * ARCHITECTURAL INVARIANTS at the runner host boundary —
 *   - the migrated artifact is a REAL on-disk SQLite db (re-opened via the engine's
 *     exported openEngineDatabase: PRAGMA user_version === 7 + the migration-1
 *     table set; a JSON-under-the-hood facade has no such file to re-open), and
 *   - idempotency is STRUCTURAL (row counts in every table unchanged across two
 *     RunnerApp constructions over the same engineSettingsDir).
 *
 * It re-opens the runner-produced db through `@x-builder/engine`'s
 * `openEngineDatabase` rather than importing `better-sqlite3` directly — that
 * native dep lives only in the engine package, and the engine handle exposes the
 * same `prepare`/`pragma` surface the assertions need.
 *
 * Isolation: engineSettingsDir is always a mkdtemp tmpdir. The real ~/.x-builder
 * path is never touched. Every browser/transport/observer seam is a no-op fake,
 * so no real browser, LLM, or network runs.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openEngineDatabase } from "@x-builder/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunnerApp, type BrowserContextLike, type EngineServices } from "./runner-app.js";

const POST_LIBRARY_FILE = "post-library.json";
const MIGRATED_FILE = "post-library.json.migrated";
const DB_FILE = "x-builder.db";

const OVERLAY_BUNDLE_CONTENT = '(function(){"use strict";globalThis.__xbuilder_overlay=1})();';

const MIGRATION_1_TABLES = [
  "post",
  "metric_obs",
  "source_ref",
  "profile_snapshot",
  "import_run",
  "derived_insight",
  "active_context",
] as const;

const MIGRATION_5_TABLES = [
  "archive_voice_profile",
  "archive_voice_profile_evidence",
] as const;
const MIGRATION_6_TABLES = ["observed_thread_post"] as const;
const MIGRATION_7_TABLES = ["observed_thread_post_source"] as const;

const importedAt = "2026-06-16T10:00:00.000Z";
const sourceHash = "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd";

const canonicalPost = () => ({
  id: "post-1",
  platform: "x" as const,
  platformPostId: "1800000000000000001",
  text: "A compact archive post.",
  createdAt: "2024-01-05T12:00:00.000Z",
  kind: "original" as const,
  language: "en",
  replyReferences: {},
  entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
  weakMetrics: { favoriteCount: 12, retweetCount: 3 },
  metricSnapshots: [
    {
      source: "archive_tweets_js" as const,
      observedAt: "2024-01-05T12:00:00.000Z",
      importedAt,
      favoriteCount: 12,
      retweetCount: 3,
    },
  ],
  sourceRefs: [
    {
      source: "archive_tweets_js" as const,
      importRunId: "import-1",
      rawId: "1800000000000000001",
      sourceHash,
    },
  ],
  updatedAt: importedAt,
});

const profileSnapshot = {
  platformUserId: "user-123",
  screenName: "founder",
  followers: 980,
  capturedAt: "2026-06-20T08:55:00.000Z",
};

// A v2 store with a populated post AND a profile snapshot, so multiple migration-1
// tables get rows — making the structural-idempotency count comparison meaningful
// across more than one table.
const v2StoreJson = (): string =>
  `${JSON.stringify(
    {
      schemaVersion: 2,
      updatedAt: importedAt,
      posts: [canonicalPost()],
      importRuns: [],
      derivedInsights: [],
      activeContext: { status: "empty" },
      profileSnapshots: [profileSnapshot],
    },
    null,
    2,
  )}\n`;

// A fake Playwright context+page pair (mirrors runner-app-sqlite-host-swap.test.ts),
// enough for start() to run launch mode without a real browser.
function createFakeContext() {
  const page = { goto: vi.fn(async () => undefined), label: "page" };
  const context: BrowserContextLike = {
    addInitScript: vi.fn(async () => undefined),
    pages: () => [page],
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };

  return { context, page };
}

let tempDir: string;
let engineSettingsDir: string;
let storageDir: string;
let bundlePath: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "x-builder-runner-host-int-"));
  if (!tempDir.startsWith(tmpdir())) {
    throw new Error("Test harness failed to allocate an isolated tmpdir.");
  }
  engineSettingsDir = join(tempDir, "engine-settings");
  // defaultCreateServices builds the repo at <engineSettingsDir>/storage.
  storageDir = join(engineSettingsDir, "storage");
  mkdirSync(storageDir, { recursive: true });
  bundlePath = join(tempDir, "overlay.iife.js");
  writeFileSync(bundlePath, OVERLAY_BUNDLE_CONTENT, "utf-8");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

// Start a RunnerApp through its DEFAULT createServices (the path under test),
// capturing the service bundle handed to bindTransport. Every other seam is a
// no-op fake so no real browser / LLM / network runs.
const startCapturingServices = async (): Promise<EngineServices> => {
  const { context } = createFakeContext();
  let captured: EngineServices | undefined;

  const app = new RunnerApp({
    engineSettingsDir,
    browserProfileDir: join(tempDir, "browser-profile"),
    overlayBundlePath: bundlePath,
    // No `services` and no `createServices`: the production defaultCreateServices
    // (the path under test) builds the bundle.
    launchBrowser: vi.fn(async () => context),
    bindTransport: vi.fn((_page: unknown, services: EngineServices) => {
      captured = services;
    }),
    attachObserver: vi.fn(),
    bootstrapOverlay: vi.fn(),
  });

  await app.start();
  await app.stop();

  if (captured === undefined) {
    throw new Error("bindTransport never received the constructed service bundle.");
  }

  return captured;
};

// Read the row count of every migration-1 and archive voice table off a freshly re-opened engine
// db handle. Re-opening (rather than reusing the runner's handle) proves the
// counts are durable on disk.
const tableCountsAt = (dbPath: string): Record<string, number> => {
  const db = openEngineDatabase(dbPath);
  try {
    const counts: Record<string, number> = {};
    for (const table of [
      ...MIGRATION_1_TABLES,
      ...MIGRATION_5_TABLES,
      ...MIGRATION_6_TABLES,
      ...MIGRATION_7_TABLES,
    ]) {
      counts[table] = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      ).n;
    }
    return counts;
  } finally {
    db.close();
  }
};

describe("runner host construction: the migrated artifact is a real on-disk SQLite db", () => {
  it("produces an x-builder.db that re-opens with user_version 7 and the migration tables, with the JSON renamed", async () => {
    writeFileSync(join(storageDir, POST_LIBRARY_FILE), v2StoreJson(), "utf-8");

    await startCapturingServices();

    const dbPath = join(storageDir, DB_FILE);

    // Re-open the runner-produced db through the engine's exported opener (its own
    // better-sqlite3). A JSON-under-the-hood facade leaves no such file/tables.
    const db = openEngineDatabase(dbPath);
    try {
      const userVersion = Number(db.pragma("user_version", { simple: true }));
      expect(userVersion).toBe(7);

      const tableRows = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const tableNames = new Set(tableRows.map((row) => row.name));
      for (const table of MIGRATION_1_TABLES) {
        expect(tableNames.has(table)).toBe(true);
      }
      for (const table of MIGRATION_5_TABLES) {
        expect(tableNames.has(table)).toBe(true);
      }
      for (const table of MIGRATION_6_TABLES) {
        expect(tableNames.has(table)).toBe(true);
      }
      for (const table of MIGRATION_7_TABLES) {
        expect(tableNames.has(table)).toBe(true);
      }

      // The migrated post is a real row in the real `post` table (read directly).
      const row = db
        .prepare("SELECT platform_post_id, kind FROM post")
        .get() as { platform_post_id: string; kind: string };
      expect(row.platform_post_id).toBe("1800000000000000001");
      expect(row.kind).toBe("original");
      expect(row.kind).not.toBe("post");
    } finally {
      db.close();
    }

    // File-state contract at the runner host boundary.
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(storageDir, MIGRATED_FILE))).toBe(true);
    expect(existsSync(join(storageDir, POST_LIBRARY_FILE))).toBe(false);
  });
});

describe("runner host construction: a second construction over the same dir is a structural no-op", () => {
  it("leaves the row count of every table unchanged across two RunnerApp constructions", async () => {
    writeFileSync(join(storageDir, POST_LIBRARY_FILE), v2StoreJson(), "utf-8");

    // First construction migrates the JSON into SQLite.
    await startCapturingServices();
    const dbPath = join(storageDir, DB_FILE);
    const countsAfterFirst = tableCountsAt(dbPath);

    // The migration moved the post and the profile snapshot into their tables.
    expect(countsAfterFirst.post).toBe(1);
    expect(countsAfterFirst.profile_snapshot).toBe(1);

    // Second construction over the SAME engineSettingsDir: the populated-post guard
    // short-circuits the importer, so every table count must be IDENTICAL.
    const services = await startCapturingServices();
    const countsAfterSecond = tableCountsAt(dbPath);

    expect(countsAfterSecond).toEqual(countsAfterFirst);

    // The served corpus is still exactly the one migrated post (no duplication).
    const store = await services.postLibraryRepository?.loadStore();
    expect(store?.posts).toHaveLength(1);
    expect(store?.posts[0]?.platformPostId).toBe("1800000000000000001");
    expect(store?.profileSnapshots).toHaveLength(1);
  });
});
