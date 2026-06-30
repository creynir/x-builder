---
status: done
---

# VRG-006: [DOC] Document local voice index

## User Flows to Document

- User generates a post and x-builder uses local own-post voice retrieval to choose better voice samples.
- User inspects local data storage docs and understands the difference between the canonical corpus and the rebuildable voice index.
- User understands the index stays local and is not uploaded.

## Documentation Targets

- `docs/local-data-storage.md` - Reference. Update the "what's in the database" and "what it does not hold" sections now that the voice/vector search index exists as a local rebuildable projection.
- `docs/features/voice-rag-generation/README.md` - Explanation/architecture context. Keep the feature-level design aligned with shipped implementation.
- `docs/features/README.md` - Reference. Move `voice-rag-generation` out of planned-only wording once implemented.

## Scope Boundaries / Out of Scope

In scope: plain-language local storage docs, privacy/local-only explanation, canonical corpus vs rebuildable projection distinction, failure/fallback behavior at a user-facing level.

Out of scope: raw DDL in user docs, benchmark claims, cloud model setup instructions, screenshots, UI documentation, and instructions to hand-edit the database.

## Acceptance Criteria

- Given a user reads `docs/local-data-storage.md`, when they look for voice retrieval data, then they see that the voice index lives in the same local DB and is rebuildable derived data.
- Given a privacy review, when docs are inspected, then they state that embeddings and index data stay local and are not uploaded.
- Given a developer reads the feature README, when they compare it to implementation, then migration number, storage location, and fail-open integration behavior match the code.
- Given docs mention the canonical corpus, when voice index is described, then docs do not imply it replaces canonical post or metric tables.

## Pipeline Log

- 2026-06-29: Updated local storage docs, feature index, voice feature README, and stale local-persistence forward references for migration 4/local-only voice projection.
