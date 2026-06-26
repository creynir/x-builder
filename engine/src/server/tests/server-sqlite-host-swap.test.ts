/**
 * Failing tests for the engine host swap (FND: JSON->SQLite host swap).
 *
 * buildServer must open the engine database once at startup against a `storage`
 * directory, run the one-time JSON->SQLite importer there, and serve the corpus
 * from SqlitePostLibraryRepository instead of JsonFilePostLibraryRepository.
 *
 * Repo isolation forbids inferring the real home dir or relying on real runtime
 * state in tests, so buildServer must accept an explicit storage-root override.
 * This suite calls `buildServer({ storageRoot: <tmpdir> })`; the option does not
 * exist on BuildServerOptions yet, so the typed call below fails to compile/run
 * until Green widens BuildServerOptions and wires the open+import path. That is
 * the intended Red signal (a missing option / unwired path), not a test bug.
 *
 * Isolation: every storageRoot is a mkdtemp tmpdir. The user's real ~/.x-builder
 * storage path is never touched.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { archiveImportOverviewSchema, archivePostsPageSchema } from "@x-builder/shared";
import { describe, expect, it } from "vitest";

import { buildServer } from "../server";
import {
  postLibraryStoreSchema,
  type CanonicalOwnPost,
  type PostLibraryStore,
} from "../post-library-repository.js";

const POST_LIBRARY_FILE = "post-library.json";
const MIGRATED_FILE = "post-library.json.migrated";
const DB_FILE = "x-builder.db";

const importedAt = "2026-06-16T10:00:00.000Z";
const sourceHash = "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd";

const canonicalPost = (overrides: Partial<CanonicalOwnPost> = {}): CanonicalOwnPost => ({
  id: "post-1",
  platform: "x",
  platformPostId: "1800000000000000001",
  text: "A compact archive post.",
  createdAt: "2024-01-05T12:00:00.000Z",
  kind: "original",
  language: "en",
  replyReferences: {},
  entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
  weakMetrics: { favoriteCount: 12, retweetCount: 3 },
  metricSnapshots: [
    {
      source: "archive_tweets_js",
      observedAt: "2024-01-05T12:00:00.000Z",
      importedAt,
      favoriteCount: 12,
      retweetCount: 3,
    },
  ],
  sourceRefs: [
    { source: "archive_tweets_js", importRunId: "import-1", rawId: "1800000000000000001", sourceHash },
  ],
  updatedAt: importedAt,
  ...overrides,
});

const importRun = {
  id: "import-1",
  sourceHash,
  assignmentPath: "tweets.js",
  status: "completed" as const,
  counts: {
    totalRecords: 1,
    validPosts: 1,
    skippedRecords: 0,
    originals: 1,
    replies: 0,
    repostReferences: 0,
    insertedPosts: 1,
    updatedPosts: 0,
    unchangedPosts: 0,
  },
  duplicates: { duplicateRecords: 0, duplicatePlatformPostIds: [] },
  warnings: [],
  createdAt: importedAt,
  completedAt: importedAt,
};

const v2Store = (posts: CanonicalOwnPost[] = [canonicalPost()]): PostLibraryStore =>
  postLibraryStoreSchema.parse({
    schemaVersion: 2,
    updatedAt: importedAt,
    posts,
    importRuns: [importRun],
    derivedInsights: [],
    activeContext: { status: "empty" },
    profileSnapshots: [],
  });

// The runner lays the db out as <storageRoot>/storage/x-builder.db with the JSON
// store in the same <storageRoot>/storage dir. The engine must match that layout,
// so storageRoot is the parent of the `storage` dir.
const storageDir = (storageRoot: string): string => join(storageRoot, "storage");

const writeStoreFile = async (storageRoot: string, store: unknown): Promise<void> => {
  const dir = storageDir(storageRoot);
  await rm(dir, { recursive: true, force: true });
  await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
  await writeFile(join(dir, POST_LIBRARY_FILE), `${JSON.stringify(store, null, 2)}\n`, "utf8");
};

const withStorageRoot = async <T>(run: (storageRoot: string) => Promise<T>): Promise<T> => {
  const root = await mkdtemp(join(tmpdir(), "x-builder-engine-host-swap-"));

  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
};

const parseJsonPayload = (payload: string): unknown => JSON.parse(payload);

describe("engine host swap — buildServer opens + imports against an explicit storageRoot", () => {
  describe("AC11 — a v2 post-library.json under storageRoot is migrated and served from SQLite", () => {
    it("creates the SQLite db, renames the JSON to .migrated, and serves the migrated corpus over /archive/posts", async () => {
      await withStorageRoot(async (storageRoot) => {
        await writeStoreFile(storageRoot, v2Store());

        const app = buildServer({ storageRoot });

        try {
          // Deterministic, isolation-safe Red trigger asserted FIRST: when the
          // storageRoot override is unwired, buildServer never opens a db here, so
          // x-builder.db is absent and post-library.json stays unrenamed. These
          // file-state checks fail without depending on (or reading) the user's
          // real ~/.x-builder corpus.
          expect(await fileExists(join(storageDir(storageRoot), DB_FILE))).toBe(true);
          expect(await fileExists(join(storageDir(storageRoot), MIGRATED_FILE))).toBe(true);
          expect(await fileExists(join(storageDir(storageRoot), POST_LIBRARY_FILE))).toBe(false);

          const page = await app.inject({ method: "GET", url: "/archive/posts?limit=10" });
          const overview = await app.inject({ method: "GET", url: "/archive/imports/latest" });

          const postsPage = archivePostsPageSchema.parse(parseJsonPayload(page.body));
          const importOverview = archiveImportOverviewSchema.parse(parseJsonPayload(overview.body));

          // The corpus is served from SQLite (exactly the one migrated post).
          expect(page.statusCode).toBe(200);
          expect(postsPage.items).toHaveLength(1);
          expect(postsPage.items[0]?.platformPostId).toBe("1800000000000000001");
          expect(importOverview.status).toBe("ready");
        } finally {
          await app.close();
        }
      });
    });

    it("is a no-op on a second buildServer over the same storageRoot (no duplicate corpus)", async () => {
      await withStorageRoot(async (storageRoot) => {
        await writeStoreFile(storageRoot, v2Store());

        const first = buildServer({ storageRoot });
        await first.close();

        // A second open+import against the already-migrated dir must not duplicate.
        const second = buildServer({ storageRoot });

        try {
          // db created + JSON migrated by the FIRST buildServer; both stay so on
          // the second open. Asserted first so the Red trigger is the file state,
          // not a corpus read against the real home dir.
          expect(await fileExists(join(storageDir(storageRoot), DB_FILE))).toBe(true);
          expect(await fileExists(join(storageDir(storageRoot), MIGRATED_FILE))).toBe(true);
          expect(await fileExists(join(storageDir(storageRoot), POST_LIBRARY_FILE))).toBe(false);

          const page = await second.inject({ method: "GET", url: "/archive/posts?limit=10" });
          const postsPage = archivePostsPageSchema.parse(parseJsonPayload(page.body));

          // No duplicate corpus: exactly the one migrated post survives.
          expect(postsPage.items).toHaveLength(1);
        } finally {
          await second.close();
        }
      });
    });
  });
});
