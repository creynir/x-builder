import type Database from "better-sqlite3";
import {
  addExternalXSignalSourceRequestSchema,
  detectedPostFormatSchema,
  externalXSignalEvidenceSchema,
  externalXSignalPatternSchema,
  externalXSignalPatternTypeSchema,
  externalXSignalRefreshRunSchema,
  externalXSignalSourceSchema,
  getExternalXSignalsOverviewRequestSchema,
  getExternalXSignalsOverviewResponseSchema,
  removeExternalXSignalSourceRequestSchema,
  type AddExternalXSignalSourceRequest,
  type AddExternalXSignalSourceResponse,
  type ExternalXSignalEvidence,
  type ExternalXSignalMetricSnapshot,
  type ExternalXSignalPattern,
  type ExternalXSignalRefreshRun,
  type ExternalXSignalSource,
  type GetExternalXSignalsOverviewRequest,
  type GetExternalXSignalsOverviewResponse,
  type RemoveExternalXSignalSourceRequest,
  type RemoveExternalXSignalSourceResponse,
} from "@x-builder/shared";
import { z } from "zod";

import { PostLibraryStorageError } from "../server/post-library-repository.js";
import type {
  ExternalXSignalsRepository,
  ExternalXSignalsWriteResult,
  ListGenerationPatternsRequest,
} from "./external-x-signals-repository.js";

type DatabaseHandle = Database.Database;

type SourceRow = {
  id: string;
  platform: string;
  screen_name: string;
  display_name: string | null;
  platform_user_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_observed_at: string | null;
};

type EvidenceRow = {
  id: string;
  source_id: string;
  platform: string;
  platform_post_id: string;
  screen_name: string;
  text: string;
  preview_text: string | null;
  created_at: string | null;
  kind: string;
  language: string | null;
  in_reply_to_post_id: string | null;
  in_reply_to_user_id: string | null;
  has_urls: number;
  has_media: number;
  has_hashtags: number;
  has_mentions: number;
  metrics_json: string;
  evidence_source: string;
  observed_at: string;
  imported_at: string | null;
  content_hash: string | null;
  raw_id: string | null;
  source_hash: string | null;
  capture_session_id: string | null;
};

type RefreshRunRow = {
  id: string;
  source_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  evidence_count: number;
  warning_count: number;
  message: string | null;
};

type PatternRow = { payload: string };

type RepositoryOptions = {
  now?: () => string;
  id?: () => string;
};

const listGenerationPatternsRequestSchema = z.object({
  format: detectedPostFormatSchema.optional(),
  patternTypes: z.array(externalXSignalPatternTypeSchema).default(["format"]),
  minConfidence: z.number().min(0).max(1).default(0.5),
  minSupportCount: z.number().int().min(0).default(2),
  limit: z
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((limit) => Math.min(limit, 20)),
});

const stableJson = (value: unknown): string => JSON.stringify(value);
const parseJson = (value: string): unknown => JSON.parse(value);

const normalizeScreenName = (value: string): string =>
  value.trim().replace(/^@+/, "").trim().toLowerCase();

const storageError = (message: string, cause?: unknown): PostLibraryStorageError =>
  new PostLibraryStorageError(message, cause);

const metricsOf = (value: string): ExternalXSignalMetricSnapshot =>
  parseJson(value) as ExternalXSignalMetricSnapshot;

const toSource = (
  row: SourceRow,
  counts: { evidenceCount: number; patternCount: number },
): ExternalXSignalSource =>
  externalXSignalSourceSchema.parse({
    id: row.id,
    platform: row.platform,
    screenName: row.screen_name,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    ...(row.platform_user_id === null ? {} : { platformUserId: row.platform_user_id }),
    status: row.status,
    evidenceCount: counts.evidenceCount,
    patternCount: counts.patternCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_observed_at === null ? {} : { lastObservedAt: row.last_observed_at }),
  });

const toEvidence = (row: EvidenceRow): ExternalXSignalEvidence =>
  externalXSignalEvidenceSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    platform: row.platform,
    platformPostId: row.platform_post_id,
    screenName: row.screen_name,
    text: row.text,
    ...(row.preview_text === null ? {} : { previewText: row.preview_text }),
    ...(row.created_at === null ? {} : { createdAt: row.created_at }),
    kind: row.kind,
    ...(row.language === null ? {} : { language: row.language }),
    ...(row.in_reply_to_post_id === null ? {} : { inReplyToPostId: row.in_reply_to_post_id }),
    ...(row.in_reply_to_user_id === null ? {} : { inReplyToUserId: row.in_reply_to_user_id }),
    hasUrls: row.has_urls === 1,
    hasMedia: row.has_media === 1,
    hasHashtags: row.has_hashtags === 1,
    hasMentions: row.has_mentions === 1,
    metrics: metricsOf(row.metrics_json),
    evidenceSource: row.evidence_source,
    observedAt: row.observed_at,
    ...(row.imported_at === null ? {} : { importedAt: row.imported_at }),
    ...(row.content_hash === null ? {} : { contentHash: row.content_hash }),
    ...(row.raw_id === null ? {} : { rawId: row.raw_id }),
    ...(row.source_hash === null ? {} : { sourceHash: row.source_hash }),
    ...(row.capture_session_id === null ? {} : { captureSessionId: row.capture_session_id }),
  });

const toRefreshRun = (row: RefreshRunRow): ExternalXSignalRefreshRun =>
  externalXSignalRefreshRunSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    startedAt: row.started_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    evidenceCount: row.evidence_count,
    warningCount: row.warning_count,
    ...(row.message === null ? {} : { message: row.message }),
  });

export class SqliteExternalXSignalsRepository implements ExternalXSignalsRepository {
  private readonly now: () => string;
  private readonly id: () => string;

  constructor(private readonly db: DatabaseHandle, options: RepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  async addSource(input: AddExternalXSignalSourceRequest): Promise<AddExternalXSignalSourceResponse> {
    try {
      const parsed = addExternalXSignalSourceRequestSchema.parse(input);
      const existing = this.readSourceByScreenName(parsed.screenName);
      const timestamp = this.now();

      if (existing) {
        if (existing.status === "removed") {
          this.db
            .prepare(
              `UPDATE external_x_signal_source
               SET status = 'active', display_name = ?, platform_user_id = COALESCE(?, platform_user_id), updated_at = ?
               WHERE id = ?`,
            )
            .run(parsed.displayName ?? existing.displayName ?? null, parsed.platformUserId ?? null, timestamp, existing.id);
        }

        return { source: this.readSourceById(existing.id), duplicate: true };
      }

      const source = externalXSignalSourceSchema.parse({
        id: this.id(),
        platform: "x",
        screenName: parsed.screenName,
        ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName }),
        ...(parsed.platformUserId === undefined ? {} : { platformUserId: parsed.platformUserId }),
        status: "active",
        evidenceCount: 0,
        patternCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      this.db
        .prepare(
          `INSERT INTO external_x_signal_source (
            id, platform, screen_name, display_name, platform_user_id, status, created_at, updated_at, last_observed_at
          ) VALUES (
            @id, @platform, @screen_name, @display_name, @platform_user_id, @status, @created_at, @updated_at, @last_observed_at
          )`,
        )
        .run({
          id: source.id,
          platform: source.platform,
          screen_name: source.screenName,
          display_name: source.displayName ?? null,
          platform_user_id: source.platformUserId ?? null,
          status: source.status,
          created_at: source.createdAt,
          updated_at: source.updatedAt,
          last_observed_at: source.lastObservedAt ?? null,
        });

      return { source, duplicate: false };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("External X signal source failed schema validation.", error);
      }

      throw storageError("Failed to add external X signal source.", error);
    }
  }

  async removeSource(input: RemoveExternalXSignalSourceRequest): Promise<RemoveExternalXSignalSourceResponse> {
    try {
      const parsed = removeExternalXSignalSourceRequestSchema.parse(input);
      const source = this.readSourceById(parsed.sourceId);
      const timestamp = this.now();

      this.db
        .prepare("UPDATE external_x_signal_source SET status = 'removed', updated_at = ? WHERE id = ?")
        .run(timestamp, source.id);

      return { source: this.readSourceById(source.id), removed: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("External X signal remove request failed schema validation.", error);
      }

      throw storageError("Failed to remove external X signal source.", error);
    }
  }

  async upsertObservedEvidence(evidence: ExternalXSignalEvidence[]): Promise<ExternalXSignalsWriteResult> {
    const result: ExternalXSignalsWriteResult = {
      insertedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
    };

    try {
      this.db.transaction(() => {
        const seenKeys = new Set<string>();

        for (const raw of evidence) {
          const parsed = externalXSignalEvidenceSchema.parse(raw);
          const key = [parsed.sourceId, parsed.platformPostId, parsed.evidenceSource, parsed.observedAt].join(":");
          if (seenKeys.has(key)) {
            result.duplicateCount += 1;
            continue;
          }
          seenKeys.add(key);

          const existing = this.readEvidenceByKey(parsed);
          const row = this.evidenceRow(parsed);

          this.db
            .prepare(
              `INSERT INTO external_x_signal_evidence (
                id, source_id, platform, platform_post_id, screen_name, text, preview_text, created_at,
                kind, language, in_reply_to_post_id, in_reply_to_user_id, has_urls, has_media,
                has_hashtags, has_mentions, metrics_json, evidence_source, observed_at, imported_at,
                content_hash, raw_id, source_hash, capture_session_id, updated_at
              ) VALUES (
                @id, @source_id, @platform, @platform_post_id, @screen_name, @text, @preview_text, @created_at,
                @kind, @language, @in_reply_to_post_id, @in_reply_to_user_id, @has_urls, @has_media,
                @has_hashtags, @has_mentions, @metrics_json, @evidence_source, @observed_at, @imported_at,
                @content_hash, @raw_id, @source_hash, @capture_session_id, @updated_at
              )
              ON CONFLICT(source_id, platform_post_id, evidence_source, observed_at) DO UPDATE SET
                screen_name = excluded.screen_name,
                text = excluded.text,
                preview_text = excluded.preview_text,
                created_at = excluded.created_at,
                kind = excluded.kind,
                language = excluded.language,
                in_reply_to_post_id = excluded.in_reply_to_post_id,
                in_reply_to_user_id = excluded.in_reply_to_user_id,
                has_urls = excluded.has_urls,
                has_media = excluded.has_media,
                has_hashtags = excluded.has_hashtags,
                has_mentions = excluded.has_mentions,
                metrics_json = excluded.metrics_json,
                imported_at = excluded.imported_at,
                content_hash = excluded.content_hash,
                raw_id = excluded.raw_id,
                source_hash = excluded.source_hash,
                capture_session_id = excluded.capture_session_id,
                updated_at = excluded.updated_at`,
            )
            .run(row);

          if (!existing) {
            result.insertedCount += 1;
          } else if (stableJson(existing) === stableJson(parsed)) {
            result.unchangedCount += 1;
          } else {
            result.updatedCount += 1;
          }

          this.db
            .prepare(
              `UPDATE external_x_signal_source
               SET last_observed_at = CASE
                 WHEN last_observed_at IS NULL OR last_observed_at < ? THEN ?
                 ELSE last_observed_at
               END,
               updated_at = ?
               WHERE id = ?`,
            )
            .run(parsed.observedAt, parsed.observedAt, this.now(), parsed.sourceId);
        }
      })();

      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("External X signal evidence failed schema validation.", error);
      }

      throw storageError("Failed to upsert external X signal evidence.", error);
    }
  }

  async saveRefreshRun(input: ExternalXSignalRefreshRun): Promise<void> {
    try {
      const run = externalXSignalRefreshRunSchema.parse(input);
      this.db
        .prepare(
          `INSERT INTO external_x_signal_refresh_run (
            id, source_id, status, started_at, completed_at, evidence_count, warning_count, message
          ) VALUES (
            @id, @source_id, @status, @started_at, @completed_at, @evidence_count, @warning_count, @message
          )
          ON CONFLICT(id) DO UPDATE SET
            source_id = excluded.source_id,
            status = excluded.status,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            evidence_count = excluded.evidence_count,
            warning_count = excluded.warning_count,
            message = excluded.message`,
        )
        .run({
          id: run.id,
          source_id: run.sourceId,
          status: run.status,
          started_at: run.startedAt,
          completed_at: run.completedAt ?? null,
          evidence_count: run.evidenceCount,
          warning_count: run.warningCount,
          message: run.message ?? null,
        });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("External X signal refresh run failed schema validation.", error);
      }

      throw storageError("Failed to save external X signal refresh run.", error);
    }
  }

  async replacePatterns(input: ExternalXSignalPattern[]): Promise<void> {
    try {
      const patterns = input.map((pattern) => externalXSignalPatternSchema.parse(pattern));

      this.db.transaction(() => {
        this.db.prepare("DELETE FROM external_x_signal_pattern_evidence").run();
        this.db.prepare("DELETE FROM external_x_signal_pattern").run();

        const insertPattern = this.db.prepare(
          `INSERT INTO external_x_signal_pattern (
            id, pattern_type, label, statement, confidence, support_count, generated_at, version, payload
          ) VALUES (
            @id, @pattern_type, @label, @statement, @confidence, @support_count, @generated_at, @version, @payload
          )`,
        );
        const insertEvidence = this.db.prepare(
          `INSERT INTO external_x_signal_pattern_evidence (pattern_id, evidence_id, role)
           VALUES (?, ?, 'supporting')`,
        );

        for (const pattern of patterns) {
          insertPattern.run({
            id: pattern.id,
            pattern_type: pattern.patternType,
            label: pattern.label,
            statement: pattern.statement,
            confidence: pattern.confidence,
            support_count: pattern.supportCount,
            generated_at: pattern.generatedAt,
            version: pattern.version,
            payload: stableJson(pattern),
          });

          for (const evidenceId of pattern.evidenceIds) {
            insertEvidence.run(pattern.id, evidenceId);
          }
        }
      })();
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("External X signal pattern failed schema validation.", error);
      }

      throw storageError("Failed to replace external X signal patterns.", error);
    }
  }

  async getOverview(input?: GetExternalXSignalsOverviewRequest): Promise<GetExternalXSignalsOverviewResponse> {
    try {
      const request = getExternalXSignalsOverviewRequestSchema.parse(input ?? {});
      const generatedAt = this.now();
      const sources = this.readSources(request);
      const patterns = this.readPatterns(request.patternLimit);
      const recentEvidence = this.readRecentEvidence(request);
      const refreshRuns = this.readRefreshRuns(request);

      return getExternalXSignalsOverviewResponseSchema.parse({
        generatedAt,
        sources,
        totals: this.readTotals(),
        patterns,
        recentEvidence,
        refreshRuns,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("External X signals overview request failed schema validation.", error);
      }

      throw storageError("Failed to read external X signals overview.", error);
    }
  }

  async listGenerationPatterns(input: ListGenerationPatternsRequest): Promise<ExternalXSignalPattern[]> {
    try {
      const request = listGenerationPatternsRequestSchema.parse(input);

      return this.readGenerationPatterns(request);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw storageError("External X signal generation pattern request failed schema validation.", error);
      }

      throw storageError("Failed to list external X signal generation patterns.", error);
    }
  }

  private evidenceRow(evidence: ExternalXSignalEvidence): Record<string, unknown> {
    return {
      id: evidence.id,
      source_id: evidence.sourceId,
      platform: evidence.platform,
      platform_post_id: evidence.platformPostId,
      screen_name: evidence.screenName,
      text: evidence.text,
      preview_text: evidence.previewText ?? null,
      created_at: evidence.createdAt ?? null,
      kind: evidence.kind,
      language: evidence.language ?? null,
      in_reply_to_post_id: evidence.inReplyToPostId ?? null,
      in_reply_to_user_id: evidence.inReplyToUserId ?? null,
      has_urls: evidence.hasUrls ? 1 : 0,
      has_media: evidence.hasMedia ? 1 : 0,
      has_hashtags: evidence.hasHashtags ? 1 : 0,
      has_mentions: evidence.hasMentions ? 1 : 0,
      metrics_json: stableJson(evidence.metrics),
      evidence_source: evidence.evidenceSource,
      observed_at: evidence.observedAt,
      imported_at: evidence.importedAt ?? null,
      content_hash: evidence.contentHash ?? null,
      raw_id: evidence.rawId ?? null,
      source_hash: evidence.sourceHash ?? null,
      capture_session_id: evidence.captureSessionId ?? null,
      updated_at: this.now(),
    };
  }

  private readEvidenceByKey(evidence: ExternalXSignalEvidence): ExternalXSignalEvidence | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM external_x_signal_evidence
         WHERE source_id = ? AND platform_post_id = ? AND evidence_source = ? AND observed_at = ?`,
      )
      .get(evidence.sourceId, evidence.platformPostId, evidence.evidenceSource, evidence.observedAt) as
      | EvidenceRow
      | undefined;

    return row ? toEvidence(row) : undefined;
  }

  private readSourceByScreenName(screenName: string): ExternalXSignalSource | undefined {
    const row = this.db
      .prepare("SELECT * FROM external_x_signal_source WHERE screen_name = ?")
      .get(normalizeScreenName(screenName)) as SourceRow | undefined;

    return row ? toSource(row, this.readSourceCounts(row.id)) : undefined;
  }

  private readSourceById(sourceId: string): ExternalXSignalSource {
    const row = this.db
      .prepare("SELECT * FROM external_x_signal_source WHERE id = ?")
      .get(sourceId) as SourceRow | undefined;

    if (!row) {
      throw storageError(`External X signal source ${sourceId} was not found.`);
    }

    return toSource(row, this.readSourceCounts(row.id));
  }

  private readSourceCounts(sourceId: string): { evidenceCount: number; patternCount: number } {
    const evidence = this.db
      .prepare("SELECT COUNT(*) AS count FROM external_x_signal_evidence WHERE source_id = ?")
      .get(sourceId) as { count: number };
    const patterns = this.db
      .prepare(
        `SELECT COUNT(DISTINCT pattern_id) AS count
         FROM external_x_signal_pattern_evidence pe
         JOIN external_x_signal_evidence e ON e.id = pe.evidence_id
         WHERE e.source_id = ?`,
      )
      .get(sourceId) as { count: number };

    return { evidenceCount: evidence.count, patternCount: patterns.count };
  }

  private readSources(request: z.infer<typeof getExternalXSignalsOverviewRequestSchema>): ExternalXSignalSource[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM external_x_signal_source
         WHERE (? = 1 OR status != 'removed')
           AND (? IS NULL OR id = ?)
         ORDER BY updated_at DESC, id ASC
         LIMIT ?`,
      )
      .all(request.includeRemoved ? 1 : 0, request.sourceId ?? null, request.sourceId ?? null, request.sourceLimit) as SourceRow[];

    return rows.map((row) => toSource(row, this.readSourceCounts(row.id)));
  }

  private readPatterns(limit: number): ExternalXSignalPattern[] {
    const rows = this.db
      .prepare("SELECT payload FROM external_x_signal_pattern ORDER BY generated_at DESC, id ASC LIMIT ?")
      .all(limit) as PatternRow[];

    return rows.map((row) => externalXSignalPatternSchema.parse(parseJson(row.payload)));
  }

  private readGenerationPatterns(request: z.infer<typeof listGenerationPatternsRequestSchema>): ExternalXSignalPattern[] {
    if (request.patternTypes.length === 0) {
      return [];
    }

    const patternTypePlaceholders = request.patternTypes.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT payload FROM external_x_signal_pattern
         WHERE pattern_type IN (${patternTypePlaceholders})
           AND confidence >= ?
           AND support_count >= ?
         ORDER BY
           CASE
             WHEN ? IS NOT NULL AND json_extract(payload, '$.format') = ? THEN 0
             ELSE 1
           END,
           confidence DESC,
           support_count DESC,
           generated_at DESC,
           id ASC
         LIMIT ?`,
      )
      .all(
        ...request.patternTypes,
        request.minConfidence,
        request.minSupportCount,
        request.format ?? null,
        request.format ?? null,
        request.limit,
      ) as PatternRow[];

    return rows.map((row) => externalXSignalPatternSchema.parse(parseJson(row.payload)));
  }

  private readRecentEvidence(request: z.infer<typeof getExternalXSignalsOverviewRequestSchema>): ExternalXSignalEvidence[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM external_x_signal_evidence e
         JOIN external_x_signal_source s ON s.id = e.source_id
         WHERE (? = 1 OR s.status != 'removed')
           AND (? IS NULL OR e.source_id = ?)
         ORDER BY e.observed_at DESC, e.id ASC
         LIMIT ?`,
      )
      .all(request.includeRemoved ? 1 : 0, request.sourceId ?? null, request.sourceId ?? null, request.recentEvidenceLimit) as EvidenceRow[];

    return rows.map(toEvidence);
  }

  private readRefreshRuns(request: z.infer<typeof getExternalXSignalsOverviewRequestSchema>): ExternalXSignalRefreshRun[] {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM external_x_signal_refresh_run r
         JOIN external_x_signal_source s ON s.id = r.source_id
         WHERE (? = 1 OR s.status != 'removed')
           AND (? IS NULL OR r.source_id = ?)
         ORDER BY r.started_at DESC, r.id ASC
         LIMIT ?`,
      )
      .all(request.includeRemoved ? 1 : 0, request.sourceId ?? null, request.sourceId ?? null, request.refreshRunLimit) as RefreshRunRow[];

    return rows.map(toRefreshRun);
  }

  private readTotals(): GetExternalXSignalsOverviewResponse["totals"] {
    const sources = this.db
      .prepare("SELECT COUNT(*) AS count FROM external_x_signal_source")
      .get() as { count: number };
    const activeSources = this.db
      .prepare("SELECT COUNT(*) AS count FROM external_x_signal_source WHERE status != 'removed'")
      .get() as { count: number };
    const evidence = this.db
      .prepare("SELECT COUNT(*) AS count FROM external_x_signal_evidence")
      .get() as { count: number };
    const patterns = this.db
      .prepare("SELECT COUNT(*) AS count FROM external_x_signal_pattern")
      .get() as { count: number };
    const refreshRuns = this.db
      .prepare("SELECT COUNT(*) AS count FROM external_x_signal_refresh_run")
      .get() as { count: number };

    return {
      sources: sources.count,
      activeSources: activeSources.count,
      evidence: evidence.count,
      patterns: patterns.count,
      refreshRuns: refreshRuns.count,
    };
  }
}
