import type { ReplyComposerContext, ReplyThreadPost } from "@x-builder/shared";
import { describe, expect, it } from "vitest";

import { openEngineDatabase } from "./server/open-engine-database.js";
import { SqliteObservedThreadRepository } from "./server/sqlite-observed-thread-repository.js";
import {
  ReplyContextIncompleteError,
  ReplyThreadContextResolver,
} from "./reply-thread-context-resolver.js";

const observedAt = "2026-07-01T08:00:00.000Z";

const post = (overrides: Partial<ReplyThreadPost> & Pick<ReplyThreadPost, "statusId" | "text">): ReplyThreadPost => ({
  source: "x_graphql_observed",
  observedAt,
  ...overrides,
});

const replyContext = (statusId: string): ReplyComposerContext => ({
  source: "same_dialog_dom",
  targetAuthorHandle: "alice",
  targetText: "Current target text from the same dialog.",
  targetStatusId: statusId,
  targetUrl: `https://x.com/alice/status/${statusId}`,
  leadingTargetHandle: { handle: "alice", state: "present" },
});

describe("ReplyThreadContextResolver", () => {
  it("resolves root, immediate parent, ordered ancestors, current target, and previous own replies from observed rows", async () => {
    const repository = new SqliteObservedThreadRepository(openEngineDatabase(":memory:"));
    await repository.upsertThreadPosts([
      post({
        statusId: "100",
        text: "Root text.",
        authorHandle: "root_author",
        conversationId: "100",
      }),
      post({
        statusId: "101",
        text: "Middle ancestor text.",
        authorHandle: "middle_author",
        inReplyToStatusId: "100",
        conversationId: "100",
      }),
      post({
        statusId: "102",
        text: "Immediate parent text.",
        authorHandle: "parent_author",
        inReplyToStatusId: "101",
        conversationId: "100",
      }),
      post({
        statusId: "103",
        text: "Observed current target text.",
        authorHandle: "alice",
        inReplyToStatusId: "102",
        conversationId: "100",
      }),
      post({
        source: "x_live_capture",
        statusId: "104",
        text: "Prior own reply.",
        inReplyToStatusId: "102",
        conversationId: "100",
        observedAt,
      }),
    ]);

    const enriched = await new ReplyThreadContextResolver(repository).enrichReplyContext(
      replyContext("103"),
    );

    expect(enriched.replyThreadContext?.replyThreadContextDiagnostics.status).toBe("thread_ready");
    expect(enriched.replyThreadContext?.root).toMatchObject({
      role: "root",
      statusId: "100",
      text: "Root text.",
    });
    expect(enriched.replyThreadContext?.orderedAncestors.map((entry) => entry.statusId)).toEqual([
      "101",
    ]);
    expect(enriched.replyThreadContext?.immediateParent).toMatchObject({
      role: "immediate_parent",
      statusId: "102",
      text: "Immediate parent text.",
    });
    expect(enriched.replyThreadContext?.currentTarget).toMatchObject({
      role: "current_target",
      statusId: "103",
      text: "Current target text from the same dialog.",
    });
    expect(enriched.replyThreadContext?.previousOwnReplies).toHaveLength(1);
    expect(enriched.replyThreadContext?.previousOwnReplies[0]).toMatchObject({
      role: "previous_own_reply",
      statusId: "104",
    });
    expect(enriched.replyThreadContext?.orderedStatusIds).toEqual(["100", "101", "102", "103"]);
  });

  it("keeps same-dialog diagnostics when the parent was not observed", async () => {
    const repository = new SqliteObservedThreadRepository(openEngineDatabase(":memory:"));
    await repository.upsertThreadPosts([
      post({
        statusId: "103",
        text: "Observed current target text.",
        inReplyToStatusId: "102",
        conversationId: "100",
      }),
    ]);

    const enriched = await new ReplyThreadContextResolver(repository).enrichReplyContext(
      replyContext("103"),
    );

    expect(enriched.replyThreadContext?.immediateParent).toBeUndefined();
    expect(enriched.replyThreadContext?.replyThreadContextDiagnostics.status).toBe(
      "incomplete_observed_graph",
    );
    expect(enriched.replyThreadContext?.replyThreadContextDiagnostics.missing).toEqual([
      {
        field: "immediate_parent",
        statusId: "102",
        reason: "not_observed",
      },
    ]);
  });

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

  it("only throws for a pre-blocked context when parent context is required", async () => {
    const base = replyContext("103");
    const blocked = {
      ...base,
      replyThreadContext: {
        source: "resolved_observed_thread",
        resolvedAt: "2026-07-01T08:00:00.000Z",
        currentTarget: post({
          source: "same_dialog_dom",
          role: "current_target",
          statusId: "103",
          text: base.targetText,
        }),
        orderedAncestors: [],
        previousOwnReplies: [],
        orderedStatusIds: ["103"],
        replyThreadContextDiagnostics: {
          status: "blocked_missing_required_parent",
          missing: [
            {
              field: "immediate_parent",
              statusId: "102",
              reason: "not_observed",
            },
          ],
          uiMessages: ["Required parent thread context is missing."],
          promptMessages: ["Do not generate: required parent thread context is missing."],
        },
      },
    } satisfies ReplyComposerContext;

    const resolver = new ReplyThreadContextResolver();
    await expect(
      resolver.enrichReplyContext(blocked, { requireParent: false }),
    ).resolves.toMatchObject({
      replyThreadContext: {
        replyThreadContextDiagnostics: {
          status: "blocked_missing_required_parent",
        },
      },
    });
    await expect(
      resolver.enrichReplyContext(blocked, { requireParent: true }),
    ).rejects.toBeInstanceOf(ReplyContextIncompleteError);
  });
});
