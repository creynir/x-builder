import type Database from "better-sqlite3";

import type { VoiceEmbedder } from "./voice-embedder.js";
import { encodeVoiceVector } from "./voice-embedder.js";

type DatabaseHandle = Database.Database;

type CanonicalVoiceRow = {
  id: string;
  platform_post_id: string;
  text: string;
  content_hash: string;
  updated_at: string;
};

export type EnsureVoiceIndexResult = {
  indexedCount: number;
  deletedOrphanCount: number;
  remainingStaleCount: number;
};

export type VoiceIndexServiceOptions = {
  db: DatabaseHandle;
  embedder: VoiceEmbedder;
  now?: () => string;
  maxPostsPerCall?: number;
};

export type EnsureVoiceIndexOptions = {
  maxPostsPerCall?: number;
};

const DEFAULT_MAX_POSTS_PER_CALL = 250;

const nowIso = (): string => new Date().toISOString();

const boundedLimit = (limit: number | undefined): number => {
  if (limit === undefined) {
    return DEFAULT_MAX_POSTS_PER_CALL;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_MAX_POSTS_PER_CALL;
  }

  return limit;
};

export class VoiceIndexService {
  private readonly db: DatabaseHandle;
  private readonly embedder: VoiceEmbedder;
  private readonly now: () => string;
  private readonly defaultMaxPostsPerCall: number;

  constructor(options: VoiceIndexServiceOptions) {
    this.db = options.db;
    this.embedder = options.embedder;
    this.now = options.now ?? nowIso;
    this.defaultMaxPostsPerCall = boundedLimit(options.maxPostsPerCall);
  }

  ensureVoiceIndex(options: EnsureVoiceIndexOptions = {}): EnsureVoiceIndexResult {
    const maxPostsPerCall = boundedLimit(options.maxPostsPerCall ?? this.defaultMaxPostsPerCall);
    const staleRows = this.selectStaleRows(maxPostsPerCall);
    let indexedCount = 0;
    const failures: string[] = [];

    const transaction = this.db.transaction(() => {
      const deletedOrphanCount = this.deleteOrphans();
      const timestamp = this.now();

      const upsertEmbedding = this.db.prepare(`
        INSERT INTO voice_post_embedding (
          post_id,
          platform_post_id,
          content_hash,
          post_updated_at,
          embedder_id,
          embedder_version,
          dimensions,
          vector_blob,
          indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(post_id) DO UPDATE SET
          platform_post_id = excluded.platform_post_id,
          content_hash = excluded.content_hash,
          post_updated_at = excluded.post_updated_at,
          embedder_id = excluded.embedder_id,
          embedder_version = excluded.embedder_version,
          dimensions = excluded.dimensions,
          vector_blob = excluded.vector_blob,
          indexed_at = excluded.indexed_at
      `);

      for (const row of staleRows) {
        try {
          const vector = this.embedder.embedText(row.text);
          if (vector.length !== this.embedder.dimensions) {
            failures.push(`${row.id}: dimension_mismatch`);
            continue;
          }

          upsertEmbedding.run(
            row.id,
            row.platform_post_id,
            row.content_hash,
            row.updated_at,
            this.embedder.id,
            this.embedder.version,
            this.embedder.dimensions,
            encodeVoiceVector(vector),
            timestamp,
          );
          indexedCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${row.id}: ${message}`);
        }
      }

      this.upsertMeta({
        timestamp,
        lastSuccessfulIndexAt: timestamp,
        lastErrorAt: failures.length === 0 ? null : timestamp,
        lastError: failures.length === 0 ? null : failures.slice(0, 5).join("; "),
      });

      return deletedOrphanCount;
    });

    const deletedOrphanCount = transaction();

    return {
      indexedCount,
      deletedOrphanCount,
      remainingStaleCount: this.countStaleRows(),
    };
  }

  private selectStaleRows(limit: number): CanonicalVoiceRow[] {
    return this.db
      .prepare(
        `
        SELECT
          p.id,
          p.platform_post_id,
          p.text,
          p.content_hash,
          p.updated_at
        FROM post p
        LEFT JOIN voice_post_embedding v ON v.post_id = p.id
        WHERE p.kind = 'original'
          AND length(trim(p.text)) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM generated_reply gr
            WHERE p.normalized_text_hash IN (gr.body_text_hash, gr.written_text_hash)
          )
          AND (
            v.post_id IS NULL
            OR v.content_hash != p.content_hash
            OR v.post_updated_at != p.updated_at
            OR v.embedder_id != ?
            OR v.embedder_version != ?
            OR v.dimensions != ?
          )
        ORDER BY p.created_at DESC, p.id ASC
        LIMIT ?
      `,
      )
      .all(this.embedder.id, this.embedder.version, this.embedder.dimensions, limit) as
      CanonicalVoiceRow[];
  }

  private countStaleRows(): number {
    const row = this.db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM post p
        LEFT JOIN voice_post_embedding v ON v.post_id = p.id
        WHERE p.kind = 'original'
          AND length(trim(p.text)) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM generated_reply gr
            WHERE p.normalized_text_hash IN (gr.body_text_hash, gr.written_text_hash)
          )
          AND (
            v.post_id IS NULL
            OR v.content_hash != p.content_hash
            OR v.post_updated_at != p.updated_at
            OR v.embedder_id != ?
            OR v.embedder_version != ?
            OR v.dimensions != ?
          )
      `,
      )
      .get(this.embedder.id, this.embedder.version, this.embedder.dimensions) as {
      count: number;
    };

    return row.count;
  }

  private deleteOrphans(): number {
    return this.db
      .prepare(
        `
        DELETE FROM voice_post_embedding
        WHERE post_id NOT IN (SELECT id FROM post)
           OR post_id IN (
             SELECT p.id
             FROM post p
             JOIN generated_reply gr
               ON p.normalized_text_hash IN (gr.body_text_hash, gr.written_text_hash)
           )
      `,
      )
      .run().changes;
  }

  private upsertMeta(input: {
    timestamp: string;
    lastSuccessfulIndexAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  }): void {
    this.db
      .prepare(
        `
        INSERT INTO voice_index_meta (
          singleton,
          embedder_id,
          embedder_version,
          dimensions,
          distance_metric,
          updated_at,
          last_successful_index_at,
          last_error_at,
          last_error
        ) VALUES (1, ?, ?, ?, 'cosine', ?, ?, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          embedder_id = excluded.embedder_id,
          embedder_version = excluded.embedder_version,
          dimensions = excluded.dimensions,
          distance_metric = excluded.distance_metric,
          updated_at = excluded.updated_at,
          last_successful_index_at = excluded.last_successful_index_at,
          last_error_at = excluded.last_error_at,
          last_error = excluded.last_error
      `,
      )
      .run(
        this.embedder.id,
        this.embedder.version,
        this.embedder.dimensions,
        input.timestamp,
        input.lastSuccessfulIndexAt,
        input.lastErrorAt,
        input.lastError,
      );
  }
}
