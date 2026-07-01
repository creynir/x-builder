---
status: done
---

# RVA-003: [FND] Generated Reply Ledger And Hash Projection

## Implementation Details

Add generated reply storage and normalized content hash projection.

Required pieces:

- Append migration 8 to create a `generated_reply` ledger table.
- Add `post.normalized_text_hash` to the canonical post table and backfill it during migration using the generated-reply normalizer.
- Update post row mapping/import writes so all future post rows carry `normalized_text_hash`.
- Add a single generated-reply normalizer/hash helper using NFKC, whitespace collapse, trim, and namespace `sha256:rva-generated-reply:v1:`.
- Add a generated reply repository/service that records chosen generated bodies idempotently and performs exact hash lookup against both authored body and written text hashes.

The canonical corpus remains source of truth and generated replies remain visible in normal post storage. Exclusion is applied by evidence readers in a later ticket.

## Data Models

SQLite:

- `generated_reply`
  - `id TEXT PRIMARY KEY`
  - `client_event_id TEXT UNIQUE NOT NULL`
  - `body_text TEXT NOT NULL`
  - `written_text TEXT NOT NULL`
  - `body_text_hash TEXT NOT NULL`
  - `written_text_hash TEXT NOT NULL`
  - `target_status_id TEXT`
  - `chosen_variant_id TEXT`
  - `reply_move TEXT`
  - `generated_at TEXT NOT NULL`
  - `recorded_at TEXT NOT NULL`
  - indexes on `body_text_hash`, `written_text_hash`, and `target_status_id`

- `post.normalized_text_hash TEXT`

Repository contract:

- `recordGeneratedReply(input)`
- `findByContentHash(hash)`
- `isGeneratedReplyText(text)`
- `isGeneratedReplyHash(hash)`

## Integration Point

User entry point: choosing a reply variant in the future reply assistant.

Existing module consumer: engine storage bundle and later routes/services consume the generated reply repository.

Terminal outcome: chosen generated replies can be recorded and exact-matched by normalized hash without hiding canonical posts.

## Scope Boundaries / Out of Scope

In scope: migration, normalizer, repository, storage wiring, migration tests.

Out of scope: overlay UI, reply generation LLM service, Fastify route handlers, voice evidence filtering, fuzzy matching, generated content promotion, labels, embeddings, or fact/belief projections.

Zero trace: no unused labeled-corpus projection tables.

## Test Strategy & Fixture Ownership

Coverage level: engine storage migration and repository unit tests.

Fixture ownership: use in-memory SQLite database fixtures and post row fixtures owned by engine server/voice tests.

Isolation boundary: in-memory database only; no home directory or runtime storage.

## Definition of Done

- Migration 8 applies after existing migrations and is idempotent through `PRAGMA user_version`.
- Existing post inserts include `normalized_text_hash`.
- Repository record by generated body hash is idempotent.
- Hash normalizer treats NFKC and whitespace-equivalent strings as equal.

## Acceptance Criteria

- Given: an empty database / When: migrations run / Then: `generated_reply` and `post.normalized_text_hash` exist.
- Given: an existing post row from a prior schema / When: migration 8 runs / Then: `normalized_text_hash` is backfilled.
- Given: generated body text with variant whitespace / When: hashed / Then: equivalent normalized text produces the same hash.
- Given: the same `clientEventId` or normalized generated body is recorded twice / When: repository records it / Then: the second call is a duplicate/idempotent result.
- Given: future capture includes either the authored body or the full written text with structural target handle / When: the normalized hash is looked up / Then: the ledger matches either `body_text_hash` or `written_text_hash`.
- Given: canonical posts are loaded normally / When: generated reply hashes exist / Then: the repository does not globally remove those posts.

## Visual AC

No UI changes.

## Edge Cases

- Empty or whitespace-only generated body is rejected.
- Missing target status id is allowed when reply context lacks a stable status id.
- Existing database without generated reply table migrates cleanly.

## Pipeline Log

- 2026-07-01: Implemented generated reply ledger, normalized hash projection, migration, and idempotent repository tests.
