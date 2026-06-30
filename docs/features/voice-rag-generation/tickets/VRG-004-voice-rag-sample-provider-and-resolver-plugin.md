---
status: done
---

# VRG-004: Voice RAG sample provider and resolver plug-in

## Implementation Details

Add an engine-private `VoiceSampleProvider` and wire it into `createGenerationGuidanceResolver`.

Public contracts:

```ts
export type VoiceRetrievalRequest = {
  format: DetectedPostFormat;
  idea?: string;
  voiceProfileId?: string;
  useKnownPostIds: string[];
  limit?: number;
};

export type VoiceRetrievalSample = VoiceSamplePost & {
  source: "known_post_id" | "voice_rag" | "recent_original";
  score?: number;
  indexedAt?: string;
};

export type VoiceSampleProvider = (
  request: VoiceRetrievalRequest,
) => Promise<VoiceRetrievalSample[]>;
```

Deliberately update the existing `VoiceSamplePost.source` contract so `"voice_rag"` is a valid source. Keep `"profile_sample"` only if the existing type pinning requires it for compatibility; do not emit profile-derived rows because no local profile-to-post relation exists. Add or update the type-pinning test so this union change is explicit.

`SqliteVoiceSampleProvider` behavior:

1. Honor `useKnownPostIds` first, matching canonical `post.id` or `post.platform_post_id`, filtering to original non-empty posts, and deduping by canonical id.
2. Call `VoiceIndexService.ensureVoiceIndex` with a bounded batch before vector retrieval.
3. Build query text from `request.idea`, `request.format`, and a small local format descriptor.
4. Fill remaining slots from `voice_post_embedding` joined to canonical `post`, ranking by cosine similarity.
5. Break ties deterministically by same detected format when available, newer `created_at`, then `post.id`.
6. Fill underfull results with existing newest-original fallback behavior.

Extend `CreateGenerationGuidanceResolverInput`:

```ts
type CreateGenerationGuidanceResolverInput = {
  settingsRepository: Pick<AppSettingsRepository, "load">;
  postLibraryRepository: Pick<PostLibraryRepository, "loadStore">;
  externalPatternGuidanceProvider?: ExternalPatternGuidanceProvider;
  voiceSampleProvider?: VoiceSampleProvider;
};
```

The resolver calls `voiceSampleProvider` when present. If it throws or returns no samples, it falls back to existing `selectVoiceSamples`. Prompt rendering stays through `renderVoiceSampleGuidance`, with the same voice guidance header and character budget.

`voiceProfileId` remains request metadata only. It must be forwarded but must not change selection until a real local relation exists.

## Data Models

Consumes `VoiceIndexService`, `VoiceEmbedder`, `voice_post_embedding`, canonical `post`, existing `GenerationGuidanceRequest`, and existing `VoiceSamplePost` render shape.

Produces `VoiceRetrievalSample[]` compatible with `renderVoiceSampleGuidance`.

No shared request or response schema changes.

## Integration Point

User entry point: existing Generate format button in the overlay.

Consumers: `createGenerationGuidanceResolver` and `GenerateIdeasService`.

Terminal outcome: generated writer prompts include known requested voice samples first, then local vector-retrieved own voice samples when useful, while preserving fail-open fallback.

## Scope Boundaries / Out of Scope

In scope: provider contract, source union update, known-id precedence, vector retrieval, deterministic ranking, newest-original fallback, resolver plug-in, and unit tests.

Out of scope: HTTP/runner construction parity, transport changes, overlay UI, new request fields, generated response fields, feedback actuals, external evidence as voice, profile-derived selection, cloud/model embeddings, and changing playbook/external pattern rendering.

## Test Strategy & Fixture Ownership

Coverage level: engine LLM/voice unit tests. Owning suite: existing `generation-guidance`, `voice-samples`, and new voice provider tests. Fixture strategy: temp SQLite DB with `seedPosts()`, deterministic test embedder, and prompt capture through existing generation guidance tests. Dependency category: in-process DB and in-process services. Isolation boundary: temp DB or in-memory DB only.

## Definition of Done

- Known ids keep precedence over vector matches.
- Vector-ranked results are deterministic.
- Provider failure and empty provider results fall back to existing `selectVoiceSamples`.
- `voiceProfileId` alone does not alter selection.
- Prompt guidance header and voice budget remain unchanged.
- Type-pinning tests explicitly cover the new `"voice_rag"` source.

## Acceptance Criteria

- Given known ids and vector matches, when guidance resolves, then known-id samples render before vector samples.
- Given duplicate known ids, when retrieval runs, then each canonical post appears once.
- Given a known id that points to a reply, when retrieval runs, then the reply is ignored.
- Given indexed own posts related to the idea, when retrieval runs, then vector-ranked samples fill remaining slots before newest fallback.
- Given no idea text, when retrieval runs, then the format descriptor produces deterministic ranking.
- Given the provider throws, when guidance resolves, then existing newest-original voice samples still render.
- Given an empty or underfilled index, when guidance resolves, then available indexed rows are used and remaining slots fall back to newest originals.
- Given only `voiceProfileId`, when selection runs, then output matches the same request without `voiceProfileId`.

## Edge Cases

- Empty corpus.
- Corrupt vector rows.
- Dimension mismatch.
- Underfilled index.
- Provider throws after partially refreshing index.
- Oversized voice guidance.

## Pipeline Log

- 2026-06-29: Implemented SQLite voice sample provider, explicit `voice_rag` source contract, resolver provider seam, provider failure fallback, known-id precedence, and vector/newest fallback coverage.
