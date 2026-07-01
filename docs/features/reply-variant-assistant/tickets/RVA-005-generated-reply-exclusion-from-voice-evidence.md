---
status: done
---

# RVA-005: Generated Reply Exclusion From Voice Evidence

## Implementation Details

Wire exact generated reply hash exclusion into every current voice/profile evidence reader that can make generated content voice evidence.

Required interception points:

- `ArchiveVoiceProfileService.loadCorpusRows()` excludes rows whose `post.normalized_text_hash` matches either `generated_reply.body_text_hash` or `generated_reply.written_text_hash` before corpus hash, source counts, LLM examples, and evidence rows are built.
- `VoiceIndexService.selectStaleRows()` and `countStaleRows()` anti-join both generated hash columns.
- `VoiceIndexService.deleteOrphans()` also deletes embeddings for posts that now match generated hashes.
- `SqliteVoiceSampleProvider.findKnownRows()`, `rankVectorRows()`, and `findRecentRows()` anti-join both generated hash columns, even where current queries are limited to originals.
- Generation-guidance fallback voice sample selection over `PostLibraryRepository.loadStore()` filters candidates with `normalizeGeneratedReplyBodyHash(post.text)` before known-id and recent selection.

Do not hide generated replies globally from the canonical post library. Exact matching happens at evidence selection time.

## Data Models

Consumes `post.normalized_text_hash`, `generated_reply.body_text_hash`, and `generated_reply.written_text_hash` from RVA-003.

No new schema.

## Integration Point

User entry point: later archive/live capture or archive import observes text that exactly matches a generated reply.

Existing module consumer: archive voice profile, voice index, SQLite voice sample provider, and generation guidance consume canonical posts for voice/RAG evidence.

Terminal outcome: exact generated reply text is excluded from voice/profile/RAG evidence while remaining in the canonical corpus.

## Scope Boundaries / Out of Scope

In scope: exact hash anti-joins/filtering at named evidence seams and tests for each seam.

Out of scope: fuzzy matching, edited generated replies, user promotion of generated replies, labels, embedding redesign, canonical post deletion, or external-account contamination rules beyond existing behavior.

Zero trace: no broad generated-content policy engine beyond exact hash filtering.

## Test Strategy & Fixture Ownership

Coverage level: engine unit/integration tests for each evidence reader.

Fixture ownership: voice/profile tests own generated reply ledger rows and canonical post rows. Generation-guidance tests own fake `PostLibraryRepository.loadStore()` fixtures.

Isolation boundary: in-memory SQLite or fake repository only; no LLM provider except existing fake profile service tests.

## Definition of Done

- Tests prove generated reply hashes are excluded from every named evidence seam.
- Tests prove non-generated posts/replies still flow as before.
- Generated replies remain visible through canonical post loading.

## Acceptance Criteria

- Given: a canonical reply row whose normalized hash matches generated body or written text / When: archive voice profile corpus rows are loaded / Then: it is absent from corpus hash, source counts, prompt examples, and evidence rows.
- Given: an original post row whose normalized hash matches generated body or written text / When: voice index runs / Then: it is not selected as stale and any existing embedding is deleted.
- Given: known post id points to a generated-hash row / When: SQLite voice samples are requested / Then: it is not returned.
- Given: vector/recent rows include a generated-hash row / When: SQLite voice samples are requested / Then: it is filtered out.
- Given: generation-guidance fallback reads posts from `PostLibraryRepository.loadStore()` / When: a post text hashes to generated content / Then: it is excluded before known-id and recent sample selection.

## Visual AC

No UI changes.

## Edge Cases

- Generated hash row exists before matching post is later imported.
- Existing voice embedding predates generated hash recording.
- Generated reply hash matches an original-kind row due exact text reuse.

## Pipeline Log

- 2026-07-01: Implemented generated-reply exclusion across voice readers, index cleanup, and generation guidance fallback.
