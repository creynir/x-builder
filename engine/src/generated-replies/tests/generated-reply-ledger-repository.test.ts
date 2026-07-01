import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { migrations, openEngineDatabase } from "../../server/open-engine-database.js";
import { makeTempEngineDb } from "../../server/sqlite-test-helpers.js";
import {
  generatedReplyContentHash,
  normalizeGeneratedReplyText,
} from "../normalize-generated-reply.js";
import { SqliteGeneratedReplyLedgerRepository } from "../sqlite-generated-reply-ledger-repository.js";

describe("generated reply normalizer", () => {
  it("uses NFKC plus whitespace collapse and trim before hashing", () => {
    expect(normalizeGeneratedReplyText("  Ship\u00a0the  boring\u3000thing  ")).toBe(
      "Ship the boring thing",
    );
    expect(generatedReplyContentHash("Ａ  B")).toBe(generatedReplyContentHash("A B"));
  });
});

describe("generated reply ledger migration", () => {
  it("creates generated_reply and post.normalized_text_hash on a fresh database", () => {
    const db = makeTempEngineDb();

    try {
      const postColumns = db.prepare("PRAGMA table_info(post)").all() as Array<{ name: string }>;
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;

      expect(db.pragma("user_version", { simple: true })).toBe(8);
      expect(tables.map((row) => row.name)).toContain("generated_reply");
      expect(postColumns.map((row) => row.name)).toContain("normalized_text_hash");
    } finally {
      db.close();
    }
  });

  it("backfills post.normalized_text_hash when migrating a version 7 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "x-builder-rva-migration-"));
    const dbPath = join(dir, "x-builder.db");
    const legacy = new Database(dbPath);

    try {
      for (const migration of migrations.filter((item) => item.version <= 7)) {
        legacy.transaction(() => {
          migration.up(legacy);
          legacy.pragma(`user_version = ${migration.version}`);
        })();
      }

      legacy
        .prepare(
          `INSERT INTO post (
            id, platform_post_id, logical_post_id, text, created_at, kind,
            has_urls, has_media, has_hashtags, has_mentions, content_hash, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "post-1",
          "1800000000000000001",
          "1800000000000000001",
          "  Generated\u00a0reply  ",
          "2026-07-01T12:00:00.000Z",
          "reply",
          0,
          0,
          0,
          0,
          "sha256:legacy",
          "2026-07-01T12:00:01.000Z",
        );
    } finally {
      legacy.close();
    }

    const migrated = openEngineDatabase(dbPath);
    try {
      expect(migrated.pragma("user_version", { simple: true })).toBe(8);
      const row = migrated
        .prepare("SELECT normalized_text_hash FROM post WHERE id = ?")
        .get("post-1") as { normalized_text_hash: string };

      expect(row.normalized_text_hash).toBe(generatedReplyContentHash("Generated reply"));
    } finally {
      migrated.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("SqliteGeneratedReplyLedgerRepository", () => {
  it("records generated body and written text hashes and looks up either hash", async () => {
    const db = makeTempEngineDb();
    const repository = new SqliteGeneratedReplyLedgerRepository(db);

    try {
      const result = await repository.recordGeneratedReply({
        clientEventId: "event-1",
        bodyText: "Generated reply",
        writtenText: "@alice Generated reply",
        targetStatusId: "1800000000000000001",
        chosenVariantId: "variant-1",
        replyMove: "answer",
        generatedAt: "2026-07-01T12:00:00.000Z",
      });

      expect(result.duplicate).toBe(false);
      expect(result.record.bodyTextHash).toBe(generatedReplyContentHash("Generated reply"));
      expect(result.record.writtenTextHash).toBe(
        generatedReplyContentHash("@alice Generated reply"),
      );

      await expect(repository.isGeneratedReplyText("Generated   reply")).resolves.toBe(true);
      await expect(repository.isGeneratedReplyHash(result.record.writtenTextHash)).resolves.toBe(
        true,
      );
      await expect(repository.findByContentHash(result.record.bodyTextHash)).resolves.toMatchObject({
        clientEventId: "event-1",
      });
    } finally {
      db.close();
    }
  });

  it("is idempotent by client event id or either normalized content hash", async () => {
    const db = makeTempEngineDb();
    const repository = new SqliteGeneratedReplyLedgerRepository(db);

    try {
      const first = await repository.recordGeneratedReply({
        clientEventId: "event-1",
        bodyText: "Generated reply",
        writtenText: "@alice Generated reply",
      });
      const sameClient = await repository.recordGeneratedReply({
        clientEventId: "event-1",
        bodyText: "Different reply",
        writtenText: "Different reply",
      });
      const sameBodyHash = await repository.recordGeneratedReply({
        clientEventId: "event-2",
        bodyText: "Generated   reply",
        writtenText: "Generated   reply",
      });

      expect(first.duplicate).toBe(false);
      expect(sameClient).toMatchObject({
        duplicate: true,
        record: { id: first.record.id },
      });
      expect(sameBodyHash).toMatchObject({
        duplicate: true,
        record: { id: first.record.id },
      });

      const count = db.prepare("SELECT COUNT(*) AS count FROM generated_reply").get() as {
        count: number;
      };
      expect(count.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rejects empty generated body or written text", async () => {
    const db = makeTempEngineDb();
    const repository = new SqliteGeneratedReplyLedgerRepository(db);

    try {
      await expect(
        repository.recordGeneratedReply({
          clientEventId: "event-1",
          bodyText: "   ",
          writtenText: "@alice Generated reply",
        }),
      ).rejects.toThrow("must not be empty");
    } finally {
      db.close();
    }
  });
});
