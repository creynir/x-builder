import { randomUUID } from "node:crypto";

import {
  addExternalXSignalSourceRequestSchema,
  externalXSignalEvidenceSchema,
  getExternalXSignalsOverviewRequestSchema,
  refreshExternalXSignalSourceRequestSchema,
  removeExternalXSignalSourceRequestSchema,
  type AddExternalXSignalSourceRequest,
  type AddExternalXSignalSourceResponse,
  type ExternalXSignalEvidence,
  type ExternalXSignalMetricSnapshot,
  type ExternalXSignalPattern,
  type ExternalXSignalSource,
  type GetExternalXSignalsOverviewRequest,
  type GetExternalXSignalsOverviewResponse,
  type RefreshExternalXSignalSourceRequest,
  type RefreshExternalXSignalSourceResponse,
  type RemoveExternalXSignalSourceRequest,
  type RemoveExternalXSignalSourceResponse,
} from "@x-builder/shared";

import { classifyPostFormat, predictionFormatLabels } from "../deterministic/format-classifier.js";
import { PostLibraryStorageError } from "../server/post-library-repository.js";
import type { ExternalXSignalsRepository } from "./external-x-signals-repository.js";

export type ExternalXObservedTimelinePost = {
  platformPostId: string;
  text: string;
  createdAt?: string;
  kind?: "original" | "reply" | "repost_reference" | "unknown";
  language?: string;
  inReplyToPostId?: string;
  inReplyToUserId?: string;
  hasUrls?: boolean;
  hasMedia?: boolean;
  hasHashtags?: boolean;
  hasMentions?: boolean;
  metrics?: ExternalXSignalMetricSnapshot;
  rawId?: string;
};

export type ExternalXObservedTimelineBatch = {
  screenName: string;
  observedAt: string;
  posts: ExternalXObservedTimelinePost[];
};

export type ExternalXObservedTimelineResult = {
  matched: boolean;
  sourceId?: string;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
};

export type ExternalXSignalsServiceOptions = {
  repository: ExternalXSignalsRepository;
  now?: () => Date;
  idGenerator?: () => string;
};

const normalizeScreenName = (value: string): string =>
  value.trim().replace(/^@+/, "").trim().toLowerCase();

const contentHash = async (text: string): Promise<string> => {
  const data = new TextEncoder().encode(text.normalize("NFKC").trim().replace(/\s+/g, " "));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const preview = (text: string): string => {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
};

const serviceError = (message: string, cause?: unknown): PostLibraryStorageError =>
  new PostLibraryStorageError(message, cause);

const isActiveSource = (source: ExternalXSignalSource): boolean => source.status !== "removed";

export class ExternalXSignalsService {
  private readonly repository: ExternalXSignalsRepository;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(options: ExternalXSignalsServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => randomUUID());
  }

  async addSource(input: AddExternalXSignalSourceRequest): Promise<AddExternalXSignalSourceResponse> {
    const request = addExternalXSignalSourceRequestSchema.parse(input);
    return this.repository.addSource(request);
  }

  async removeSource(input: RemoveExternalXSignalSourceRequest): Promise<RemoveExternalXSignalSourceResponse> {
    const request = removeExternalXSignalSourceRequestSchema.parse(input);
    return this.repository.removeSource(request);
  }

  async refreshSource(input: RefreshExternalXSignalSourceRequest): Promise<RefreshExternalXSignalSourceResponse> {
    const request = refreshExternalXSignalSourceRequestSchema.parse(input);
    const overview = await this.repository.getOverview({
      sourceId: request.sourceId,
      includeRemoved: true,
      sourceLimit: 1,
      patternLimit: 1,
      recentEvidenceLimit: 1,
      refreshRunLimit: 1,
    });
    const source = overview.sources[0];

    if (!source) {
      throw serviceError(`External X signal source ${request.sourceId} was not found.`);
    }
    if (!isActiveSource(source)) {
      throw serviceError(`External X signal source ${request.sourceId} is removed.`);
    }

    const run = {
      id: this.idGenerator(),
      sourceId: source.id,
      status: source.evidenceCount > 0 ? "captured" : "no_observation",
      startedAt: this.now().toISOString(),
      completedAt: this.now().toISOString(),
      evidenceCount: source.evidenceCount,
      warningCount: 0,
      ...(source.evidenceCount > 0 ? {} : { message: "No already-observed X traffic matched this source." }),
    } as const;

    await this.repository.saveRefreshRun(run);
    await this.deriveAndPersistPatterns();

    return { source, run };
  }

  async getOverview(input?: GetExternalXSignalsOverviewRequest): Promise<GetExternalXSignalsOverviewResponse> {
    const request = getExternalXSignalsOverviewRequestSchema.parse(input ?? {});
    return this.repository.getOverview(request);
  }

  async ingestObservedTimeline(batch: ExternalXObservedTimelineBatch): Promise<ExternalXObservedTimelineResult> {
    const screenName = normalizeScreenName(batch.screenName);
    const overview = await this.repository.getOverview({
      includeRemoved: false,
      sourceLimit: 100,
      patternLimit: 1,
      recentEvidenceLimit: 1,
      refreshRunLimit: 1,
    });
    const source = overview.sources.find((item) => item.screenName === screenName && isActiveSource(item));

    if (!source) {
      return {
        matched: false,
        insertedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        duplicateCount: 0,
      };
    }

    const evidence: ExternalXSignalEvidence[] = [];
    for (const post of batch.posts.slice(0, 200)) {
      const parsed = externalXSignalEvidenceSchema.parse({
        id: this.idGenerator(),
        sourceId: source.id,
        platform: "x",
        platformPostId: post.platformPostId,
        screenName: source.screenName,
        text: post.text,
        previewText: preview(post.text),
        ...(post.createdAt === undefined ? {} : { createdAt: post.createdAt }),
        kind: post.kind ?? "unknown",
        ...(post.language === undefined ? {} : { language: post.language }),
        ...(post.inReplyToPostId === undefined ? {} : { inReplyToPostId: post.inReplyToPostId }),
        ...(post.inReplyToUserId === undefined ? {} : { inReplyToUserId: post.inReplyToUserId }),
        hasUrls: post.hasUrls ?? false,
        hasMedia: post.hasMedia ?? false,
        hasHashtags: post.hasHashtags ?? false,
        hasMentions: post.hasMentions ?? false,
        metrics: post.metrics ?? {},
        evidenceSource: "external_x_graphql_observe",
        observedAt: batch.observedAt,
        importedAt: this.now().toISOString(),
        contentHash: await contentHash(post.text),
        rawId: post.rawId ?? post.platformPostId,
      });
      evidence.push(parsed);
    }

    const result = await this.repository.upsertObservedEvidence(evidence);
    await this.repository.saveRefreshRun({
      id: this.idGenerator(),
      sourceId: source.id,
      status: evidence.length > 0 ? "captured" : "no_observation",
      startedAt: batch.observedAt,
      completedAt: this.now().toISOString(),
      evidenceCount: evidence.length,
      warningCount: 0,
      ...(evidence.length > 0 ? {} : { message: "Observed batch contained no usable posts." }),
    });
    await this.deriveAndPersistPatterns();

    return { matched: true, sourceId: source.id, ...result };
  }

  private async deriveAndPersistPatterns(): Promise<void> {
    const overview = await this.repository.getOverview({
      includeRemoved: false,
      sourceLimit: 100,
      patternLimit: 100,
      recentEvidenceLimit: 100,
      refreshRunLimit: 1,
    });
    const byFormat = new Map<string, ExternalXSignalEvidence[]>();

    for (const item of overview.recentEvidence) {
      const format = classifyPostFormat(item.text);
      const existing = byFormat.get(format) ?? [];
      existing.push(item);
      byFormat.set(format, existing);
    }

    const patterns: ExternalXSignalPattern[] = [];
    for (const [format, items] of byFormat.entries()) {
      if (items.length < 2) {
        continue;
      }

      const evidence = items.slice(0, 5).map((item) => ({
        evidenceId: item.id,
        sourceId: item.sourceId,
        screenName: item.screenName,
        platformPostId: item.platformPostId,
        text: item.previewText ?? preview(item.text),
        metrics: item.metrics,
      }));
      const sourceIds = Array.from(new Set(items.map((item) => item.sourceId)));
      const evidenceIds = items.map((item) => item.id);
      const label = `${predictionFormatLabels[format as keyof typeof predictionFormatLabels] ?? format} external pattern`;

      patterns.push({
        id: `external-x-signals:${format}`,
        patternType: "format",
        format: format as ExternalXSignalPattern["format"],
        label,
        statement: `${items.length} external examples share the ${label.toLowerCase()} shape.`,
        confidence: Math.min(0.95, 0.45 + items.length / 10),
        supportCount: items.length,
        sourceIds,
        evidenceIds,
        evidence,
        generatedAt: this.now().toISOString(),
        version: "external-x-signals:v1",
      });
    }

    await this.repository.replacePatterns(patterns);
  }
}
