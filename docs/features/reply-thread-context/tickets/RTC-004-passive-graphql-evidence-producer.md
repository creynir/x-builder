---
status: todo
---

# RTC-004: Passive GraphQL Evidence Producer

## Implementation Details

Extend passive GraphQL normalization so already-fetched `UserTweets` and `UserTweetsAndReplies` responses can produce `observedThreadPosts` alongside the existing captured post batch. Preserve the response-only boundary of `GraphQlCaptureObserver`.

## Data Models

Extend `CaptureIngestRequest` additively:

```ts
{
  posts: LiveCapturedPost[];
  profile?: LiveCapturedProfile;
  observedThreadPosts?: ReplyThreadPost[];
}
```

`observedThreadPosts[]` uses the shared `ReplyThreadPost` schema with `source = "x_graphql_observed"`.

## Integration Point

User entry point: using x.com normally while the runner passively observes the page's own GraphQL responses.

Existing module consumers: `GraphQlCaptureObserver`, `XGraphQlNormalizer`, runner bound capture ingestion, engine live capture ingestion.

Terminal outcome: observed reply graph nodes become available to the engine without any new request or navigation.

## Scope Boundaries / Out of Scope

In scope:

- Normalize author handle/display name/user id when present in already-fetched payloads.
- Normalize status id, status URL when handle and id are observed, text, timestamp, reply references, conversation id, and weak metrics.
- Add observed thread posts to the existing capture batch.

Out of scope:

- New GraphQL operation names.
- Synthetic GraphQL requests.
- Scrolling, profile navigation, or thread navigation.
- Inventing URL/author/text fields when not observed.
- Changing canonical own-post semantics.

## Test Strategy & Fixture Ownership

Coverage level: runner unit/integration tests.

Owning suite: `XGraphQlNormalizer` tests and `GraphQlCaptureObserver` tests.

Fixture strategy: checked-in GraphQL fixtures for replies timeline, missing user core, malformed tweet entry, metrics present, and reference-only parent.

Dependency category: in-process fixture parsing.

Isolation boundary: no live X network, no browser navigation.

## Definition of Done

- `observedThreadPosts` emits graph evidence from already-fetched responses.
- Observer remains response-only.
- Malformed entries are skipped without throwing.
- No new operation names or fetches are introduced.

## Acceptance Criteria

- Given: an already-fetched `UserTweetsAndReplies` response with reply references / When: it is normalized / Then: `observedThreadPosts` includes status ids, text, observed author fields, reply refs, timestamps, and weak metrics when present.
- Given: an observed reply references an unobserved parent id / When: it is normalized / Then: the reference id is preserved but parent text is not invented.
- Given: a malformed tweet entry / When: normalization runs / Then: the entry is skipped and the observer does not throw.
- Given: observer code is inspected by tests / When: tests run / Then: it still only listens to `response` events and matches existing operation names.

## Edge Cases

- Missing author handle.
- Missing text.
- Missing created-at timestamp.
- Twitter/X host variants.
- Retweet/repost structures with reply refs.

## Pipeline Log
