---
status: done
---

# LPF-005: [INT] Cover storage parity and migration idempotency

Integration coverage for the SQLite store end-to-end: the one-time migration is genuinely idempotent and genuinely backed by SQLite on disk (not a JSON facade), and the corpus round-trips through a real DB file via the host construction paths.

> **Parity note.** The `SqlitePostLibraryRepository`-vs-`JsonFilePostLibraryRepository` parity comparison lives in **LPF-002** (a unit/pinning test, run while both repos still coexist) — it is the characterization surface for the LPF-004 retirement. By the time this `[INT]` runs, LPF-004 has deleted the JSON repo, so this suite is **SQLite-only** and must not reference `JsonFilePostLibraryRepository`.

## User Flows to Verify

- **Fresh install → first write.** A host opens with no `post-library.json` and no `x-builder.db`; migration 1 creates the schema; a corpus write (upsert via the repository) lands in `x-builder.db`; `loadStore()` returns it.
- **Upgrade → migrate → serve.** A host opens with an existing `post-library.json` (both v2 and v1 fixtures); the importer migrates it; the file becomes `post-library.json.migrated`; subsequent reads serve from SQLite and match what the JSON repo would have returned for the same file.
- **Restart after migration.** The same host opens a second time (file already `.migrated`, `post` table populated); the importer is a no-op; no data is duplicated; corpus content is unchanged.
- **Round-trip through the interface.** A fixture batch upserted through `SqlitePostLibraryRepository` reloads via `loadStore()` with identical content (modulo write-time `updatedAt`) and posts ordered `created_at DESC, id ASC`; re-upserting merges (dedup by `snapshotKey` / `sourceRefKey`) rather than duplicating.

## Architectural Invariants

- **SQLite is the real on-disk artifact — a JSON facade must fail this suite.** After migration, assert the storage directory contains `x-builder.db` (a real SQLite file with the migration-1 tables and `PRAGMA user_version = 1`) and `post-library.json.migrated`, and that `post-library.json` no longer exists. A hypothetical implementation that kept writing JSON under the hood while exposing the interface must fail here.
- **Idempotency is structural, not best-effort.** Running the importer twice (and opening the host twice) changes nothing the second time; the assertion checks row counts are unchanged, not merely that no error was thrown.
- **Interface and transport unchanged by LPF.** The `PostLibraryRepository` interface is still the same 6 methods, and this feature added no `EngineTransport` method — assert the transport method count is unchanged from before LPF (the storage swap never touches the transport seam).
- **Kind vocabulary preserved.** Posts round-trip through migration + reload with `kind` in `{ original, reply, repost_reference, unknown }`; no `'post'` token appears in any stored row.
- **Snowflake fidelity.** A post with a 64-bit Snowflake id round-trips through migrate → reload with the id string intact (no numeric coercion).

## Modules Under Test

- `openEngineDatabase` (schema creation, PRAGMAs, `user_version`).
- `SqlitePostLibraryRepository` (the 6 methods, end to end against a real DB file).
- `importPostLibraryJsonToSqlite` (migration + rename + idempotency) and the shared `upgradePostLibraryStoreToV2` (v1 fixture path).
- The host construction paths `createBoundEngineServices` and `buildServer` (open-once + import-once + SQLite repo).
- Test helpers `makeTempEngineDb()` / `seedPosts(...)` (owned by LPF-002), exercised here as a consumer to confirm their signatures hold.

## Pipeline Log

- **2026-06-26 — DONE ([INT]: Purple → Blue). 0 rejection cycles.** Commit `e56324a` — `engine/src/server/tests/storage-migration-integration.test.ts` (16 tests) + `runner/src/runner-host-storage-integration.test.ts` (2 tests). All 4 flows covered through real modules (no internal mocks): fresh-install→first-write (with close+reopen durability), upgrade→migrate→serve (v2 + v1-via-`upgradePostLibraryStoreToV2`, served over real `buildServer({storageRoot})` `/archive/posts`), restart-no-op (full table-count records compared before/after, engine + runner `RunnerApp`), interface round-trip (order `created_at DESC, id ASC` + merge dedup). All 5 invariants falsifiable: on-disk SQLite (opens `x-builder.db` directly, asserts `user_version=1` + 7 tables in `sqlite_master` + `.migrated` present + no `post-library.json`), structural idempotency (row counts), transport=17 + repo=6 (counts), kind verbatim (column read, no `'post'`), Snowflake exact-string. **SQLite-only** (zero `JsonFilePostLibraryRepository` refs). Blue Validate-Purple **APPROVE** (18/18 pass, engine regression 235/235, isolation `mkdtemp`/`:memory:` only, live corpus byte-identical post-run). Purple corrected one self-authored assertion (content-identical re-upsert is `updatedCount:1` not `unchangedCount:1` — the repo stamps `updatedAt` at merge, same as the retired JSON repo; pinned the structural dedup invariant instead) — verified correct, not masking a defect. **No concerns.** (Orchestrator note: Purple reported committing but left the files untracked; the orchestrator committed its verified output.)
