/**
 * Failing tests for the runner host swap (FND: JSON->SQLite host swap).
 *
 * RunnerApp's default service-construction path (`defaultCreateServices`) must
 * open the engine database once against `<engineSettingsDir>/storage`, run the
 * one-time JSON->SQLite importer there, and construct the SQLite-backed
 * PostLibraryRepository instead of the JSON one. The constructed bundle's
 * `postLibraryRepository` then serves the corpus from `x-builder.db`, the JSON
 * file is renamed to `.migrated`, and a subsequent corpus write lands in SQLite
 * (the JSON file is never recreated).
 *
 * These tests drive the DEFAULT createServices (the path under test) — they do
 * NOT inject `services`. They inject only the browser/page/transport/observer
 * seams (per runner-app.test.ts) so no real browser, LLM, or network is touched,
 * and they capture the bundle RunnerApp hands to `bindTransport` to inspect the
 * repository it constructed.
 *
 * The default path currently constructs a JsonFilePostLibraryRepository (no db
 * file, no rename), so the SQLite/rename assertions below fail until Green swaps
 * the host. That is the intended Red signal.
 *
 * Isolation: engineSettingsDir is always a mkdtemp tmpdir. The real ~/.x-builder
 * path is never touched.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunnerApp, type BrowserContextLike, type EngineServices } from "./runner-app";

const POST_LIBRARY_FILE = "post-library.json";
const MIGRATED_FILE = "post-library.json.migrated";
const DB_FILE = "x-builder.db";

const OVERLAY_BUNDLE_CONTENT = '(function(){"use strict";globalThis.__xbuilder_overlay=1})();';

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

const v2StoreJson = (): string =>
  `${JSON.stringify(
    {
      schemaVersion: 2,
      updatedAt: importedAt,
      posts: [canonicalPost()],
      importRuns: [],
      derivedInsights: [],
      activeContext: { status: "empty" },
      profileSnapshots: [],
    },
    null,
    2,
  )}\n`;

// A fake Playwright context+page pair (mirrors runner-app.test.ts), enough for
// start() to run launch mode without a real browser.
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
let storageDir: string;
let bundlePath: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "x-builder-runner-host-swap-"));
  // RunnerApp's defaultCreateServices builds the repo at <engineSettingsDir>/storage.
  storageDir = join(tempDir, "engine-settings", "storage");
  mkdirSync(storageDir, { recursive: true });
  bundlePath = join(tempDir, "overlay.iife.js");
  writeFileSync(bundlePath, OVERLAY_BUNDLE_CONTENT, "utf-8");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

// Start a RunnerApp through its DEFAULT createServices, capturing the service
// bundle handed to bindTransport. Every other seam is a no-op fake so no real
// browser / LLM / network runs.
const startCapturingServices = async (): Promise<EngineServices> => {
  const { context } = createFakeContext();
  let captured: EngineServices | undefined;

  const app = new RunnerApp({
    engineSettingsDir: join(tempDir, "engine-settings"),
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

  if (captured === undefined) {
    throw new Error("bindTransport never received the constructed service bundle.");
  }

  return captured;
};

describe("RunnerApp default service construction — SQLite host swap", () => {
  describe("AC10 — an existing v2 post-library.json in <storage> is migrated and served from SQLite", () => {
    it("serves the migrated corpus from a SQLite-backed postLibraryRepository (loadStore returns the migrated posts, served from x-builder.db)", async () => {
      writeFileSync(join(storageDir, POST_LIBRARY_FILE), v2StoreJson(), "utf-8");

      const services = await startCapturingServices();
      const store = await services.postLibraryRepository?.loadStore();

      // Distinguishes a SQLite-backed read from the old JSON repo (which would also
      // return these posts off post-library.json): the corpus is served from
      // x-builder.db AND the JSON has been consumed (renamed). A JSON-backed repo
      // leaves no db and never renames, so this fails until the host swap lands.
      expect(existsSync(join(storageDir, DB_FILE))).toBe(true);
      expect(existsSync(join(storageDir, POST_LIBRARY_FILE))).toBe(false);
      expect(store?.posts).toHaveLength(1);
      expect(store?.posts[0]?.platformPostId).toBe("1800000000000000001");
      expect(store?.posts[0]?.text).toBe("A compact archive post.");
    });

    it("creates <storage>/x-builder.db and renames post-library.json to .migrated", async () => {
      writeFileSync(join(storageDir, POST_LIBRARY_FILE), v2StoreJson(), "utf-8");

      await startCapturingServices();

      expect(existsSync(join(storageDir, DB_FILE))).toBe(true);
      expect(existsSync(join(storageDir, MIGRATED_FILE))).toBe(true);
      expect(existsSync(join(storageDir, POST_LIBRARY_FILE))).toBe(false);
    });

    it("lands a subsequent corpus write in x-builder.db and never recreates post-library.json", async () => {
      writeFileSync(join(storageDir, POST_LIBRARY_FILE), v2StoreJson(), "utf-8");

      const services = await startCapturingServices();

      // A new post written through the SQLite-backed repo persists in the db and
      // is visible on reload, while post-library.json stays gone.
      await services.postLibraryRepository?.upsertPosts([
        {
          ...canonicalPost(),
          id: "post-2",
          platformPostId: "1800000000000000002",
          text: "A second post written after migration.",
        },
      ]);
      const store = await services.postLibraryRepository?.loadStore();

      expect(store?.posts.map((post) => post.platformPostId).sort()).toEqual([
        "1800000000000000001",
        "1800000000000000002",
      ]);
      expect(existsSync(join(storageDir, DB_FILE))).toBe(true);
      expect(existsSync(join(storageDir, POST_LIBRARY_FILE))).toBe(false);
    });
  });
});
