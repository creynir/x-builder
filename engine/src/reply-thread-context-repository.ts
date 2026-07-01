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
): ReplyThreadPost => {
  const fresher = next.observedAt > previous.observedAt ? next : previous;
  const older = fresher === next ? previous : next;

  return replyThreadPostSchema.parse({
    ...older,
    ...fresher,
    weakMetrics: {
      ...(older.weakMetrics ?? {}),
      ...(fresher.weakMetrics ?? {}),
    },
    observedAt: fresher.observedAt,
  });
};
