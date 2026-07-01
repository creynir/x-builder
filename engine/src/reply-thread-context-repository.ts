import {
  replyThreadPostSchema,
  type ReplyThreadPost,
} from "@x-builder/shared";

export type ObservedThreadWriteResult = {
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
};

export interface ObservedThreadRepository {
  upsertThreadPosts(posts: ReplyThreadPost[]): Promise<ObservedThreadWriteResult>;
  findByStatusId(statusId: string): Promise<ReplyThreadPost | undefined>;
  findByParentStatusId(statusId: string): Promise<ReplyThreadPost[]>;
  findByConversationId(conversationId: string): Promise<ReplyThreadPost[]>;
}

export const mergeObservedThreadPost = (
  previous: ReplyThreadPost,
  next: ReplyThreadPost,
): ReplyThreadPost =>
  replyThreadPostSchema.parse({
    ...previous,
    ...next,
    weakMetrics: {
      ...(previous.weakMetrics ?? {}),
      ...(next.weakMetrics ?? {}),
    },
    source: next.source,
    observedAt: next.observedAt > previous.observedAt ? next.observedAt : previous.observedAt,
  });
