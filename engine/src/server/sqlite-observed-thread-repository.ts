import {
  replyThreadPostSchema,
  type ReplyThreadPost,
} from "@x-builder/shared";
import type Database from "better-sqlite3";

import {
  mergeObservedThreadPost,
  type ObservedThreadRepository,
  type ObservedThreadWriteResult,
} from "../reply-thread-context-repository.js";

type DatabaseHandle = Database.Database;

type ObservedThreadPostRow = {
  status_id: string;
  source: ReplyThreadPost["source"];
  role: ReplyThreadPost["role"] | null;
  url: string | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_user_id: string | null;
  text: string;
  created_at: string | null;
  in_reply_to_status_id: string | null;
  in_reply_to_user_id: string | null;
  conversation_id: string | null;
  weak_metrics_json: string;
  observed_at: string;
  updated_at: string;
};

const stableJson = (value: unknown): string => JSON.stringify(value);
const nowIso = (): string => new Date().toISOString();

const rowToPost = (row: ObservedThreadPostRow): ReplyThreadPost =>
  replyThreadPostSchema.parse({
    source: row.source,
    ...(row.role === null ? {} : { role: row.role }),
    statusId: row.status_id,
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.author_handle === null ? {} : { authorHandle: row.author_handle }),
    ...(row.author_display_name === null ? {} : { authorDisplayName: row.author_display_name }),
    ...(row.author_user_id === null ? {} : { authorUserId: row.author_user_id }),
    text: row.text,
    ...(row.created_at === null ? {} : { createdAt: row.created_at }),
    ...(row.in_reply_to_status_id === null ? {} : { inReplyToStatusId: row.in_reply_to_status_id }),
    ...(row.in_reply_to_user_id === null ? {} : { inReplyToUserId: row.in_reply_to_user_id }),
    ...(row.conversation_id === null ? {} : { conversationId: row.conversation_id }),
    weakMetrics: JSON.parse(row.weak_metrics_json) as unknown,
    observedAt: row.observed_at,
  });

const postToRow = (post: ReplyThreadPost): ObservedThreadPostRow => ({
  status_id: post.statusId,
  source: post.source,
  role: post.role ?? null,
  url: post.url ?? null,
  author_handle: post.authorHandle ?? null,
  author_display_name: post.authorDisplayName ?? null,
  author_user_id: post.authorUserId ?? null,
  text: post.text,
  created_at: post.createdAt ?? null,
  in_reply_to_status_id: post.inReplyToStatusId ?? null,
  in_reply_to_user_id: post.inReplyToUserId ?? null,
  conversation_id: post.conversationId ?? null,
  weak_metrics_json: stableJson(post.weakMetrics ?? {}),
  observed_at: post.observedAt,
  updated_at: nowIso(),
});

export class SqliteObservedThreadRepository implements ObservedThreadRepository {
  constructor(private readonly db: DatabaseHandle) {}

  async upsertThreadPosts(posts: ReplyThreadPost[]): Promise<ObservedThreadWriteResult> {
    const result: ObservedThreadWriteResult = {
      insertedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
    };

    this.db.transaction(() => {
      const seen = new Set<string>();

      for (const rawPost of posts) {
        const parsed = replyThreadPostSchema.parse(rawPost);
        if (seen.has(parsed.statusId)) {
          result.duplicateCount += 1;
        }
        seen.add(parsed.statusId);

        const existing = this.readByStatusId(parsed.statusId);
        const next = existing === undefined ? parsed : mergeObservedThreadPost(existing, parsed);

        if (existing !== undefined && stableJson(existing) === stableJson(next)) {
          result.unchangedCount += 1;
          continue;
        }

        this.write(next);
        if (existing === undefined) {
          result.insertedCount += 1;
        } else {
          result.updatedCount += 1;
        }
      }
    })();

    return result;
  }

  async findByStatusId(statusId: string): Promise<ReplyThreadPost | undefined> {
    return this.readByStatusId(statusId);
  }

  async findByParentStatusId(statusId: string): Promise<ReplyThreadPost[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM observed_thread_post WHERE in_reply_to_status_id = ? ORDER BY created_at ASC, status_id ASC",
      )
      .all(statusId) as ObservedThreadPostRow[];
    return rows.map(rowToPost);
  }

  async findByConversationId(conversationId: string): Promise<ReplyThreadPost[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM observed_thread_post WHERE conversation_id = ? ORDER BY created_at ASC, status_id ASC",
      )
      .all(conversationId) as ObservedThreadPostRow[];
    return rows.map(rowToPost);
  }

  private readByStatusId(statusId: string): ReplyThreadPost | undefined {
    const row = this.db
      .prepare("SELECT * FROM observed_thread_post WHERE status_id = ?")
      .get(statusId) as ObservedThreadPostRow | undefined;
    return row === undefined ? undefined : rowToPost(row);
  }

  private write(post: ReplyThreadPost): void {
    this.db
      .prepare(
        `INSERT INTO observed_thread_post (
          status_id, source, role, url, author_handle, author_display_name, author_user_id,
          text, created_at, in_reply_to_status_id, in_reply_to_user_id, conversation_id,
          weak_metrics_json, observed_at, updated_at
        ) VALUES (
          @status_id, @source, @role, @url, @author_handle, @author_display_name, @author_user_id,
          @text, @created_at, @in_reply_to_status_id, @in_reply_to_user_id, @conversation_id,
          @weak_metrics_json, @observed_at, @updated_at
        )
        ON CONFLICT(status_id) DO UPDATE SET
          source = excluded.source,
          role = excluded.role,
          url = excluded.url,
          author_handle = excluded.author_handle,
          author_display_name = excluded.author_display_name,
          author_user_id = excluded.author_user_id,
          text = excluded.text,
          created_at = excluded.created_at,
          in_reply_to_status_id = excluded.in_reply_to_status_id,
          in_reply_to_user_id = excluded.in_reply_to_user_id,
          conversation_id = excluded.conversation_id,
          weak_metrics_json = excluded.weak_metrics_json,
          observed_at = excluded.observed_at,
          updated_at = excluded.updated_at`,
      )
      .run(postToRow(post));
  }
}
