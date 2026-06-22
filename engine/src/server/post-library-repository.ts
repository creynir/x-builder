import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  activeArchiveContextSchema,
  archiveDerivedInsightsSchema,
  archiveImportRunSchema,
  type ActiveArchiveContext,
  type ArchiveDerivedInsights,
  type ArchiveImportRun,
  type LiveCapturedProfile,
} from "@x-builder/shared";
import { z } from "zod";

const postLibraryFileName = "post-library.json";

const sourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const archiveMetricSnapshotSchema = z.object({
  source: z.literal("archive_tweets_js"),
  observedAt: z.string().datetime(),
  importedAt: z.string().datetime(),
  favoriteCount: z.number().int().min(0).optional(),
  retweetCount: z.number().int().min(0).optional(),
});

const liveMetricSnapshotSchema = z.object({
  source: z.literal("x_live_capture"),
  capturedAt: z.string().datetime(),
  impressions: z.number().int().min(0).optional(),
  likes: z.number().int().min(0).optional(),
  reposts: z.number().int().min(0).optional(),
  replies: z.number().int().min(0).optional(),
  quotes: z.number().int().min(0).optional(),
  bookmarks: z.number().int().min(0).optional(),
});

const metricSnapshotSchema = z.discriminatedUnion("source", [
  archiveMetricSnapshotSchema,
  liveMetricSnapshotSchema,
]);

const archiveSourceRefSchema = z.object({
  source: z.literal("archive_tweets_js"),
  importRunId: z.string().min(1).max(160),
  rawId: z.string().min(1).max(160),
  sourceHash: sourceHashSchema,
});

const liveSourceRefSchema = z.object({
  source: z.literal("x_live_capture"),
  captureSessionId: z.string().min(1).max(160),
  rawId: z.string().min(1).max(160),
});

const sourceRefSchema = z.discriminatedUnion("source", [
  archiveSourceRefSchema,
  liveSourceRefSchema,
]);

const liveProfileSnapshotSchema = z.object({
  platformUserId: z.string().min(1).max(160),
  screenName: z.string().min(1).max(80),
  followers: z.number().int().min(0).optional(),
  capturedAt: z.string().datetime(),
});

const replyReferencesSchema = z
  .object({
    inReplyToPostId: z.string().min(1).max(160).optional(),
    inReplyToUserId: z.string().min(1).max(160).optional(),
  })
  .default({});

const entityFlagsSchema = z.object({
  hasUrls: z.boolean(),
  hasMedia: z.boolean(),
  hasHashtags: z.boolean(),
  hasMentions: z.boolean(),
});

const weakArchiveMetricsSchema = z
  .object({
    favoriteCount: z.number().int().min(0).optional(),
    retweetCount: z.number().int().min(0).optional(),
  })
  .default({});

export const canonicalOwnPostSchema = z.object({
  id: z.string().min(1).max(160),
  platform: z.literal("x"),
  platformPostId: z.string().min(1).max(160),
  text: z.string().min(1).max(8_000),
  createdAt: z.string().datetime(),
  kind: z.enum(["original", "reply", "repost_reference", "unknown"]),
  language: z.string().min(1).max(40).optional(),
  replyReferences: replyReferencesSchema,
  entityFlags: entityFlagsSchema,
  weakMetrics: weakArchiveMetricsSchema,
  metricSnapshots: z.array(metricSnapshotSchema).default([]),
  sourceRefs: z.array(sourceRefSchema).default([]),
  updatedAt: z.string().datetime(),
});

export const canonicalOwnPostInputSchema = canonicalOwnPostSchema.extend({
  updatedAt: z.string().datetime().optional(),
});

export const archiveDerivedInsightSnapshotSchema = z.object({
  importRunId: z.string().min(1).max(160),
  generatedAt: z.string().datetime(),
  insights: archiveDerivedInsightsSchema,
});

export const postLibraryStoreSchema = z.object({
  schemaVersion: z.literal(2),
  updatedAt: z.string().datetime(),
  posts: z.array(canonicalOwnPostSchema),
  importRuns: z.array(archiveImportRunSchema),
  derivedInsights: z.array(archiveDerivedInsightSnapshotSchema),
  activeContext: activeArchiveContextSchema,
  profileSnapshots: z.array(liveProfileSnapshotSchema).default([]),
});

export type ArchiveMetricSnapshot = z.infer<typeof archiveMetricSnapshotSchema>;
export type LiveMetricSnapshot = z.infer<typeof liveMetricSnapshotSchema>;
export type ArchiveSourceRef = z.infer<typeof archiveSourceRefSchema>;
export type LiveSourceRef = z.infer<typeof liveSourceRefSchema>;
export type LiveProfileSnapshot = z.infer<typeof liveProfileSnapshotSchema>;

export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type CanonicalOwnPost = z.infer<typeof canonicalOwnPostSchema>;
export type CanonicalOwnPostInput = z.infer<typeof canonicalOwnPostInputSchema>;
export type ArchiveDerivedInsightSnapshot = z.infer<typeof archiveDerivedInsightSnapshotSchema>;
export type PostLibraryStore = z.infer<typeof postLibraryStoreSchema>;

export type PostLibraryWriteResult = {
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
};

export interface PostLibraryRepository {
  loadStore(): Promise<PostLibraryStore>;
  upsertPosts(posts: CanonicalOwnPostInput[]): Promise<PostLibraryWriteResult>;
  saveImportRun(importRun: ArchiveImportRun): Promise<void>;
  saveDerivedInsights(snapshot: ArchiveDerivedInsightSnapshot): Promise<void>;
  setActiveContext(context: ActiveArchiveContext): Promise<void>;
  pushProfileSnapshot(snapshot: LiveCapturedProfile): Promise<void>;
}

export class PostLibraryStorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PostLibraryStorageError";
  }
}

export type JsonFilePostLibraryRepositoryOptions = {
  root: string;
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const nowIso = (): string => new Date().toISOString();

const emptyStore = (): PostLibraryStore =>
  postLibraryStoreSchema.parse({
    schemaVersion: 2,
    updatedAt: nowIso(),
    posts: [],
    importRuns: [],
    derivedInsights: [],
    activeContext: {
      status: "empty",
    },
    profileSnapshots: [],
  });

const uniqueBy = <T>(items: T[], keyFor: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = keyFor(item);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
};

const snapshotKey = (snapshot: MetricSnapshot): string =>
  snapshot.source === "archive_tweets_js"
    ? [snapshot.source, snapshot.observedAt, snapshot.importedAt].join(":")
    : [snapshot.source, snapshot.capturedAt].join(":");

const sourceRefKey = (ref: SourceRef): string =>
  ref.source === "archive_tweets_js"
    ? [ref.source, ref.importRunId, ref.rawId, ref.sourceHash].join(":")
    : [ref.source, ref.captureSessionId, ref.rawId].join(":");

const stableJson = (value: unknown): string => JSON.stringify(value);

export class JsonFilePostLibraryRepository implements PostLibraryRepository {
  private readonly storeFilePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: JsonFilePostLibraryRepositoryOptions) {
    this.storeFilePath = join(options.root, postLibraryFileName);
  }

  async loadStore(): Promise<PostLibraryStore> {
    try {
      const contents = await readFile(this.storeFilePath, "utf8");
      const parsed = JSON.parse(contents) as unknown;
      const rawVersion =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { schemaVersion?: unknown }).schemaVersion
          : undefined;

      if (rawVersion === 1) {
        return postLibraryStoreSchema.parse({
          ...(parsed as Record<string, unknown>),
          schemaVersion: 2,
          profileSnapshots: [],
        });
      }

      if (typeof rawVersion === "number" && rawVersion > 2) {
        throw new PostLibraryStorageError(
          `Post library store schemaVersion ${rawVersion} is newer than this engine supports.`,
        );
      }

      return postLibraryStoreSchema.parse(parsed);
    } catch (error) {
      if (error instanceof PostLibraryStorageError) {
        throw error;
      }

      if (isNodeError(error) && error.code === "ENOENT") {
        return emptyStore();
      }

      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        console.error("[library] post-library.json is unreadable", {
          path: this.storeFilePath,
          error,
        });
        throw new PostLibraryStorageError("Post library store is unreadable.", error);
      }

      throw error;
    }
  }

  async upsertPosts(posts: CanonicalOwnPostInput[]): Promise<PostLibraryWriteResult> {
    return this.withSerializedWrite(async () => {
      const store = await this.loadStore();
      const seenInputKeys = new Set<string>();
      const result: PostLibraryWriteResult = {
        insertedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        duplicateCount: 0,
      };

      for (const rawPost of posts) {
        const parsedInput = canonicalOwnPostInputSchema.parse(rawPost);
        const updatedAt = nowIso();
        const nextPost = canonicalOwnPostSchema.parse({
          ...parsedInput,
          updatedAt: parsedInput.updatedAt ?? updatedAt,
        });
        const key = this.postKey(nextPost);
        const existingIndex = store.posts.findIndex((candidate) => this.postKey(candidate) === key);

        if (seenInputKeys.has(key)) {
          result.duplicateCount += 1;
        }
        seenInputKeys.add(key);

        if (existingIndex === -1) {
          store.posts.push(nextPost);
          result.insertedCount += 1;
          continue;
        }

        const previous = store.posts[existingIndex];

        if (!previous) {
          throw new PostLibraryStorageError("Post library index lookup failed.");
        }

        const merged = this.mergePost(previous, {
          ...nextPost,
          updatedAt,
        });

        if (stableJson(previous) === stableJson(merged)) {
          result.unchangedCount += 1;
        } else {
          store.posts[existingIndex] = merged;
          result.updatedCount += 1;
        }
      }

      await this.saveStore(store);

      return result;
    });
  }

  async saveImportRun(importRun: ArchiveImportRun): Promise<void> {
    await this.withSerializedWrite(async () => {
      const store = await this.loadStore();
      const parsed = archiveImportRunSchema.parse(importRun);
      const existingIndex = store.importRuns.findIndex((candidate) => candidate.id === parsed.id);

      if (existingIndex === -1) {
        store.importRuns.push(parsed);
      } else {
        store.importRuns[existingIndex] = parsed;
      }

      await this.saveStore(store);
    });
  }

  async saveDerivedInsights(snapshot: ArchiveDerivedInsightSnapshot): Promise<void> {
    await this.withSerializedWrite(async () => {
      const store = await this.loadStore();
      const parsed = archiveDerivedInsightSnapshotSchema.parse(snapshot);
      const existingIndex = store.derivedInsights.findIndex(
        (candidate) => candidate.importRunId === parsed.importRunId,
      );

      if (existingIndex === -1) {
        store.derivedInsights.push(parsed);
      } else {
        store.derivedInsights[existingIndex] = parsed;
      }

      await this.saveStore(store);
    });
  }

  async setActiveContext(context: ActiveArchiveContext): Promise<void> {
    await this.withSerializedWrite(async () => {
      const store = await this.loadStore();
      store.activeContext = activeArchiveContextSchema.parse(context);

      await this.saveStore(store);
    });
  }

  async pushProfileSnapshot(snapshot: LiveCapturedProfile): Promise<void> {
    await this.withSerializedWrite(async () => {
      const store = await this.loadStore();

      // The stored snapshot schema is tighter (min/max bounds) than the shared
      // wire schema, so a wire-valid value can still violate the stored bounds.
      // Normalize a ZodError to PostLibraryStorageError, matching loadStore.
      let parsed: LiveProfileSnapshot;
      try {
        parsed = liveProfileSnapshotSchema.parse(snapshot);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new PostLibraryStorageError(
            "Live profile snapshot does not satisfy the stored bounds.",
            error,
          );
        }

        throw error;
      }

      store.profileSnapshots.push(parsed);

      await this.saveStore(store);
    });
  }

  private postKey(post: Pick<CanonicalOwnPost, "platform" | "platformPostId">): string {
    return `${post.platform}:${post.platformPostId}`;
  }

  private mergePost(previous: CanonicalOwnPost, nextPost: CanonicalOwnPost): CanonicalOwnPost {
    return canonicalOwnPostSchema.parse({
      ...previous,
      ...nextPost,
      metricSnapshots: uniqueBy(
        [...previous.metricSnapshots, ...nextPost.metricSnapshots],
        snapshotKey,
      ),
      sourceRefs: uniqueBy([...previous.sourceRefs, ...nextPost.sourceRefs], sourceRefKey),
    });
  }

  private async saveStore(store: PostLibraryStore): Promise<void> {
    const response = postLibraryStoreSchema.parse({
      ...store,
      posts: [...store.posts].sort((a, b) => {
        const createdOrder = b.createdAt.localeCompare(a.createdAt);

        return createdOrder === 0 ? a.id.localeCompare(b.id) : createdOrder;
      }),
      updatedAt: nowIso(),
    });
    const temporaryFilePath = `${this.storeFilePath}.${process.pid}.${Date.now()}.tmp`;

    await mkdir(this.options.root, { recursive: true });
    await writeFile(temporaryFilePath, `${JSON.stringify(response, null, 2)}\n`, "utf8");
    await rename(temporaryFilePath, this.storeFilePath);
  }

  private withSerializedWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(operation, operation);

    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }
}
