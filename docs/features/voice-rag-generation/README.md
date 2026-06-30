---
status: done
---

# Voice RAG Generation

Purpose: add a local, rebuildable voice retrieval layer on top of the SQLite corpus so generation can choose better own-post voice samples for the requested idea and format.

## Architecture Context

Voice RAG Generation is a derived local projection, not a replacement for the canonical corpus. The canonical source of truth remains the existing SQLite `post`, `metric_obs`, `source_ref`, and related corpus tables managed through `PostLibraryRepository`. Feedback actuals continue to derive from canonical post metric snapshots. No external evidence, hosted data, cloud embedding API, or remote model output becomes part of the user's own voice.

The voice index lives in the same local database file as the corpus:

```txt
~/.x-builder/engine-settings/storage/x-builder.db
```

The current database is already at migration version 3: corpus tables, feedback tables, and external X signal tables. This feature appends migration 4 for the rebuildable voice projection.

The first implementation uses a deterministic local hashing embedder. It has no package download, model download, network call, or cloud storage requirement. Embeddings are stored as little-endian normalized `Float32Array` BLOBs. The embedding projection is stale when canonical original-post content changes, when a projection row is missing, or when the embedder id/version/dimensions differ.

Indexing is lazy and bounded during generation guidance retrieval. Corpus writes remain canonical-only; `SqlitePostLibraryRepository.upsertPosts` does not synchronously embed and `PostLibraryRepository` does not grow a voice method. If indexing or retrieval fails, generation falls back to the delivered newest-original voice sample behavior and continues.

The delivered smarter generation context path is the integration seam. `createGenerationGuidanceResolver` gains an optional `VoiceSampleProvider`. Default HTTP and runner hosts construct that provider from the same engine-owned database handle they already open. `GenerateIdeaRequest`, `GenerateIdeaResponse`, `EngineTransport`, overlay UI, and posting behavior are unchanged.

## API Endpoints

No new HTTP routes.

No new overlay transport methods.

The internal service contract is engine-local:

```ts
type VoiceSampleProvider = (
  request: VoiceRetrievalRequest,
) => Promise<VoiceRetrievalSample[]>;
```

`createGenerationGuidanceResolver` consumes the provider when present, then renders the same guidance block order:

1. requested format playbook;
2. external performance patterns;
3. own voice samples;
4. founder-story guardrail when applicable.

## Component Breakdown

- `openEngineDatabase` migrations array - appends migration 4 for `voice_index_meta` and `voice_post_embedding`.
- `LocalHashingVoiceEmbedder` - deterministic local embedder with stable vector dimensions, vector encode/decode helpers, and cosine similarity.
- `VoiceIndexService` - finds stale canonical original posts, lazily upserts projection rows in bounded transactions, cleans orphan rows, and tracks singleton index status.
- `SqliteVoiceSampleProvider` - honors known post ids first, retrieves vector-ranked originals from `voice_post_embedding` joined to canonical `post`, fills underfull results with newest originals, and returns existing guidance-compatible voice samples.
- `createGenerationGuidanceResolver` - consumes an optional `VoiceSampleProvider` and falls back to existing `selectVoiceSamples` on provider error or empty provider results.
- `buildServer` default generation construction - creates the voice provider from the host-owned database handle.
- `defaultCreateServices` / `createBoundEngineServices` - creates and passes the same provider through runner service construction without recovering private state from `SqlitePostLibraryRepository`.

## Dependencies

- Existing local SQLite database through `openEngineDatabase`.
- Existing canonical `post` table fields: `id`, `platform_post_id`, `text`, `created_at`, `kind`, `content_hash`, `updated_at`.
- Existing `PostLibraryRepository` only for fallback selection.
- Existing smarter generation context types and rendering helpers.
- No `sqlite-vec`, no `@huggingface/transformers`, no cloud embedding provider, and no remote model dependency in this epic.

## Sub-Tickets Overview

1. `VRG-001: [FND] SQLite voice projection migration`
2. `VRG-002: [FND] Deterministic local voice embedder`
3. `VRG-003: Voice index lifecycle service`
4. `VRG-004: Voice RAG sample provider and resolver plug-in`
5. `VRG-005: [INT] HTTP and runner generation parity`
6. `VRG-006: [DOC] Document local voice index`

## Pipeline Log

- 2026-06-29: Arch-recon approved with concerns folded into tickets: runner provider seam is explicit, `VoiceSamplePost.source` intentionally includes `voice_rag`, and index errors use `voice_index_meta.last_error_at` / `last_error`.
- 2026-06-29: RGB implementation completed through local migration 4, deterministic local embedder, lazy index lifecycle, provider-backed generation guidance, HTTP/runner wiring, and storage documentation.
