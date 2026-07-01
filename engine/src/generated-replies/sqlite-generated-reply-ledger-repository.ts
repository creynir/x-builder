import { createHash } from "node:crypto";

import type Database from "better-sqlite3";
import type {
  GeneratedReplyRecord,
  RecordGeneratedReplyRequest,
} from "@x-builder/shared";

import {
  generatedReplyContentHash,
  normalizeGeneratedReplyText,
} from "./normalize-generated-reply.js";
import type {
  GeneratedReplyLedgerRepository,
  GeneratedReplyWriteResult,
} from "./generated-reply-ledger-repository.js";

type DatabaseHandle = Database.Database;

type GeneratedReplyRow = {
  id: string;
  client_event_id: string;
  body_text: string;
  written_text: string;
  body_text_hash: string;
  written_text_hash: string;
  target_status_id: string | null;
  chosen_variant_id: string | null;
  reply_move: string | null;
  generated_at: string;
  recorded_at: string;
};

const nowIso = (): string => new Date().toISOString();

const idFor = (clientEventId: string, bodyTextHash: string, writtenTextHash: string): string =>
  `generated_reply_${createHash("sha256")
    .update(JSON.stringify([clientEventId, bodyTextHash, writtenTextHash]))
    .digest("hex")
    .slice(0, 32)}`;

const rowToRecord = (row: GeneratedReplyRow): GeneratedReplyRecord => ({
  id: row.id,
  clientEventId: row.client_event_id,
  bodyText: row.body_text,
  writtenText: row.written_text,
  bodyTextHash: row.body_text_hash,
  writtenTextHash: row.written_text_hash,
  ...(row.target_status_id === null ? {} : { targetStatusId: row.target_status_id }),
  ...(row.chosen_variant_id === null ? {} : { chosenVariantId: row.chosen_variant_id }),
  ...(row.reply_move === null ? {} : { replyMove: row.reply_move }),
  generatedAt: row.generated_at,
  recordedAt: row.recorded_at,
});

export class SqliteGeneratedReplyLedgerRepository
  implements GeneratedReplyLedgerRepository
{
  constructor(private readonly db: DatabaseHandle) {}

  async recordGeneratedReply(
    input: RecordGeneratedReplyRequest,
  ): Promise<GeneratedReplyWriteResult> {
    const normalizedBody = normalizeGeneratedReplyText(input.bodyText);
    const normalizedWritten = normalizeGeneratedReplyText(input.writtenText);

    if (normalizedBody.length === 0 || normalizedWritten.length === 0) {
      throw new Error("Generated reply body and written text must not be empty.");
    }

    const bodyTextHash = generatedReplyContentHash(input.bodyText);
    const writtenTextHash = generatedReplyContentHash(input.writtenText);
    const recordedAt = nowIso();
    const generatedAt = input.generatedAt ?? recordedAt;

    return this.db.transaction(() => {
      const existingByClient = this.findRowByClientEventId(input.clientEventId);
      if (existingByClient !== undefined) {
        return { record: rowToRecord(existingByClient), duplicate: true };
      }

      const existingByHash = this.findRowByAnyHash([bodyTextHash, writtenTextHash]);
      if (existingByHash !== undefined) {
        return { record: rowToRecord(existingByHash), duplicate: true };
      }

      const row: GeneratedReplyRow = {
        id: idFor(input.clientEventId, bodyTextHash, writtenTextHash),
        client_event_id: input.clientEventId,
        body_text: input.bodyText,
        written_text: input.writtenText,
        body_text_hash: bodyTextHash,
        written_text_hash: writtenTextHash,
        target_status_id: input.targetStatusId ?? null,
        chosen_variant_id: input.chosenVariantId ?? null,
        reply_move: input.replyMove ?? null,
        generated_at: generatedAt,
        recorded_at: recordedAt,
      };

      this.db
        .prepare(
          `INSERT INTO generated_reply (
            id, client_event_id, body_text, written_text, body_text_hash, written_text_hash,
            target_status_id, chosen_variant_id, reply_move, generated_at, recorded_at
          ) VALUES (
            @id, @client_event_id, @body_text, @written_text, @body_text_hash, @written_text_hash,
            @target_status_id, @chosen_variant_id, @reply_move, @generated_at, @recorded_at
          )`,
        )
        .run(row);

      return { record: rowToRecord(row), duplicate: false };
    })();
  }

  async findByContentHash(hash: string): Promise<GeneratedReplyRecord | undefined> {
    const row = this.findRowByAnyHash([hash]);
    return row === undefined ? undefined : rowToRecord(row);
  }

  async isGeneratedReplyText(text: string): Promise<boolean> {
    return this.isGeneratedReplyHash(generatedReplyContentHash(text));
  }

  async isGeneratedReplyHash(hash: string): Promise<boolean> {
    return this.findRowByAnyHash([hash]) !== undefined;
  }

  private findRowByClientEventId(clientEventId: string): GeneratedReplyRow | undefined {
    return this.db
      .prepare("SELECT * FROM generated_reply WHERE client_event_id = ?")
      .get(clientEventId) as GeneratedReplyRow | undefined;
  }

  private findRowByAnyHash(hashes: readonly string[]): GeneratedReplyRow | undefined {
    if (hashes.length === 0) {
      return undefined;
    }

    const placeholders = hashes.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT * FROM generated_reply
         WHERE body_text_hash IN (${placeholders})
            OR written_text_hash IN (${placeholders})
         ORDER BY recorded_at ASC, id ASC
         LIMIT 1`,
      )
      .get(...hashes, ...hashes) as GeneratedReplyRow | undefined;
  }
}
