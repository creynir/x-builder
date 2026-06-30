---
status: done
---

# VRG-003: Voice index lifecycle service

## Implementation Details

Create `VoiceIndexService` in the engine voice module. It owns lazy stale detection and projection updates against the existing host-owned SQLite database.

Public contract:

```ts
type EnsureVoiceIndexInput = {
  db: Database.Database;
  embedder: VoiceEmbedder;
  now?: () => string;
  maxPostsPerCall?: number;
};

type EnsureVoiceIndexResult = {
  indexedCount: number;
  deletedOrphanCount: number;
  remainingStaleCount: number;
};

type VoiceIndexService = {
  ensureVoiceIndex(input?: {
    maxPostsPerCall?: number;
  }): EnsureVoiceIndexResult;
};
```

The service selects canonical rows from `post` where `kind = 'original'` and trimmed `text` is non-empty. A projection row is stale when it is missing, when `content_hash` differs, when `post.updated_at` differs from `voice_post_embedding.post_updated_at`, or when embedder id/version/dimensions differ.

Indexing is bounded. Default `maxPostsPerCall` is 250. Each call cleans orphan rows, indexes up to the limit, updates `voice_index_meta`, and returns the remaining stale count. It must not call `PostLibraryRepository.upsertPosts` and must not mutate canonical tables.

If embedding one canonical post fails, skip that post, continue with the rest of the batch, and store a summary in `voice_index_meta.last_error_at` / `last_error`. If the DB transaction fails, rollback and let the caller fall back to existing voice selection.

## Data Models

Consumes:

- canonical `post.id`, `platform_post_id`, `text`, `kind`, `content_hash`, `updated_at`;
- `voice_index_meta`;
- `voice_post_embedding`;
- `VoiceEmbedder`;
- vector helpers from VRG-002.

Writes only `voice_index_meta` and `voice_post_embedding`.

## Integration Point

User entry point: existing Generate action.

Consumer: `SqliteVoiceSampleProvider` in VRG-004 calls `ensureVoiceIndex` before vector retrieval.

Terminal outcome: voice projection rows are refreshed lazily and locally before generation guidance selects samples.

## Scope Boundaries / Out of Scope

In scope: stale detection, bounded lazy indexing, vector row upserts, orphan cleanup, singleton status updates, transaction boundaries, and failure-to-fallback behavior.

Out of scope: retrieval ranking, guidance rendering, host wiring, synchronous corpus-write embedding, new repository methods, transport changes, feedback actual changes, cloud/model dependencies, and indexing external X signal evidence.

## Test Strategy & Fixture Ownership

Coverage level: engine SQLite integration/unit tests. Owning suite: engine voice/storage tests. Fixture strategy: use `makeTempEngineDb()` and `seedPosts()` to seed canonical originals, replies, whitespace posts, and updated content. Use a test embedder that can deterministically fail on one post to verify skip/error behavior. Dependency category: in-process SQLite and in-process embedder. Isolation boundary: temp DB only.

## Definition of Done

- Only canonical original non-empty posts are indexed.
- Stale rows refresh when canonical content hash or `updated_at` changes.
- Orphan rows are removed or cascaded.
- Bounded indexing returns accurate indexed and remaining stale counts.
- Failures do not mutate canonical corpus or block generation fallback.

## Acceptance Criteria

- Given seeded original posts, when `ensureVoiceIndex` runs, then projection rows are written with matching canonical content metadata.
- Given replies, repost references, unknown posts, or whitespace-only text, when indexing runs, then those rows are not embedded.
- Given a projection row with stale `content_hash`, when indexing runs, then the row is refreshed.
- Given more stale posts than `maxPostsPerCall`, when indexing runs, then only the bounded count is indexed and `remainingStaleCount` reports the rest.
- Given one post embedding fails, when indexing runs, then other eligible posts are indexed and `voice_index_meta.last_error` records the local failure summary.
- Given a DB transaction failure, when indexing runs, then the caller can catch the error and fall back without canonical corpus mutation.

## Edge Cases

- Empty corpus.
- Only non-original posts.
- Corrupt existing vector BLOB.
- Deleted canonical post.
- Embedder version bump.
- Invalid `maxPostsPerCall`.

## Pipeline Log

- 2026-06-29: Implemented lazy bounded voice index lifecycle over canonical `post` rows only, with stale refresh, orphan cleanup, singleton error status, and temp-DB coverage.
