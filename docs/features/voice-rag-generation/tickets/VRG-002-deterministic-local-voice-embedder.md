---
status: done
---

# VRG-002: [FND] Deterministic local voice embedder

## Implementation Details

Create an engine-local voice module with a deterministic embedder and vector helpers:

```ts
export type VoiceEmbedder = {
  id: "local-hashing-voice-embedder";
  version: string;
  dimensions: number;
  embedText(text: string): Float32Array;
};

export const createLocalHashingVoiceEmbedder = () => VoiceEmbedder;
export const encodeVoiceVector = (vector: Float32Array) => Buffer;
export const decodeVoiceVector = (blob: Buffer, dimensions: number) => Float32Array | undefined;
export const cosineSimilarity = (left: Float32Array, right: Float32Array) => number | undefined;
```

The v1 embedder uses local token and character n-gram feature hashing with fixed dimensions, normalizes vectors, and never touches the network. Identical input text must produce byte-identical vectors across process runs.

## Data Models

`VoiceEmbedder.id` is `"local-hashing-voice-embedder"`. `version` starts at `"1"`. `dimensions` is fixed for the implementation and must match the `voice_post_embedding.dimensions` value written by VRG-003.

`encodeVoiceVector` stores little-endian float32 values. `decodeVoiceVector` returns `undefined` when blob length does not equal `dimensions * 4`, when dimensions are invalid, or when any decoded value is not finite.

## Integration Point

User entry point: existing Generate action. The embedder is reached indirectly when generation guidance calls the voice index service.

Consumer: `VoiceIndexService` in VRG-003 uses the embedder to index canonical posts and query text.

Terminal outcome: a deterministic local vector contract exists for the voice projection without adding any external dependency.

## Scope Boundaries / Out of Scope

In scope: local hashing embedder, stable vector dimensions, vector encode/decode, cosine similarity, and tests for deterministic behavior.

Out of scope: `sqlite-vec`, transformer models, model downloads, cloud embedding APIs, settings UI, prompt rendering, and database writes.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests. Owning suite: engine voice or LLM-adjacent unit tests. Fixture strategy: short text pairs chosen for deterministic similarity checks; no filesystem, DB, network, or process-global state. Dependency category: in-process pure functions. Isolation boundary: pure unit test.

## Definition of Done

- Embeddings are deterministic across repeated calls.
- Encoded and decoded vectors round-trip without precision-shape loss beyond float32 representation.
- Cosine similarity handles invalid or zero vectors by returning `undefined`.
- Similar local wording scores higher than unrelated wording in a stable test.

## Acceptance Criteria

- Given identical text, when `embedText` is called twice, then encoded vectors are byte-identical.
- Given near-duplicate text and unrelated text, when cosine similarity is computed against the source, then the near-duplicate score is higher.
- Given an encoded vector, when it is decoded with the correct dimensions, then it returns the expected vector length and finite values.
- Given a malformed BLOB or dimension mismatch, when decoding runs, then it returns `undefined`.
- Given empty or whitespace text, when embedding runs, then it returns a valid normalized deterministic vector or a documented zero-safe vector that downstream similarity handles.

## Edge Cases

- Empty text.
- Unicode punctuation and emoji.
- Very long post text.
- Malformed BLOB length.
- Non-finite vector values.

## Pipeline Log

- 2026-06-29: Implemented deterministic local hashing embedder, little-endian vector encode/decode, cosine similarity, and pure unit coverage. No network/model dependency added.
