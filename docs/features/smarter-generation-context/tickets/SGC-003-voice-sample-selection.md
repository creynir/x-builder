---
status: todo
---

# SGC-003: Implement voice sample selection

## Implementation Details

Replace loose tail-post selection with bounded deterministic voice sample selection. Load the `PostLibraryStore`, filter to local original posts with non-empty text, honor valid `useKnownPostIds` in caller order, then fill remaining slots from newest originals by `createdAt` descending. Treat `voiceProfileId` as request metadata only in this epic: no current profile-to-post relation exists, so it must not change selection unless a concrete source is added before implementation.

The selector must not use `.slice(-8)`.

## Data Models

Consumes `PostLibraryStore`, `voiceProfileId?: string` as no-op request metadata, and `useKnownPostIds: string[]`.

Produces:

```ts
type VoiceSamplePost = {
  id: string;
  platformPostId: string;
  text: string;
  createdAt: string;
  kind: "original";
  source: "known_post_id" | "profile_sample" | "recent_original";
};
```

Constraints: known ids preserve caller order; known ids must match original posts; dedupe by canonical post id; cap to 5 posts; cap rendered voice content to 2400 chars; repository read failure returns `[]`.

## Integration Point

Producer: `selectVoiceSamples`. Consumer: `createGenerationGuidanceResolver`. User entry point: clicked generate format category, optionally with known post ids already present in the generate request. Terminal outcome: compact voice examples in the generation prompt.

## Scope Boundaries / Out of Scope

In scope: original-post filtering, known-post precedence, newest-original fallback, dedupe, and prompt budget enforcement.

Out of scope: no embeddings, background indexing, corpus writes, replies, reposts, new UI for voice profile selection, or invented `voiceProfileId` semantics.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests. Owning suite: engine LLM or post-library-adjacent tests. Fixture strategy: in-memory post-library store builders with originals, replies, duplicates, empty text, and explicit `createdAt` ordering. Dependency category: in-process repository/store fixtures. Isolation boundary: no real local corpus or user settings.

## Definition of Done

- Newest-original selection is deterministic.
- Known ids are honored first and deduped.
- Tests prove oldest-tail `.slice(-8)` behavior is gone.
- Tests prove `voiceProfileId` alone does not alter selected samples without a concrete profile-to-post source.

## Acceptance Criteria

- Given posts ordered newest-first, when no known ids are supplied, then selected samples are newest originals, not the tail of the list.
- Given `useKnownPostIds`, when matching original posts exist, then those posts appear first in the rendered sample.
- Given duplicate known ids, when selection runs, then each selected post appears only once.
- Given a known id that points to a reply, when selection runs, then that post is ignored.
- Given many candidate posts, when rendering guidance, then voice text stays within 2400 chars.
- Given only `voiceProfileId`, when selection runs without known ids, then selection still follows newest-original fallback.

## Edge Cases

- No original posts.
- Only replies or reposts.
- Invalid known ids.
- Missing or malformed `createdAt`.
- Whitespace-only text.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
