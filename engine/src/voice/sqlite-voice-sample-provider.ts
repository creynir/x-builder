import type Database from "better-sqlite3";

import { classifyPostFormat } from "../deterministic/format-classifier.js";
import type {
  VoiceRetrievalRequest,
  VoiceRetrievalSample,
} from "../llm/generation-guidance.js";
import {
  cosineSimilarity,
  createLocalHashingVoiceEmbedder,
  decodeVoiceVector,
  type VoiceEmbedder,
} from "./voice-embedder.js";
import { VoiceIndexService } from "./voice-index-service.js";

type DatabaseHandle = Database.Database;

type VoiceCandidateRow = {
  id: string;
  platform_post_id: string;
  text: string;
  created_at: string;
  vector_blob: Buffer;
  dimensions: number;
  indexed_at: string;
};

type CanonicalVoiceRow = {
  id: string;
  platform_post_id: string;
  text: string;
  created_at: string;
};

export type SqliteVoiceSampleProviderOptions = {
  db: DatabaseHandle;
  embedder?: VoiceEmbedder;
  indexService?: Pick<VoiceIndexService, "ensureVoiceIndex">;
  limit?: number;
};

const DEFAULT_LIMIT = 5;
const KNOWN_POST_ID_LIMIT = 25;

const formatDescriptors: Record<VoiceRetrievalRequest["format"], string> = {
  genuine_question: "genuine question that invites useful replies",
  hot_take: "sharp hot take with a clear point of view",
  audience_question: "audience question for a specific group",
  story: "compact story with concrete lesson",
  founder_story: "founder story with real supplied stakes",
  insight_share: "insight share with practical learning",
  ab_choice: "A B choice framing",
  connect: "connective post that builds relationship",
  other: "general post",
  fill_blank_tribal: "fill in the blank tribal pattern",
  cta_farm: "call to action post",
  fantasy_question: "hypothetical fantasy question",
  binary_choice: "short binary choice question",
  nuanced_question: "nuanced question",
  recognition_roast: "recognition roast",
  wisdom_one_liner: "wisdom one liner",
  milestone: "milestone update",
};

const compareCreatedAtDesc = (left: CanonicalVoiceRow, right: CanonicalVoiceRow): number => {
  const leftTime = Date.parse(left.created_at);
  const rightTime = Date.parse(right.created_at);
  const leftValid = !Number.isNaN(leftTime);
  const rightValid = !Number.isNaN(rightTime);

  if (leftValid && rightValid && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
};

const toSample = (
  row: CanonicalVoiceRow,
  source: VoiceRetrievalSample["source"],
  extra: Pick<VoiceRetrievalSample, "score" | "indexedAt"> = {},
): VoiceRetrievalSample => ({
  id: row.id,
  platformPostId: row.platform_post_id,
  text: row.text,
  createdAt: row.created_at,
  kind: "original",
  source,
  ...extra,
});

export const createVoiceQueryText = (request: VoiceRetrievalRequest): string =>
  [request.idea?.trim(), request.format, formatDescriptors[request.format]]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n");

export class SqliteVoiceSampleProvider {
  private readonly db: DatabaseHandle;
  private readonly embedder: VoiceEmbedder;
  private readonly indexService: Pick<VoiceIndexService, "ensureVoiceIndex">;
  private readonly defaultLimit: number;

  constructor(options: SqliteVoiceSampleProviderOptions) {
    this.db = options.db;
    this.embedder = options.embedder ?? createLocalHashingVoiceEmbedder();
    this.indexService =
      options.indexService ?? new VoiceIndexService({ db: options.db, embedder: this.embedder });
    this.defaultLimit = options.limit ?? DEFAULT_LIMIT;
  }

  provide = async (request: VoiceRetrievalRequest): Promise<VoiceRetrievalSample[]> => {
    const limit = this.resolveLimit(request.limit);
    const selected: VoiceRetrievalSample[] = [];
    const selectedIds = new Set<string>();

    for (const row of this.findKnownRows(request.useKnownPostIds)) {
      if (selected.length >= limit) {
        return selected;
      }
      if (selectedIds.has(row.id)) {
        continue;
      }
      selected.push(toSample(row, "known_post_id"));
      selectedIds.add(row.id);
    }

    try {
      this.indexService.ensureVoiceIndex();
      const vectorRows = this.rankVectorRows(request, selectedIds);
      for (const row of vectorRows) {
        if (selected.length >= limit) {
          return selected;
        }
        if (selectedIds.has(row.sample.id)) {
          continue;
        }
        selected.push(row.sample);
        selectedIds.add(row.sample.id);
      }
    } catch {
      // The resolver also has a fail-open fallback; provider-level fallback keeps
      // underfilled known-id results useful when indexing is unavailable.
    }

    for (const row of this.findRecentRows()) {
      if (selected.length >= limit) {
        break;
      }
      if (selectedIds.has(row.id)) {
        continue;
      }
      selected.push(toSample(row, "recent_original"));
      selectedIds.add(row.id);
    }

    return selected;
  };

  private resolveLimit(limit: number | undefined): number {
    if (!Number.isInteger(limit) || limit === undefined || limit <= 0) {
      return this.defaultLimit;
    }

    return Math.min(limit, this.defaultLimit);
  }

  private findKnownRows(knownPostIds: string[]): CanonicalVoiceRow[] {
    const rows: CanonicalVoiceRow[] = [];
    const select = this.db.prepare(
      `
      SELECT id, platform_post_id, text, created_at
      FROM post
      WHERE kind = 'original'
        AND length(trim(text)) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM generated_reply gr
          WHERE post.normalized_text_hash IN (gr.body_text_hash, gr.written_text_hash)
        )
        AND (id = ? OR platform_post_id = ?)
      LIMIT 1
    `,
    );

    for (const knownPostId of knownPostIds.slice(0, KNOWN_POST_ID_LIMIT)) {
      const row = select.get(knownPostId, knownPostId) as CanonicalVoiceRow | undefined;
      if (row !== undefined) {
        rows.push(row);
      }
    }

    return rows;
  }

  private rankVectorRows(
    request: VoiceRetrievalRequest,
    selectedIds: Set<string>,
  ): Array<{ sample: VoiceRetrievalSample; sameFormat: boolean; createdAtTime: number }> {
    const queryVector = this.embedder.embedText(createVoiceQueryText(request));
    const rows = this.db
      .prepare(
        `
        SELECT
          p.id,
          p.platform_post_id,
          p.text,
          p.created_at,
          v.vector_blob,
          v.dimensions,
          v.indexed_at
        FROM voice_post_embedding v
        JOIN post p ON p.id = v.post_id
        WHERE p.kind = 'original'
          AND length(trim(p.text)) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM generated_reply gr
            WHERE p.normalized_text_hash IN (gr.body_text_hash, gr.written_text_hash)
          )
          AND v.embedder_id = ?
          AND v.embedder_version = ?
          AND v.dimensions = ?
      `,
      )
      .all(this.embedder.id, this.embedder.version, this.embedder.dimensions) as VoiceCandidateRow[];

    return rows
      .filter((row) => !selectedIds.has(row.id))
      .map((row) => {
        const vector = decodeVoiceVector(row.vector_blob, row.dimensions);
        const score = vector === undefined ? undefined : cosineSimilarity(queryVector, vector);
        if (score === undefined) {
          return undefined;
        }

        const canonicalRow: CanonicalVoiceRow = {
          id: row.id,
          platform_post_id: row.platform_post_id,
          text: row.text,
          created_at: row.created_at,
        };

        return {
          sample: toSample(canonicalRow, "voice_rag", {
            score,
            indexedAt: row.indexed_at,
          }),
          sameFormat: classifyPostFormat(row.text) === request.format,
          createdAtTime: Date.parse(row.created_at),
        };
      })
      .filter(
        (
          row,
        ): row is {
          sample: VoiceRetrievalSample;
          sameFormat: boolean;
          createdAtTime: number;
        } => row !== undefined,
      )
      .sort((left, right) => {
        const scoreDelta = (right.sample.score ?? 0) - (left.sample.score ?? 0);
        if (Math.abs(scoreDelta) > 1e-9) {
          return scoreDelta;
        }
        if (left.sameFormat !== right.sameFormat) {
          return left.sameFormat ? -1 : 1;
        }
        const leftValid = !Number.isNaN(left.createdAtTime);
        const rightValid = !Number.isNaN(right.createdAtTime);
        if (leftValid && rightValid && left.createdAtTime !== right.createdAtTime) {
          return right.createdAtTime - left.createdAtTime;
        }
        if (leftValid !== rightValid) {
          return leftValid ? -1 : 1;
        }
        return left.sample.id.localeCompare(right.sample.id);
      });
  }

  private findRecentRows(): CanonicalVoiceRow[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, platform_post_id, text, created_at
        FROM post
        WHERE kind = 'original'
          AND length(trim(text)) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM generated_reply gr
            WHERE post.normalized_text_hash IN (gr.body_text_hash, gr.written_text_hash)
          )
      `,
      )
      .all() as CanonicalVoiceRow[];

    return rows.sort(compareCreatedAtDesc);
  }
}

export const createSqliteVoiceSampleProvider = (
  options: SqliteVoiceSampleProviderOptions,
): ((request: VoiceRetrievalRequest) => Promise<VoiceRetrievalSample[]>) =>
  new SqliteVoiceSampleProvider(options).provide;
