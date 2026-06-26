---
status: done
---

# Local Persistence Foundation

Purpose: replace the flat-file JSON corpus store (`post-library.json`) with a single local SQLite database, migrate any existing data into it once, and move all corpus / metric data out of flat files — without changing what the rest of the product sees.

This is the **first** of the four-feature epic that turns x-builder's local data layer from a JSON blob into a real embedded database. It lays the base store (migration 1) and the migration runner that `voice-rag-generation` will extend with the vector index (migrations 2–3). The defining constraint: the `PostLibraryRepository` interface, the `PostLibraryStore` / `PostLibraryWriteResult` shapes, and the `EngineTransport` seam are all **unchanged**. Callers do not know the store moved from JSON to SQLite.

## Architecture Context

Today the canonical corpus lives in `post-library.json` under the engine storage path, owned by `JsonFilePostLibraryRepository` (the `PostLibraryRepository` impl). It loads the whole file, validates it with `postLibraryStoreSchema`, mutates in memory, and rewrites the whole file through a temp-file-plus-rename atomic write, serialized through a `withSerializedWrite` in-process queue. Every consumer — archive import, live capture, voice retrieval, the judge's audience hints, reach baseline — reaches the corpus only through the 6-method `PostLibraryRepository` interface.

This feature swaps the **implementation** behind that interface. A new `SqlitePostLibraryRepository` backs the same 6 methods with prepared-statement transactions against `x-builder.db`. The single database handle is owned by `openEngineDatabase(dbPath)`, which sets the PRAGMAs, runs the ordered `migrations[]`, and is constructed once per host. `loadStore()` reassembles `CanonicalOwnPost[]` from rows and re-parses the whole store through `postLibraryStoreSchema`, so the wire contract literally cannot drift from the JSON era.

The source-of-truth principle: the relational tables (`post`, `metric_obs`, `source_ref`, `profile_snapshot`) are the **canonical, normalized** store of corpus + metric data. The three rows that already carry their own validated Zod payloads (`import_run`, `derived_insight`, `active_context`) keep those payloads verbatim as JSON columns — they are opaque blobs to SQL, owned by their existing schemas. No derived index (vectors, embeddings) lives here; that is migration 2–3 in `voice-rag-generation`.

## API Endpoints

**No new transport methods.** This feature does not touch the `EngineTransport` seam — the "exactly 17" method invariant (`getOverlayReadiness` … `applyJudgeSuggestions`) is preserved untouched. There is no new HTTP route.

The one new surface is at **host construction**, not transport: each host (`createBoundEngineServices` in the runner, and `buildServer` in the engine until its host is retired by `voice-rag-generation`) calls `openEngineDatabase(dbPath)` once at startup, runs the one-time importer once at open, and constructs `SqlitePostLibraryRepository` with the resulting handle instead of `JsonFilePostLibraryRepository`.

## Component Breakdown

- `openEngineDatabase(dbPath)` — owns the `better-sqlite3` `Database` handle. Sets `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`; runs the ordered `migrations[]` against `PRAGMA user_version`; `chmod 0600` on the DB file; throws `PostLibraryStorageError` on any open or migration failure. Defines the `Migration` type and the `migrations[]` array (this feature ships `{ version: 1, up(db) }` only; `voice-rag-generation` appends 2 and 3).
- `SqlitePostLibraryRepository` — `implements PostLibraryRepository`. The same 6 methods (`loadStore`, `upsertPosts`, `saveImportRun`, `saveDerivedInsights`, `setActiveContext`, `pushProfileSnapshot`), backed by prepared statements wrapped in `db.transaction(...)`. Ports the merge semantics (`mergePost` / `uniqueBy` / `snapshotKey` / `sourceRefKey` / `postKey`) from the JSON repo verbatim — those semantics are test-enforced.
- Row↔Zod mappers (`post-row-mapping`) — reconstruct a `CanonicalOwnPost` exactly: `metricSnapshots` discriminated on `source`, `replyReferences` from the `in_reply_to_*` columns, `entityFlags` from the `has_*` columns. The inverse direction shreds a `CanonicalOwnPostInput` into `post` + `metric_obs` + `source_ref` rows.
- `importPostLibraryJsonToSqlite(jsonRoot, db)` — one-time, idempotent importer. Reads `post-library.json`, parses with `postLibraryStoreSchema` (reusing the shared `upgradePostLibraryStoreToV2` extracted in LPF-003), expands `metricSnapshots`→`metric_obs`, `sourceRefs`→`source_ref`, `profileSnapshots`→`profile_snapshot`, `INSERT OR IGNORE` for idempotency, computes `content_hash` and sets `logical_post_id = platform_post_id`, then renames `post-library.json` → `post-library.json.migrated`. Re-running is a no-op (rename guard + non-empty-table check + `INSERT OR IGNORE`).
- Testing module — owns `makeTempEngineDb()` and `seedPosts(db, CanonicalOwnPost[])`, exported from an engine storage testing module for `voice-rag-generation` and `my-feedback-loop` to consume.

## Dependencies

- `better-sqlite3` — already **declared** in `engine/package.json` at `^11.8.0` (with `@types/better-sqlite3 ^7.6.12`). LPF-001 is a verify-and-document step (confirm the native binding loads on Node 20 + capture rebuild notes), not a fresh dependency add.
- `@x-builder/shared` — `postLibraryStoreSchema`, `canonicalOwnPostSchema`, `archiveImportRunSchema`, `archiveDerivedInsightsSchema`, `activeArchiveContextSchema`, `archivePostKindSchema`.
- Existing engine code reused unchanged: the `PostLibraryRepository` interface, `PostLibraryStore`, `PostLibraryWriteResult`, `PostLibraryStorageError`, and the merge helpers (ported, not re-derived).
- **Not** in this feature: `sqlite-vec`, `@huggingface/transformers`, the embedder, and the `post_vec` table / migrations 2–3 — all belong to `voice-rag-generation`. Zero vector code lands here.

## Sub-Tickets Overview

Build order:

1. `LPF-001: [CHORE] Verify better-sqlite3 and scaffold the migration runner` — confirm the (already-declared) native binding loads on Node 20, produce the migration-runner smoke script + rebuild notes. No app code.
2. `LPF-002: [FND] openEngineDatabase + migration 1 DDL + SqlitePostLibraryRepository + row↔Zod mappers` — the base store and the 6-method SQLite repository. Hosts the JSON↔SQLite **parity/pinning** test (both repos coexist here) and owns the `makeTempEngineDb()` / `seedPosts(...)` helpers. DDL keys match the ported `snapshotKey` / `sourceRefKey`; `profile_snapshot` is append-only; `logical_post_id = platform_post_id`.
3. `LPF-003: [FND] importPostLibraryJsonToSqlite + host swap + .migrated rename` — extract the shared `upgradePostLibraryStoreToV2`; one-time migration of any existing JSON; swap both hosts to the SQLite repo and widen host signatures to the `PostLibraryRepository` interface; idempotent re-start.
4. `LPF-004: [RFR] Retire JsonFilePostLibraryRepository and the JSON write paths` — migrate the ~10 remaining consumer-test fixtures + the `engine/src/index.ts` export to the SQLite repo via the shared factory, **then** delete the class + write machinery (keep the importer's read path + shared upgrade fn).
5. `LPF-005: [INT] SQLite storage integration + migration idempotency` — SQLite-only round-trip + idempotency + a "no JSON facade survived" on-disk assertion (parity vs JSON is pinned in LPF-002).
6. `LPF-006: [DOC] Document the local SQLite store and the one-time migration` — user-facing Reference/Explanation page.

## Pipeline Log (RGB-TDD run, 2026-06-26)

Branch `feat/LPF-local-persistence-foundation`. Implementation tickets LPF-001…005 all **Done** (1 total rejection cycle — Blue caught an unpinned `logical_post_id` invariant in LPF-002 Red; 0 concerns at ticket level). Per-ticket details in each ticket's Pipeline Log.

**Post-Epic Gates (full epic diff `de833af..786d045`):**
- **Final Blue — APPROVE_WITH_CONCERNS.** LPF-owned packages green: engine `vitest run` 757/1, runner 105/0, engine/runner/shared typecheck+lint+build clean (run directly). SQL fully parameterized; `chmod 0600`; errors wrapped in `PostLibraryStorageError`; `PostLibraryRepository` still 6 methods; `EngineTransport` still 17 (untouched — `shared/` not in diff). Live `~/.x-builder` corpus byte-identical before/after.
- **Final Yellow — APPROVE.** Corpus traces end-to-end through the unchanged interface to the SQLite tables; zero orphans; zero-trace (no JSON write path, no shim, no vector code); real SQLite source-of-truth, not a facade; strangler complete.
- **Amber — APPROVE_WITH_CONCERNS.** All cross-ticket seams resolve; one straight path (no dual store); forward deps hold (append-driven `migrations[]`, `logical_post_id`/`metric_obs.tweet_id` keys intact for voice-rag-generation & my-feedback-loop).
- **Crimson — APPROVE.** No CRITICAL/HIGH/MEDIUM/LOW. Parameterized SQL (only the integer `user_version` pragma is interpolated), host-derived paths (no traversal), `chmod 0600`, `JSON.parse` of Zod-validated payloads (no `eval`), no new network surface.

**Concerns ledger (for merge triage):**
1. *(residual, NOT LPF)* Aggregate `pnpm test/build/typecheck/lint` fail because `@x-builder/overlay` is broken — `overlay/src/design-tokens.ts` imports `docs/design-system/product-tokens.css` which is **absent at merge-base `de833af`** (already broken on `main`; overlay is not in the LPF diff). LPF-neutral; LPF's own packages verified green directly.
2. *(LPF-004 artifact)* Dead `export const postLibraryFileName` in `post-library-repository.ts` — its only consumer (the JSON repo) was deleted; the importer uses a local copy. Trivial cleanup (delete the export, or have the importer import it).
3. *(pre-existing, RFR-candidate)* `engine/src/server/server.ts` 981 lines mixes readiness/LLM-construction/routing — not inflated by this epic (+31); route to a future behavior-preserving `[RFR]`. The standing `size` scan will re-flag it.
4. *(LOW note, Crimson)* WAL sidecar files (`-wal`/`-shm`) not separately `chmod 0600`'d — immaterial on a local single-user machine.
