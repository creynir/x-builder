import {
  replyComposerContextSchema,
  replyThreadContextDiagnosticsSchema,
  replyThreadContextSchema,
  replyThreadPostSchema,
  type AnalyzePostsRequest,
  type ReplyComposerContext,
  type ReplyThreadContext,
  type ReplyThreadContextDiagnostics,
  type ReplyThreadPost,
} from "@x-builder/shared";

import type { ObservedThreadRepository } from "./reply-thread-context-repository.js";

const maxAncestorDepth = 25;
const maxPreviousOwnReplies = 10;

const nowIso = (): string => new Date().toISOString();

const sameDialogDiagnostics = (): ReplyThreadContextDiagnostics =>
  replyThreadContextDiagnosticsSchema.parse({
    status: "same_dialog_only",
    missing: [
      {
        field: "immediate_parent",
        reason: "not_observed",
      },
      {
        field: "root",
        reason: "not_observed",
      },
    ],
    uiMessages: ["Only the same-dialog target post is available."],
    promptMessages: ["No observed parent/root thread context was available."],
  });

const incompleteDiagnostics = (
  statusId: string | undefined,
  required: boolean,
): ReplyThreadContextDiagnostics =>
  replyThreadContextDiagnosticsSchema.parse({
    status: required ? "blocked_missing_required_parent" : "incomplete_observed_graph",
    missing: [
      {
        field: "immediate_parent",
        ...(statusId === undefined ? {} : { statusId }),
        reason: "not_observed",
      },
    ],
    uiMessages: [
      required
        ? "Required parent thread context is missing."
        : "Parent thread context is incomplete.",
    ],
    promptMessages: [
      required
        ? "Do not generate: required parent thread context is missing."
        : "Observed parent/root context is incomplete; rely only on the available same-dialog target.",
    ],
  });

const readyDiagnostics = (): ReplyThreadContextDiagnostics =>
  replyThreadContextDiagnosticsSchema.parse({
    status: "thread_ready",
    missing: [],
    uiMessages: [],
    promptMessages: [],
  });

const fromReplyContextTarget = (replyContext: ReplyComposerContext, observedAt: string): ReplyThreadPost =>
  replyThreadPostSchema.parse({
    source: "same_dialog_dom",
    role: "current_target",
    statusId: replyContext.targetStatusId,
    ...(replyContext.targetUrl === undefined ? {} : { url: replyContext.targetUrl }),
    authorHandle: replyContext.targetAuthorHandle,
    ...(replyContext.targetDisplayName === undefined
      ? {}
      : { authorDisplayName: replyContext.targetDisplayName }),
    text: replyContext.targetText,
    observedAt,
  });

const mergeTarget = (
  domTarget: ReplyThreadPost,
  observedTarget: ReplyThreadPost | undefined,
): ReplyThreadPost =>
  replyThreadPostSchema.parse({
    ...(observedTarget ?? {}),
    ...domTarget,
    role: "current_target",
    source: domTarget.source,
    inReplyToStatusId: observedTarget?.inReplyToStatusId,
    inReplyToUserId: observedTarget?.inReplyToUserId,
    conversationId: observedTarget?.conversationId,
    weakMetrics: observedTarget?.weakMetrics,
    observedAt:
      observedTarget !== undefined && observedTarget.observedAt > domTarget.observedAt
        ? observedTarget.observedAt
        : domTarget.observedAt,
  });

const withRole = (
  post: ReplyThreadPost,
  role: NonNullable<ReplyThreadPost["role"]>,
): ReplyThreadPost => replyThreadPostSchema.parse({ ...post, role });

export class ReplyContextIncompleteError extends Error {
  constructor(public readonly diagnostics: ReplyThreadContextDiagnostics) {
    super("Required reply thread context is incomplete.");
    this.name = "ReplyContextIncompleteError";
  }
}

export const replyContextIncompleteApiError = (
  diagnostics: ReplyThreadContextDiagnostics,
) => ({
  code: "reply_context_incomplete" as const,
  message: diagnostics.uiMessages[0] ?? "Required reply thread context is missing.",
  scope: "reply-context" as const,
  retryable: false,
  status: 409,
  details: { replyThreadContextDiagnostics: diagnostics },
});

export class ReplyThreadContextResolver {
  constructor(private readonly repository?: ObservedThreadRepository) {}

  async enrichReplyContext(
    replyContext: ReplyComposerContext,
    options: { requireParent?: boolean } = {},
  ): Promise<ReplyComposerContext> {
    if (replyContext.targetStatusId === undefined) {
      return replyContext;
    }

    const context = await this.resolve(replyContext, options);
    const enriched = replyComposerContextSchema.parse({
      ...replyContext,
      replyThreadContext: context,
    });

    if (
      options.requireParent === true &&
      context.replyThreadContextDiagnostics.status === "blocked_missing_required_parent"
    ) {
      throw new ReplyContextIncompleteError(context.replyThreadContextDiagnostics);
    }

    return enriched;
  }

  async mergeAnalysisRequest(request: AnalyzePostsRequest): Promise<AnalyzePostsRequest> {
    const items = await Promise.all(
      request.items.map(async (item) => {
        if (item.replyContext === undefined) {
          return item;
        }

        return {
          ...item,
          replyContext: await this.enrichReplyContext(item.replyContext),
        };
      }),
    );

    return { ...request, items };
  }

  async resolve(
    replyContext: ReplyComposerContext,
    options: { requireParent?: boolean } = {},
  ): Promise<ReplyThreadContext> {
    if (
      replyContext.replyThreadContext?.replyThreadContextDiagnostics.status ===
      "blocked_missing_required_parent"
    ) {
      throw new ReplyContextIncompleteError(
        replyContext.replyThreadContext.replyThreadContextDiagnostics,
      );
    }

    const targetStatusId = replyContext.targetStatusId;
    if (targetStatusId === undefined) {
      throw new Error("Reply thread context requires a target status id.");
    }

    const required = options.requireParent === true;
    const observedAt = replyContext.replyThreadDomEvidence?.observedAt ?? nowIso();
    const domTarget = fromReplyContextTarget(replyContext, observedAt);

    if (this.repository === undefined) {
      return replyThreadContextSchema.parse({
        source: "resolved_observed_thread",
        resolvedAt: nowIso(),
        currentTarget: domTarget,
        orderedAncestors: [],
        previousOwnReplies: [],
        orderedStatusIds: [domTarget.statusId],
        replyThreadContextDiagnostics: required
          ? incompleteDiagnostics(replyContext.targetStatusId, true)
          : sameDialogDiagnostics(),
      });
    }

    const observedTarget = await this.repository.findByStatusId(targetStatusId);
    const currentTarget = mergeTarget(domTarget, observedTarget);
    const parentId = observedTarget?.inReplyToStatusId;

    if (parentId === undefined) {
      return replyThreadContextSchema.parse({
        source: "resolved_observed_thread",
        resolvedAt: nowIso(),
        currentTarget,
        orderedAncestors: [],
        previousOwnReplies: await this.previousOwnReplies(currentTarget),
        orderedStatusIds: [currentTarget.statusId],
        replyThreadContextDiagnostics: required
          ? incompleteDiagnostics(currentTarget.statusId, true)
          : sameDialogDiagnostics(),
      });
    }

    const parent = await this.repository.findByStatusId(parentId);
    if (parent === undefined) {
      return replyThreadContextSchema.parse({
        source: "resolved_observed_thread",
        resolvedAt: nowIso(),
        currentTarget,
        orderedAncestors: [],
        previousOwnReplies: await this.previousOwnReplies(currentTarget),
        orderedStatusIds: [currentTarget.statusId],
        replyThreadContextDiagnostics: incompleteDiagnostics(parentId, required),
      });
    }

    const chain = await this.ancestorChain(parent);
    const root = chain[0] ?? parent;
    const middleAncestors = chain.slice(1);
    const immediateParent = withRole(parent, "immediate_parent");
    const orderedAncestors = middleAncestors
      .filter((post) => post.statusId !== immediateParent.statusId)
      .map((post) => withRole(post, "ancestor"));
    const orderedStatusIds = [
      withRole(root, "root").statusId,
      ...orderedAncestors.map((post) => post.statusId),
      immediateParent.statusId,
      currentTarget.statusId,
    ].filter((statusId, index, ids) => ids.indexOf(statusId) === index);

    return replyThreadContextSchema.parse({
      source: "resolved_observed_thread",
      resolvedAt: nowIso(),
      currentTarget,
      root: withRole(root, "root"),
      immediateParent,
      orderedAncestors,
      previousOwnReplies: await this.previousOwnReplies(currentTarget),
      orderedStatusIds,
      replyThreadContextDiagnostics: readyDiagnostics(),
    });
  }

  private async ancestorChain(parent: ReplyThreadPost): Promise<ReplyThreadPost[]> {
    const reversed: ReplyThreadPost[] = [parent];
    const seen = new Set([parent.statusId]);
    let cursor = parent;

    for (let depth = 0; depth < maxAncestorDepth; depth += 1) {
      if (cursor.inReplyToStatusId === undefined || seen.has(cursor.inReplyToStatusId)) {
        break;
      }
      const next = await this.repository?.findByStatusId(cursor.inReplyToStatusId);
      if (next === undefined) break;
      reversed.push(next);
      seen.add(next.statusId);
      cursor = next;
    }

    return reversed.reverse();
  }

  private async previousOwnReplies(target: ReplyThreadPost): Promise<ReplyThreadPost[]> {
    if (target.conversationId === undefined || this.repository === undefined) {
      return [];
    }

    const posts = await this.repository.findByConversationId(target.conversationId);
    return posts
      .filter(
        (post) =>
          (post.source === "x_live_capture" || post.source === "archive_tweets_js") &&
          post.statusId !== target.statusId,
      )
      .slice(-maxPreviousOwnReplies)
      .map((post) => withRole(post, "previous_own_reply"));
  }
}
