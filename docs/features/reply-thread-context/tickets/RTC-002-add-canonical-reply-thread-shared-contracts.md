---
status: todo
---

# RTC-002: [FND] Add Canonical Reply Thread Shared Contracts

## Implementation Details

Add shared Zod schemas and exports for the canonical reply thread contract names:

- `replyThreadDomEvidence`
- `replyThreadContext`
- `replyThreadContextDiagnostics`
- `reply_context_incomplete`

Extend `ReplyComposerContext` additively with optional `replyThreadDomEvidence` and `replyThreadContext`. Extend analyze item responses with optional `replyThreadContext` and `replyThreadContextDiagnostics`. Add a shared API error shape/code for `reply_context_incomplete`.

## Data Models

`ReplyThreadDomEvidence`:

```ts
{
  source: "same_dialog_dom";
  observedAt: string;
  role: "current_target";
  currentTarget: {
    authorHandle: string;
    displayName?: string;
    statusId?: string;
    url?: string;
    text: string;
    observedAt: string;
  };
  diagnostics?: ReplyThreadContextDiagnostics;
}
```

`ReplyThreadPost`:

```ts
{
  source: "same_dialog_dom" | "x_graphql_observed" | "archive_tweets_js" | "x_live_capture";
  role?: "root" | "ancestor" | "immediate_parent" | "current_target" | "previous_own_reply";
  statusId: string;
  url?: string;
  authorHandle?: string;
  authorDisplayName?: string;
  authorUserId?: string;
  text: string;
  createdAt?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  conversationId?: string;
  weakMetrics?: {
    impressions?: number;
    likes?: number;
    reposts?: number;
    replies?: number;
    quotes?: number;
    bookmarks?: number;
    favoriteCount?: number;
    retweetCount?: number;
  };
  observedAt: string;
}
```

`ReplyThreadContext`:

```ts
{
  source: "resolved_observed_thread";
  resolvedAt: string;
  currentTarget: ReplyThreadPost;
  root?: ReplyThreadPost;
  immediateParent?: ReplyThreadPost;
  orderedAncestors: ReplyThreadPost[];
  previousOwnReplies: ReplyThreadPost[];
  orderedStatusIds: string[];
  replyThreadContextDiagnostics: ReplyThreadContextDiagnostics;
}
```

`ReplyThreadContextDiagnostics`:

```ts
{
  status: "same_dialog_only" | "thread_ready" | "incomplete_observed_graph" | "blocked_missing_required_parent";
  missing: Array<{
    field: "root" | "immediate_parent" | "ancestor" | "text" | "author_handle" | "timestamp";
    statusId?: string;
    reason: "not_observed" | "reference_only" | "malformed_observed_record";
  }>;
  uiMessages: string[];
  promptMessages: string[];
}
```

`reply_context_incomplete` error details:

```ts
{
  replyThreadContextDiagnostics: ReplyThreadContextDiagnostics;
}
```

## Integration Point

User entry point: any existing reply analyze/generate/judge/apply action that sends `replyContext`.

Existing module consumers: shared request/response schemas, overlay transport types, runner binding parsers, engine route schemas, engine prompt consumers.

Terminal outcome: old request payloads remain valid, and new reply-thread payloads have one canonical schema.

## Scope Boundaries / Out of Scope

In scope:

- Shared schema definitions and exports.
- Optional fields on existing reply/analyze contracts.
- Shared `reply_context_incomplete` API error code/details.

Out of scope:

- DOM evidence production.
- GraphQL capture.
- Storage.
- Resolver logic.
- UI rendering.
- New endpoints or transport methods.

## Test Strategy & Fixture Ownership

Coverage level: shared schema/unit tests.

Owning suite: shared schema tests.

Fixture strategy: checked-in minimal and complete object fixtures for legacy, complete thread, partial thread, blocked thread, and invalid status/url/text cases.

Dependency category: in-process.

Isolation boundary: pure schema parse tests.

## Definition of Done

- Existing `ReplyComposerContext` payloads parse unchanged.
- Optional `replyThreadDomEvidence`, `replyThreadContext`, and `replyThreadContextDiagnostics` parse with canonical names only.
- Analyze response schemas preserve the new optional diagnostics through parse.
- `reply_context_incomplete` has a structured details payload with canonical diagnostics.

## Acceptance Criteria

- Given: a legacy `ReplyComposerContext` with no thread fields / When: it is parsed / Then: it remains valid.
- Given: a complete observed thread context / When: it is parsed / Then: root, parent, ancestors, current target, previous own replies, weak metrics, and diagnostics are preserved.
- Given: a context with a present node but empty text / When: it is parsed / Then: validation fails.
- Given: an analyze response item with `replyThreadContextDiagnostics` / When: the response is parsed / Then: the diagnostics are preserved.
- Given: a payload uses a non-canonical diagnostics field name / When: schema tests run / Then: it is rejected or not treated as the contract.

## Edge Cases

- Missing optional author handle.
- Missing optional timestamp.
- Reference-only parent id.
- Long but bounded text.
- Twitter and X status URLs.

## Pipeline Log
