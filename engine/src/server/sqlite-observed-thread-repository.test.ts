import { describe, expect, it } from "vitest";
import type { ReplyThreadPost } from "@x-builder/shared";

import { openEngineDatabase } from "./open-engine-database.js";
import { SqliteObservedThreadRepository } from "./sqlite-observed-thread-repository.js";

const observedAt = "2026-07-01T08:00:00.000Z";

const post = (
  overrides: Partial<ReplyThreadPost> & Pick<ReplyThreadPost, "statusId" | "text">,
): ReplyThreadPost => ({
  source: "x_graphql_observed",
  observedAt,
  ...overrides,
});

describe("SqliteObservedThreadRepository", () => {
  it("preserves own-source membership and fresher fields across stale observed duplicates", async () => {
    const repository = new SqliteObservedThreadRepository(openEngineDatabase(":memory:"));
    await repository.upsertThreadPosts([
      post({
        source: "x_live_capture",
        statusId: "104",
        text: "Fresh own reply.",
        conversationId: "100",
        weakMetrics: { likes: 3 },
        observedAt: "2026-07-01T09:00:00.000Z",
      }),
      post({
        source: "x_graphql_observed",
        statusId: "104",
        text: "Stale observed copy.",
        conversationId: "100",
        weakMetrics: { replies: 1 },
        observedAt: "2026-07-01T08:00:00.000Z",
      }),
    ]);

    await expect(repository.findByStatusId("104")).resolves.toMatchObject({
      source: "x_live_capture",
      statusId: "104",
      text: "Fresh own reply.",
      weakMetrics: {
        likes: 3,
        replies: 1,
      },
      observedAt: "2026-07-01T09:00:00.000Z",
    });
  });

  it("keeps existing row source as source evidence before lower-priority updates", async () => {
    const db = openEngineDatabase(":memory:");
    const repository = new SqliteObservedThreadRepository(db);
    await repository.upsertThreadPosts([
      post({
        source: "x_live_capture",
        statusId: "104",
        text: "Own reply.",
        conversationId: "100",
        observedAt: "2026-07-01T08:00:00.000Z",
      }),
    ]);

    db.prepare("DELETE FROM observed_thread_post_source WHERE status_id = ?").run("104");
    await repository.upsertThreadPosts([
      post({
        source: "x_graphql_observed",
        statusId: "104",
        text: "Updated observed text.",
        conversationId: "100",
        observedAt: "2026-07-01T09:00:00.000Z",
      }),
    ]);

    await expect(repository.findByStatusId("104")).resolves.toMatchObject({
      source: "x_live_capture",
      statusId: "104",
      text: "Updated observed text.",
    });
  });

  it("does not write preferred source evidence with the stored row timestamp", async () => {
    const db = openEngineDatabase(":memory:");
    const repository = new SqliteObservedThreadRepository(db);
    await repository.upsertThreadPosts([
      post({
        source: "x_live_capture",
        statusId: "104",
        text: "Own reply.",
        conversationId: "100",
        observedAt: "2026-07-01T08:00:00.000Z",
      }),
      post({
        source: "x_graphql_observed",
        statusId: "104",
        text: "Observed copy.",
        conversationId: "100",
        observedAt: "2026-07-01T09:00:00.000Z",
      }),
      post({
        source: "x_graphql_observed",
        statusId: "104",
        text: "Newer observed copy.",
        conversationId: "100",
        observedAt: "2026-07-01T10:00:00.000Z",
      }),
    ]);

    const liveSource = db
      .prepare(
        `SELECT first_observed_at, last_observed_at
         FROM observed_thread_post_source
         WHERE status_id = ? AND source = ?`,
      )
      .get("104", "x_live_capture") as
      | { first_observed_at: string; last_observed_at: string }
      | undefined;

    expect(liveSource).toEqual({
      first_observed_at: "2026-07-01T08:00:00.000Z",
      last_observed_at: "2026-07-01T08:00:00.000Z",
    });
  });

  it("lets incoming equal-timestamp duplicates enrich stored fields", async () => {
    const repository = new SqliteObservedThreadRepository(openEngineDatabase(":memory:"));
    await repository.upsertThreadPosts([
      post({
        statusId: "104",
        text: "Initial observed copy.",
        conversationId: "100",
        observedAt,
      }),
      post({
        statusId: "104",
        text: "Richer observed copy.",
        authorHandle: "alice",
        conversationId: "100",
        observedAt,
      }),
    ]);

    await expect(repository.findByStatusId("104")).resolves.toMatchObject({
      statusId: "104",
      text: "Richer observed copy.",
      authorHandle: "alice",
    });
  });
});
