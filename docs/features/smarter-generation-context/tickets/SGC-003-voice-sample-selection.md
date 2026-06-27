---
status: in-progress
---

# SGC-003: Implement voice sample selection

## Implementation Details

Replace loose tail-post selection with bounded deterministic voice sample selection. Load the `PostLibraryStore` through a supplied `PostLibraryRepository`, filter to local original posts with non-empty text, honor valid `useKnownPostIds` in caller order, then fill remaining slots from newest originals by `createdAt` descending. Treat `voiceProfileId` as request metadata only in this epic: no current profile-to-post relation exists, so it must not change selection unless a concrete source is added before implementation.

Known post ids may match either `CanonicalOwnPost.id` or `CanonicalOwnPost.platformPostId`; dedupe always uses canonical `post.id`. Expose `selectVoiceSamples(input: SelectVoiceSamplesInput): Promise<VoiceSamplePost[]>` and `renderVoiceSampleGuidance(samples: VoiceSamplePost[]): RenderedVoiceSamples` so SGC-004 can compose rendered guidance without inventing a second voice-budget path.

The selector must not use `.slice(-8)`. When sorting fallback posts, parse `createdAt` with `Date.parse`; valid dates sort descending. Missing or malformed dates sort after valid dates, and ties sort by canonical `post.id` ascending to keep deterministic output.

`renderVoiceSampleGuidance` renders one collapsed-whitespace bullet per selected sample as `- ${text}` joined with newlines. Empty sample lists render `{ content: "", charCount: 0, truncated: false }`. If rendered content exceeds 2400 chars, clip content to 2400 chars and set `truncated: true`; `charCount` must equal the returned `content.length`.

## Data Models

Consumes `PostLibraryRepository`, `PostLibraryStore`, `voiceProfileId?: string` as no-op request metadata, and `useKnownPostIds: string[]`.

Produces:

```ts
type SelectVoiceSamplesInput = {
  postLibraryRepository: Pick<PostLibraryRepository, "loadStore">;
  useKnownPostIds?: string[];
  voiceProfileId?: string;
};

type VoiceSamplePost = {
  id: string;
  platformPostId: string;
  text: string;
  createdAt: string;
  kind: "original";
  source: "known_post_id" | "profile_sample" | "recent_original";
};

type RenderedVoiceSamples = {
  content: string;
  charCount: number;
  truncated: boolean;
};
```

Constraints: known ids preserve caller order; known ids must match original posts by canonical id or platform post id; dedupe by canonical post id; cap to 5 posts; fallback ordering is newest valid `createdAt` first with invalid dates last and canonical-id tie-breaks; `renderVoiceSampleGuidance` caps rendered voice content to 2400 chars; repository read failure returns `[]`.

## Integration Point

Producer: `selectVoiceSamples` and `renderVoiceSampleGuidance`. Consumer: `createGenerationGuidanceResolver`. User entry point: clicked generate format category, optionally with known post ids already present in the generate request. Terminal outcome: compact voice examples in the generation prompt.

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
- Given many candidate posts, when rendering guidance, then voice text stays within 2400 chars and reports the returned content length.
- Given malformed `createdAt` values, when fallback selection runs, then valid dates sort first and invalid dates sort last with deterministic id tie-breaks.
- Given only `voiceProfileId`, when selection runs without known ids, then selection still follows newest-original fallback.

## Edge Cases

- No original posts.
- Only replies or reposts.
- Invalid known ids.
- Missing or malformed `createdAt`.
- Whitespace-only text.

## Pipeline Log

- 2026-06-27: RGB pipeline started; ticket moved to in-progress. Pre-Red contract clarified repository input, known-id matching, and rendered voice-sample budget helper.
- 2026-06-27: RGB audit tightened ticket contract before implementation.
- 2026-06-27: Pre-Red clarification added exact voice guidance render format and invalid-date fallback ordering.
