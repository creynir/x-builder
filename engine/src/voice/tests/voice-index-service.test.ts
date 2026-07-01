import { describe, expect, it } from "vitest";

import { makeTempEngineDb, seedPosts } from "../../server/sqlite-test-helpers.js";
import { SqliteGeneratedReplyLedgerRepository } from "../../generated-replies/sqlite-generated-reply-ledger-repository.js";
import type { CanonicalOwnPost } from "../../server/post-library-repository.js";
import { createLocalHashingVoiceEmbedder, type VoiceEmbedder } from "../voice-embedder.js";
import { VoiceIndexService } from "../voice-index-service.js";

const ISO = "2026-06-29T12:00:00.000Z";

const canonicalPost = (overrides: Partial<CanonicalOwnPost> = {}): CanonicalOwnPost => ({
  id: "post-1",
  platform: "x",
  platformPostId: "platform-post-1",
  text: "Local voice sample about shipping smaller systems.",
  createdAt: "2026-06-01T00:00:00.000Z",
  kind: "original",
  language: "en",
  replyReferences: {},
  entityFlags: { hasUrls: false, hasMedia: false, hasHashtags: false, hasMentions: false },
  weakMetrics: {},
  metricSnapshots: [],
  sourceRefs: [],
  updatedAt: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

const rowCount = (db: ReturnType<typeof makeTempEngineDb>, table: string): number =>
  (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;

describe("VoiceIndexService", () => {
  it("indexes canonical original non-empty posts into the derived projection", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({ id: "original-1", platformPostId: "platform-original-1" }),
      canonicalPost({
        id: "reply-1",
        platformPostId: "platform-reply-1",
        kind: "reply",
        text: "Reply must not index.",
      }),
      canonicalPost({
        id: "blank-1",
        platformPostId: "platform-blank-1",
        text: "   ",
      }),
    ]);

    const service = new VoiceIndexService({
      db,
      embedder: createLocalHashingVoiceEmbedder(),
      now: () => ISO,
    });

    expect(service.ensureVoiceIndex()).toEqual({
      indexedCount: 1,
      deletedOrphanCount: 0,
      remainingStaleCount: 0,
    });

    const rows = db
      .prepare("SELECT post_id, embedder_id, indexed_at FROM voice_post_embedding")
      .all() as Array<{ post_id: string; embedder_id: string; indexed_at: string }>;
    expect(rows).toEqual([
      {
        post_id: "original-1",
        embedder_id: "local-hashing-voice-embedder",
        indexed_at: ISO,
      },
    ]);
  });

  it("excludes exact generated reply hashes and deletes existing generated embeddings", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({
        id: "generated",
        platformPostId: "generated-platform",
        text: "Generated reply text.",
      }),
      canonicalPost({
        id: "original",
        platformPostId: "original-platform",
        text: "Original voice sample.",
      }),
    ]);
    await new SqliteGeneratedReplyLedgerRepository(db).recordGeneratedReply({
      clientEventId: "event-1",
      bodyText: "Generated reply text.",
      writtenText: "@alice Generated reply text.",
    });

    const service = new VoiceIndexService({
      db,
      embedder: createLocalHashingVoiceEmbedder(),
      now: () => ISO,
    });

    expect(service.ensureVoiceIndex()).toMatchObject({
      indexedCount: 1,
      remainingStaleCount: 0,
    });
    expect(
      db.prepare("SELECT post_id FROM voice_post_embedding ORDER BY post_id").all(),
    ).toEqual([{ post_id: "original" }]);

    db.prepare(
      `INSERT INTO voice_post_embedding (
        post_id, platform_post_id, content_hash, post_updated_at, embedder_id,
        embedder_version, dimensions, vector_blob, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "generated",
      "generated-platform",
      "stale",
      ISO,
      "local-hashing-voice-embedder",
      "v1",
      384,
      Buffer.alloc(1536),
      ISO,
    );

    expect(service.ensureVoiceIndex()).toMatchObject({ deletedOrphanCount: 1 });
    expect(
      db.prepare("SELECT post_id FROM voice_post_embedding ORDER BY post_id").all(),
    ).toEqual([{ post_id: "original" }]);
  });

  it("refreshes stale rows when canonical content metadata changes", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost()]);
    const service = new VoiceIndexService({
      db,
      embedder: createLocalHashingVoiceEmbedder(),
      now: () => ISO,
    });
    service.ensureVoiceIndex();

    const staleHash = "stale-content-hash";
    db.prepare("UPDATE voice_post_embedding SET content_hash = ? WHERE post_id = ?").run(
      staleHash,
      "post-1",
    );

    expect(service.ensureVoiceIndex()).toMatchObject({ indexedCount: 1 });

    const row = db
      .prepare("SELECT content_hash FROM voice_post_embedding WHERE post_id = ?")
      .get("post-1") as { content_hash: string };
    expect(row.content_hash).not.toBe(staleHash);
  });

  it("bounds indexing and reports remaining stale rows", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({ id: "post-a", platformPostId: "platform-a" }),
      canonicalPost({ id: "post-b", platformPostId: "platform-b" }),
      canonicalPost({ id: "post-c", platformPostId: "platform-c" }),
    ]);

    const service = new VoiceIndexService({
      db,
      embedder: createLocalHashingVoiceEmbedder(),
      now: () => ISO,
    });

    expect(service.ensureVoiceIndex({ maxPostsPerCall: 2 })).toEqual({
      indexedCount: 2,
      deletedOrphanCount: 0,
      remainingStaleCount: 1,
    });
    expect(rowCount(db, "voice_post_embedding")).toBe(2);
  });

  it("records local embed failures while indexing other posts", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [
      canonicalPost({ id: "post-ok", platformPostId: "platform-ok", text: "index this" }),
      canonicalPost({ id: "post-fails", platformPostId: "platform-fails", text: "fail me" }),
    ]);
    const base = createLocalHashingVoiceEmbedder();
    const embedder: VoiceEmbedder = {
      ...base,
      embedText(text) {
        if (text.includes("fail me")) {
          throw new Error("test embed failure");
        }
        return base.embedText(text);
      },
    };

    const service = new VoiceIndexService({ db, embedder, now: () => ISO });

    expect(service.ensureVoiceIndex()).toEqual({
      indexedCount: 1,
      deletedOrphanCount: 0,
      remainingStaleCount: 1,
    });
    expect(rowCount(db, "voice_post_embedding")).toBe(1);

    const meta = db.prepare("SELECT last_error_at, last_error FROM voice_index_meta").get() as {
      last_error_at: string | null;
      last_error: string | null;
    };
    expect(meta.last_error_at).toBe(ISO);
    expect(meta.last_error).toContain("post-fails");
  });

  it("deletes orphan projection rows defensively", async () => {
    const db = makeTempEngineDb();
    await seedPosts(db, [canonicalPost()]);
    const service = new VoiceIndexService({
      db,
      embedder: createLocalHashingVoiceEmbedder(),
      now: () => ISO,
    });
    service.ensureVoiceIndex();

    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM post WHERE id = ?").run("post-1");
    db.pragma("foreign_keys = ON");

    expect(service.ensureVoiceIndex()).toMatchObject({ deletedOrphanCount: 1 });
    expect(rowCount(db, "voice_post_embedding")).toBe(0);
  });
});
