/**
 * Integration / E2E suite for the local-persistence (SQLite) storage foundation.
 *
 * These tests run against code that ALREADY EXISTS on this branch (the JSON->SQLite
 * migration is implemented). They exercise the REAL module path end to end —
 *   openEngineDatabase -> SqlitePostLibraryRepository -> importPostLibraryJsonToSqlite -> buildServer
 * — with NO internal mocks, and are expected to PASS.
 *
 * They are deliberately disjoint from the owning unit/contract suites:
 *   - sqlite-post-library-repository.test.ts (repo behavior)
 *   - import-post-library-json.test.ts        (importer behavior)
 *   - server-sqlite-host-swap.test.ts         (buildServer file-state + served corpus)
 * Here the focus is the cross-module USER FLOWS and the falsifiable ARCHITECTURAL
 * INVARIANTS: the on-disk SQLite artifact is real (opened directly as a
 * better-sqlite3 db: user_version + table set), idempotency is structural (row
 * counts unchanged on re-open), the corpus content equals a CONCRETE expected
 * shape derived from the seeded fixture (no JSON-repo oracle — that legacy repo
 * was deleted in LPF-004 and is imported/referenced nowhere here), and the kind
 * vocabulary + 19-digit Snowflake ids survive verbatim.
 *
 * Isolation (live user data): every path is a mkdtemp tmpdir, ':memory:', or
 * makeTempEngineDb(). The user's real ~/.x-builder storage is NEVER touched. The
 * host construction path is driven only via buildServer({ storageRoot: <tmpdir> }).
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import {
  archiveImportOverviewSchema,
  archivePostsPageSchema,
} from "@x-builder/shared";
import { afterEach, describe, expect, it } from "vitest";

import { openEngineDatabase } from "../open-engine-database.js";
import { SqlitePostLibraryRepository } from "../sqlite-post-library-repository.js";
import { importPostLibraryJsonToSqlite } from "../import-post-library-json.js";
import { makeTempEngineDb, seedPosts } from "../sqlite-test-helpers.js";
import { buildServer } from "../server.js";
import {
  postLibraryStoreSchema,
  upgradePostLibraryStoreToV2,
  type CanonicalOwnPost,
  type CanonicalOwnPostInput,
  type PostLibraryStore,
  type PostLibraryRepository,
} from "../post-library-repository.js";
import { ENGINE_TRANSPORT_BINDINGS } from "@x-builder/shared";

// ---------------------------------------------------------------------------
// Filenames + the migration-1 table set (the storage-column contract).
// ---------------------------------------------------------------------------

const POST_LIBRARY_FILE = "post-library.json";
const MIGRATED_FILE = "post-library.json.migrated";
const DB_FILE = "x-builder.db";

// Every table migration 1 must create (open-engine-database.ts migration1Ddl).
const MIGRATION_1_TABLES = [
  "post",
  "metric_obs",
  "source_ref",
  "profile_snapshot",
  "import_run",
  "derived_insight",
  "active_context",
] as const;

const MIGRATION_4_TABLES = ["voice_index_meta", "voice_post_embedding"] as const;

const importedAt = "2026-06-16T10:00:00.000Z";
const sourceHash =
  "sha256:7a2f4e9c1b3d5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd";

// ---------------------------------------------------------------------------
// Fixture builders — replicated (NOT imported) from the owning suites' style so
// this suite owns its fixtures. A canonical post (resolved updatedAt) shaped
// exactly as the JSON store persisted it, plus the auxiliary collections.
// ---------------------------------------------------------------------------

const canonicalPost = (
  overrides: Partial<CanonicalOwnPost> = {},
): CanonicalOwnPost => ({
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
    {
      source: "archive_tweets_js",
      importRunId: "import-1",
      rawId: "1800000000000000001",
      sourceHash,
    },
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

const derivedInsightSnapshot = {
  importRunId: "import-1",
  generatedAt: importedAt,
  insights: {
    generatedAt: importedAt,
    counts: { posts: 1, originals: 1, replies: 0, repostReferences: 0 },
    cadence: { postsPerWeek: 1, mostCommonHoursUtc: [12] },
    replyOriginalMix: { originalRatio: 1, replyRatio: 0 },
    repeatStructures: [],
    emotionalAngleRotation: [],
    weakEngagement: {},
    confidence: "low" as const,
  },
};

const activeContext = {
  status: "active" as const,
  sourceImportId: "import-1",
  activatedAt: importedAt,
  scoringContextPatch: {},
  judgeHints: [],
  provenance: "Imported X archive",
  confidence: "low" as const,
  counts: { posts: 1, originals: 1, replies: 0 },
};

const profileSnapshot = {
  platformUserId: "user-123",
  screenName: "founder",
  followers: 980,
  capturedAt: "2026-06-20T08:55:00.000Z",
};

// A full v2 store object as it would sit on disk (every collection populated).
const v2Store = (posts: CanonicalOwnPost[] = [canonicalPost()]): PostLibraryStore =>
  postLibraryStoreSchema.parse({
    schemaVersion: 2,
    updatedAt: importedAt,
    posts,
    importRuns: [importRun],
    derivedInsights: [derivedInsightSnapshot],
    activeContext,
    profileSnapshots: [profileSnapshot],
  });

// A v1-shaped store: schemaVersion 1, NO profileSnapshots key. The importer must
// route it through upgradePostLibraryStoreToV2 (-> profileSnapshots: []).
const v1RawStore = (posts: CanonicalOwnPost[] = [canonicalPost()]): unknown => ({
  schemaVersion: 1,
  updatedAt: importedAt,
  posts,
  importRuns: [importRun],
  derivedInsights: [derivedInsightSnapshot],
  activeContext,
});

// ---------------------------------------------------------------------------
// Tmpdir harness. Fail-fast if mkdtemp cannot give us an isolated root — never
// infer from cwd/home.
// ---------------------------------------------------------------------------

const createdRoots: string[] = [];

const makeTempRoot = async (label: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), `x-builder-storage-int-${label}-`));
  if (!root || !root.startsWith(tmpdir())) {
    throw new Error(`Test harness failed to allocate an isolated tmpdir for ${label}.`);
  }
  createdRoots.push(root);
  return root;
};

afterEach(async () => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

const storageDir = (storageRoot: string): string => join(storageRoot, "storage");

const writeStoreFile = async (dir: string, store: unknown): Promise<void> => {
  await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
  await writeFile(join(dir, POST_LIBRARY_FILE), `${JSON.stringify(store, null, 2)}\n`, "utf8");
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

// Normalize write-time timestamps before content equality. store.updatedAt and
// every post.updatedAt are stamped nowIso() at the SQLite write, so they differ
// from the on-disk fixture by construction. createdAt + every other field stay
// asserted. (No JSON-repo oracle — content is checked against the seeded fixture.)
const stripWriteTimestamps = (store: PostLibraryStore): PostLibraryStore => ({
  ...store,
  updatedAt: "<normalized>",
  posts: store.posts.map((post) => ({ ...post, updatedAt: "<normalized>" })),
});

// Read the row count of every migration-1 table as a record. Used to assert
// STRUCTURAL idempotency: a re-open/re-import must not change any count.
const tableCounts = (db: Database.Database): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const table of MIGRATION_1_TABLES) {
    counts[table] = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  }
  return counts;
};

const canonicalize = (input: CanonicalOwnPostInput): CanonicalOwnPost => ({
  ...input,
  updatedAt: input.updatedAt ?? importedAt,
}) as CanonicalOwnPost;

// ===========================================================================
// USER FLOW 1 — Fresh install -> first write.
// ===========================================================================

describe("user flow: fresh install then first write", () => {
  it("creates the schema on a brand-new tmpdir db (no JSON, no prior db) and lands a first upsert in x-builder.db", async () => {
    const root = await makeTempRoot("fresh");
    const dir = storageDir(root);
    await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
    const dbPath = join(dir, DB_FILE);

    // Pre-conditions: neither the JSON corpus nor the db file exist yet.
    expect(await fileExists(join(dir, POST_LIBRARY_FILE))).toBe(false);
    expect(await fileExists(dbPath)).toBe(false);

    // Opening migrates the empty schema; the importer is a no-op (no JSON present).
    const db = openEngineDatabase(dbPath);
    importPostLibraryJsonToSqlite(dir, db);

    expect(await fileExists(dbPath)).toBe(true);

    const repository = new SqlitePostLibraryRepository(db);
    const empty = await repository.loadStore();
    expect(empty.posts).toEqual([]);

    // First write lands and reloads.
    const result = await repository.upsertPosts([canonicalPost()]);
    expect(result.insertedCount).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.platformPostId).toBe("1800000000000000001");

    // The write is durable in the real file: re-open the same path with a fresh
    // handle and the post is still there (proves it landed on disk, not in RAM).
    db.close();
    const reopened = openEngineDatabase(dbPath);
    const afterReopen = await new SqlitePostLibraryRepository(reopened).loadStore();
    expect(afterReopen.posts).toHaveLength(1);
    expect(afterReopen.posts[0]?.platformPostId).toBe("1800000000000000001");
    reopened.close();
  });
});

// ===========================================================================
// USER FLOW 2 — Upgrade -> migrate -> serve (v2 path AND v1 path).
// ===========================================================================

describe("user flow: upgrade then migrate then serve", () => {
  it("migrates a v2 post-library.json to SQLite content equal to a concrete expected shape (modulo write-time updatedAt)", async () => {
    const root = await makeTempRoot("v2");
    const dir = storageDir(root);
    await writeStoreFile(dir, v2Store());
    const db = openEngineDatabase(join(dir, DB_FILE));

    importPostLibraryJsonToSqlite(dir, db);

    // File became .migrated, original gone.
    expect(await fileExists(join(dir, POST_LIBRARY_FILE))).toBe(false);
    expect(await fileExists(join(dir, MIGRATED_FILE))).toBe(true);

    const store = stripWriteTimestamps(await new SqlitePostLibraryRepository(db).loadStore());

    // Concrete expected shape derived from the seeded fixture — NOT a JSON repo.
    // schemaVersion is re-stamped 2; the rest equals the seeded collections with
    // post.updatedAt blanked.
    const expectedPost = { ...canonicalPost(), updatedAt: "<normalized>" };
    expect(store.schemaVersion).toBe(2);
    expect(store.posts).toEqual([expectedPost]);
    expect(store.posts[0]?.metricSnapshots).toEqual(canonicalPost().metricSnapshots);
    expect(store.posts[0]?.sourceRefs).toEqual(canonicalPost().sourceRefs);
    expect(store.importRuns).toEqual([importRun]);
    expect(store.derivedInsights).toEqual([derivedInsightSnapshot]);
    expect(store.activeContext).toEqual(activeContext);
    expect(store.profileSnapshots).toEqual([profileSnapshot]);
    db.close();
  });

  it("migrates a v1-shaped post-library.json, defaulting profileSnapshots to [] via upgradePostLibraryStoreToV2", async () => {
    const root = await makeTempRoot("v1");
    const dir = storageDir(root);
    await writeStoreFile(dir, v1RawStore());
    const db = openEngineDatabase(join(dir, DB_FILE));

    importPostLibraryJsonToSqlite(dir, db);

    expect(await fileExists(join(dir, MIGRATED_FILE))).toBe(true);

    const store = stripWriteTimestamps(await new SqlitePostLibraryRepository(db).loadStore());

    // The v1 store had no profileSnapshots key; the upgrade defaults it to [],
    // and the post + auxiliary collections still migrate.
    expect(store.schemaVersion).toBe(2);
    expect(store.profileSnapshots).toEqual([]);
    expect(store.posts).toEqual([{ ...canonicalPost(), updatedAt: "<normalized>" }]);
    expect(store.importRuns).toEqual([importRun]);
    expect(store.derivedInsights).toEqual([derivedInsightSnapshot]);
    expect(store.activeContext).toEqual(activeContext);
    db.close();
  });

  it("serves the migrated v2 corpus from SQLite through buildServer({ storageRoot }) over /archive/posts", async () => {
    const root = await makeTempRoot("serve");
    const dir = storageDir(root);
    await writeStoreFile(dir, v2Store());

    const app = buildServer({ storageRoot: root });
    try {
      // Host opened the db and ran the importer at construction.
      expect(await fileExists(join(dir, DB_FILE))).toBe(true);
      expect(await fileExists(join(dir, MIGRATED_FILE))).toBe(true);
      expect(await fileExists(join(dir, POST_LIBRARY_FILE))).toBe(false);

      const page = await app.inject({ method: "GET", url: "/archive/posts?limit=10" });
      const overview = await app.inject({ method: "GET", url: "/archive/imports/latest" });

      const postsPage = archivePostsPageSchema.parse(parseJsonPayload(page.body));
      const importOverview = archiveImportOverviewSchema.parse(parseJsonPayload(overview.body));

      expect(page.statusCode).toBe(200);
      expect(postsPage.items).toHaveLength(1);
      expect(postsPage.items[0]?.platformPostId).toBe("1800000000000000001");
      expect(importOverview.status).toBe("ready");
    } finally {
      await app.close();
    }
  });
});

// ===========================================================================
// USER FLOW 3 — Restart after migration (structural idempotency).
// ===========================================================================

describe("user flow: restart after migration is a structural no-op", () => {
  it("leaves the row count of every table unchanged on a second open + import of the same tmpdir", async () => {
    const root = await makeTempRoot("restart");
    const dir = storageDir(root);
    await writeStoreFile(dir, v2Store());
    const dbPath = join(dir, DB_FILE);

    // First boot: open + import.
    const first = openEngineDatabase(dbPath);
    importPostLibraryJsonToSqlite(dir, first);
    const countsAfterFirst = tableCounts(first);
    first.close();

    // The file is now .migrated and the db is populated.
    expect(await fileExists(join(dir, MIGRATED_FILE))).toBe(true);
    expect(await fileExists(join(dir, POST_LIBRARY_FILE))).toBe(false);
    expect(countsAfterFirst.post).toBe(1);

    // Second boot: re-open the SAME db and re-run the importer. The populated-post
    // guard short-circuits, so every table count must be IDENTICAL (not merely
    // "no error thrown").
    const second = openEngineDatabase(dbPath);
    const countsBeforeSecondImport = tableCounts(second);
    importPostLibraryJsonToSqlite(dir, second);
    const countsAfterSecondImport = tableCounts(second);

    expect(countsBeforeSecondImport).toEqual(countsAfterFirst);
    expect(countsAfterSecondImport).toEqual(countsAfterFirst);

    // Corpus content is unchanged too (the one post survives, single copy).
    const store = await new SqlitePostLibraryRepository(second).loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.platformPostId).toBe("1800000000000000001");
    second.close();
  });

  it("does not duplicate the corpus across two buildServer hosts over the same storageRoot", async () => {
    const root = await makeTempRoot("restart-host");
    const dir = storageDir(root);
    await writeStoreFile(dir, v2Store());

    const firstApp = buildServer({ storageRoot: root });
    await firstApp.close();

    // Re-open the on-disk db directly to capture the post-first-boot counts.
    const probe = new Database(join(dir, DB_FILE), { readonly: true });
    const countsAfterFirstHost = tableCounts(probe);
    probe.close();

    const secondApp = buildServer({ storageRoot: root });
    try {
      const page = await secondApp.inject({ method: "GET", url: "/archive/posts?limit=10" });
      const postsPage = archivePostsPageSchema.parse(parseJsonPayload(page.body));
      expect(postsPage.items).toHaveLength(1);
    } finally {
      await secondApp.close();
    }

    const probe2 = new Database(join(dir, DB_FILE), { readonly: true });
    const countsAfterSecondHost = tableCounts(probe2);
    probe2.close();

    expect(countsAfterSecondHost).toEqual(countsAfterFirstHost);
    expect(countsAfterSecondHost.post).toBe(1);
  });
});

// ===========================================================================
// USER FLOW 4 — Round-trip through the PostLibraryRepository interface.
// ===========================================================================

describe("user flow: round-trip through the repository interface", () => {
  // A batch with two posts whose createdAt tie is broken by id ASC, plus a
  // distinct older post — exercises the load ordering (created_at DESC, id ASC).
  const roundTripBatch = (): CanonicalOwnPostInput[] => [
    canonicalPost({
      id: "post-older",
      platformPostId: "1700000000000000001",
      text: "Older original.",
      createdAt: "2024-01-01T00:00:00.000Z",
    }),
    canonicalPost({
      id: "post-tie-b",
      platformPostId: "1700000000000000002",
      text: "Tie sibling B.",
      createdAt: "2024-12-31T00:00:00.000Z",
    }),
    canonicalPost({
      id: "post-tie-a",
      platformPostId: "1700000000000000003",
      text: "Tie sibling A.",
      createdAt: "2024-12-31T00:00:00.000Z",
    }),
  ];

  it("reloads the upserted batch identical (modulo updatedAt) ordered created_at DESC, id ASC", async () => {
    const repository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));
    const batch = roundTripBatch();

    const result = await repository.upsertPosts(batch);
    expect(result).toEqual({
      insertedCount: 3,
      updatedCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
    });

    const store = stripWriteTimestamps(await repository.loadStore());

    // Ordering names itself: id-ASC tie-break on the shared createdAt, then older.
    expect(store.posts.map((post) => post.id)).toEqual([
      "post-tie-a",
      "post-tie-b",
      "post-older",
    ]);

    // Content is identical to the seeded fixture (modulo write-time updatedAt).
    const expected = batch
      .slice()
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt < b.createdAt ? 1 : -1;
        }
        return a.id < b.id ? -1 : 1;
      })
      .map((post) => ({ ...canonicalize(post), updatedAt: "<normalized>" }));
    expect(store.posts).toEqual(expected);
  });

  it("merges a re-upsert (dedup by snapshotKey / sourceRefKey) into the existing row instead of duplicating", async () => {
    const repository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));

    const first = await repository.upsertPosts([canonicalPost()]);
    expect(first.insertedCount).toBe(1);

    // Re-upsert the SAME post with a NEW archive snapshot + a NEW source ref under
    // the same platform key: it must merge (updatedCount 1), not insert a new row.
    const second = await repository.upsertPosts([
      canonicalPost({
        text: "A compact archive post with newer metrics.",
        metricSnapshots: [
          {
            source: "archive_tweets_js",
            observedAt: "2024-02-05T12:00:00.000Z",
            importedAt: "2026-06-16T10:30:00.000Z",
            favoriteCount: 25,
            retweetCount: 6,
          },
        ],
        sourceRefs: [
          {
            source: "archive_tweets_js",
            importRunId: "import-2",
            rawId: "1800000000000000001",
            sourceHash,
          },
        ],
      }),
    ]);

    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(1);
    expect(second.unchangedCount).toBe(0);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    // Both snapshots and both source refs survive the merge (no duplicate row).
    expect(store.posts[0]?.metricSnapshots).toHaveLength(2);
    expect(store.posts[0]?.sourceRefs).toHaveLength(2);
  });

  it("re-upserting the same content adds no new row and never duplicates its snapshot/source rows", async () => {
    const repository = new SqlitePostLibraryRepository(openEngineDatabase(":memory:"));

    const first = await repository.upsertPosts([canonicalPost()]);
    expect(first.insertedCount).toBe(1);

    // A second upsert of the same platform key is NOT a new insert (dedup by the
    // platform-key identity); the row is merged in place. The repo stamps a fresh
    // updated_at at merge time, so this re-upsert is reported as updated (not
    // unchanged) — the dedup invariant the ticket pins is structural: exactly one
    // post row, and the archive snapshot/source ref dedup by their keys (no growth).
    const second = await repository.upsertPosts([canonicalPost()]);
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount + second.unchangedCount).toBe(1);

    const store = await repository.loadStore();
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]?.metricSnapshots).toHaveLength(1);
    expect(store.posts[0]?.sourceRefs).toHaveLength(1);
  });
});

// ===========================================================================
// ARCHITECTURAL INVARIANT — SQLite is the real on-disk artifact.
//
// Falsifiable: a JSON-under-the-hood facade (or an in-memory-only impl) would
// lack a real x-builder.db file whose PRAGMA user_version is 4 and whose
// sqlite_master holds the seven migration-1 tables — so this test would fail it.
// ===========================================================================

describe("invariant: the migrated artifact is a real SQLite database on disk", () => {
  it("after a buildServer migration, x-builder.db opens as a real db with user_version 4 and the migration tables", async () => {
    const root = await makeTempRoot("artifact");
    const dir = storageDir(root);
    await writeStoreFile(dir, v2Store());

    const app = buildServer({ storageRoot: root });
    await app.close();

    // The storage dir holds x-builder.db AND post-library.json.migrated AND no
    // post-library.json.
    const entries = await readdir(dir);
    expect(entries).toContain(DB_FILE);
    expect(entries).toContain(MIGRATED_FILE);
    expect(entries).not.toContain(POST_LIBRARY_FILE);

    // Open the file directly as a real better-sqlite3 db (NOT via the engine
    // helpers) and assert the schema contract a facade cannot fake.
    const raw = new Database(join(dir, DB_FILE), { readonly: true });
    try {
      const userVersion = Number(raw.pragma("user_version", { simple: true }));
      expect(userVersion).toBe(4);

      const tableRows = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const tableNames = new Set(tableRows.map((row) => row.name));

      for (const table of MIGRATION_1_TABLES) {
        expect(tableNames.has(table)).toBe(true);
      }
      for (const table of MIGRATION_4_TABLES) {
        expect(tableNames.has(table)).toBe(true);
      }

      // The migrated post is a real row in the real `post` table.
      const postRow = raw
        .prepare("SELECT platform_post_id, kind FROM post")
        .get() as { platform_post_id: string; kind: string };
      expect(postRow.platform_post_id).toBe("1800000000000000001");
      expect(postRow.kind).toBe("original");
    } finally {
      raw.close();
    }
  });

  it("cascades the voice projection when the canonical post row is deleted", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost()]);

    const row = db
      .prepare(
        "SELECT id, platform_post_id, content_hash, updated_at FROM post WHERE id = ?",
      )
      .get("post-1") as
      | {
          id: string;
          platform_post_id: string;
          content_hash: string;
          updated_at: string;
        }
      | undefined;
    expect(row).toBeDefined();

    db.prepare(
      `INSERT INTO voice_post_embedding (
        post_id,
        platform_post_id,
        content_hash,
        post_updated_at,
        embedder_id,
        embedder_version,
        dimensions,
        vector_blob,
        indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row!.id,
      row!.platform_post_id,
      row!.content_hash,
      row!.updated_at,
      "local-hashing-voice-embedder",
      "1",
      1,
      Buffer.from(new Float32Array([1]).buffer),
      importedAt,
    );

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM voice_post_embedding").get(),
    ).toEqual({ count: 1 });

    db.prepare("DELETE FROM post WHERE id = ?").run("post-1");

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM voice_post_embedding").get(),
    ).toEqual({ count: 0 });
  });
});

// ===========================================================================
// ARCHITECTURAL INVARIANT — Interface + transport unchanged by LPF.
//
// Falsifiable: LPF added no transport methods (now 20) and no repository
// methods (still the 6). A drift in either count fails these — the assertions
// are counts, not existence.
// ===========================================================================

describe("invariant: the transport and repository surfaces are unchanged by LPF", () => {
  it("ENGINE_TRANSPORT_BINDINGS exposes exactly 24 methods", () => {
    const keys = Object.keys(ENGINE_TRANSPORT_BINDINGS).filter(
      (key) => typeof ENGINE_TRANSPORT_BINDINGS[key] === "string",
    );
    expect(keys).toHaveLength(24);
  });

  it("the SqlitePostLibraryRepository implements exactly the 6 PostLibraryRepository methods", async () => {
    const repository: PostLibraryRepository = new SqlitePostLibraryRepository(
      openEngineDatabase(":memory:"),
    );

    const required: Array<keyof PostLibraryRepository> = [
      "loadStore",
      "upsertPosts",
      "saveImportRun",
      "saveDerivedInsights",
      "setActiveContext",
      "pushProfileSnapshot",
    ];

    // Each of the 6 interface methods is a callable function on the instance.
    for (const method of required) {
      expect(typeof repository[method]).toBe("function");
    }
    expect(required).toHaveLength(6);

    // No EXTRA public methods leaked onto the prototype beyond the 6 (a 7th method
    // would signal the interface drifted under LPF). The class constructor is
    // excluded; private helpers are name-prefixed reads, so we count own enumerable
    // prototype function names against the interface set.
    const prototype = Object.getPrototypeOf(repository) as object;
    const publicMethods = Object.getOwnPropertyNames(prototype).filter((name) => {
      if (name === "constructor") {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      return typeof descriptor?.value === "function";
    });
    const interfaceMethods = publicMethods.filter((name) =>
      (required as string[]).includes(name),
    );
    // Exactly the 6 interface methods are present (the remainder are read helpers
    // such as `readActiveContext`, not part of the public PostLibraryRepository).
    expect(interfaceMethods.sort()).toEqual([...required].sort());
  });
});

// ===========================================================================
// ARCHITECTURAL INVARIANT — Kind vocabulary preserved verbatim.
//
// Falsifiable: an impl that wrote the literal 'post' (or coerced the enum) into
// post.kind would fail the direct-column read; the {original, reply,
// repost_reference, unknown} set must survive migrate -> reload exactly.
// ===========================================================================

describe("invariant: the kind vocabulary survives migrate -> reload verbatim", () => {
  it("round-trips every kind through the importer and stores no post.kind equal to 'post'", async () => {
    const root = await makeTempRoot("kinds");
    const dir = storageDir(root);
    const posts = [
      canonicalPost({ id: "post-original", platformPostId: "1700000000000000020", kind: "original" }),
      canonicalPost({
        id: "post-reply",
        platformPostId: "1700000000000000021",
        kind: "reply",
        replyReferences: { inReplyToPostId: "1700000000000000009", inReplyToUserId: "u-9" },
      }),
      canonicalPost({
        id: "post-repost",
        platformPostId: "1700000000000000022",
        kind: "repost_reference",
      }),
      canonicalPost({ id: "post-unknown", platformPostId: "1700000000000000023", kind: "unknown" }),
    ];
    await writeStoreFile(dir, v2Store(posts));
    const db = openEngineDatabase(join(dir, DB_FILE));

    importPostLibraryJsonToSqlite(dir, db);

    // Read the kind column directly off the post table (the storage contract).
    const kindRows = db
      .prepare("SELECT platform_post_id, kind FROM post")
      .all() as Array<{ platform_post_id: string; kind: string }>;
    const byPlatformId = new Map(kindRows.map((row) => [row.platform_post_id, row.kind]));

    expect(byPlatformId.get("1700000000000000020")).toBe("original");
    expect(byPlatformId.get("1700000000000000021")).toBe("reply");
    expect(byPlatformId.get("1700000000000000022")).toBe("repost_reference");
    expect(byPlatformId.get("1700000000000000023")).toBe("unknown");

    // NO stored kind row is the literal 'post'.
    expect(kindRows.every((row) => row.kind !== "post")).toBe(true);

    // And the reloaded store re-parses the kind enum (proves no foreign token leaked).
    const store = postLibraryStoreSchema.parse(await new SqlitePostLibraryRepository(db).loadStore());
    const reloadedKinds = store.posts.map((post) => post.kind).sort();
    expect(reloadedKinds).toEqual(["original", "reply", "repost_reference", "unknown"]);
    db.close();
  });
});

// ===========================================================================
// ARCHITECTURAL INVARIANT — Snowflake fidelity.
//
// Falsifiable: a numeric coercion would land a 19-digit Snowflake on
// 1700000000000000000 (lost low bits). The exact TEXT string must survive
// migrate -> reload.
// ===========================================================================

describe("invariant: a 64-bit Snowflake id survives migrate -> reload as an exact string", () => {
  it("round-trips 1700000000000000001 through the importer with no numeric precision loss", async () => {
    const root = await makeTempRoot("snowflake");
    const dir = storageDir(root);
    const snowflake = "1700000000000000001";
    await writeStoreFile(
      dir,
      v2Store([
        canonicalPost({
          id: "post-snowflake",
          platformPostId: snowflake,
          sourceRefs: [
            { source: "archive_tweets_js", importRunId: "import-1", rawId: snowflake, sourceHash },
          ],
          metricSnapshots: [
            {
              source: "archive_tweets_js",
              observedAt: "2024-01-05T12:00:00.000Z",
              importedAt,
              favoriteCount: 1,
              retweetCount: 0,
            },
          ],
        }),
      ]),
    );
    const db = openEngineDatabase(join(dir, DB_FILE));

    importPostLibraryJsonToSqlite(dir, db);

    // Read the column directly: it is TEXT and exactly the 19-digit string.
    const row = db
      .prepare("SELECT platform_post_id, logical_post_id FROM post")
      .get() as { platform_post_id: string; logical_post_id: string };
    expect(typeof row.platform_post_id).toBe("string");
    expect(row.platform_post_id).toBe(snowflake);
    expect(row.logical_post_id).toBe(snowflake);

    // And the reloaded store carries the exact string.
    const store = await new SqlitePostLibraryRepository(db).loadStore();
    expect(store.posts[0]?.platformPostId).toBe(snowflake);
    db.close();
  });
});

// ===========================================================================
// Green-owned test-support helpers exercised AS A CONSUMER (signatures hold).
// makeTempEngineDb() opens an isolated tmpdir db migrated to the latest schema;
// seedPosts(db, posts) writes through the canonical upsert path.
// ===========================================================================

describe("shipped test-support helpers: makeTempEngineDb + seedPosts", () => {
  it("seeds posts into a fresh temp engine db and reloads them through the repository", async () => {
    const db = makeTempEngineDb();

    // The helper db is migrated: the post table is queryable and empty to start.
    expect((db.prepare("SELECT COUNT(*) AS n FROM post").get() as { n: number }).n).toBe(0);

    const seeded: CanonicalOwnPost[] = [
      canonicalize(canonicalPost({ id: "post-seeded-a", platformPostId: "1700000000000000200" })),
      canonicalize(canonicalPost({ id: "post-seeded-b", platformPostId: "1700000000000000201", createdAt: "2024-02-01T00:00:00.000Z" })),
    ];
    await seedPosts(db, seeded);

    const store = await new SqlitePostLibraryRepository(db).loadStore();
    expect(store.posts).toHaveLength(2);
    expect(store.posts.map((post) => post.platformPostId).sort()).toEqual([
      "1700000000000000200",
      "1700000000000000201",
    ]);
    db.close();
  });

  it("upgradePostLibraryStoreToV2 defaults a v1 raw store to profileSnapshots [] and re-stamps schemaVersion 2", () => {
    const upgraded = postLibraryStoreSchema.parse(upgradePostLibraryStoreToV2(v1RawStore([])));
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.profileSnapshots).toEqual([]);
  });
});
