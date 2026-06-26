---
status: done
---

# LPF-001: [CHORE] Verify better-sqlite3 and scaffold the migration runner

> **Scope note:** `better-sqlite3@^11.8.0` (+ `@types/better-sqlite3 ^7.6.12`) is **already declared** in `engine/package.json`; nothing is being newly added to the manifest. This ticket is the lightweight verify-and-document step — confirm the native binding loads, produce the migration-runner smoke script, and capture the CI/platform rebuild notes — not a fresh dependency add. If `pnpm i` shows the binding already built and loading, the install half is satisfied by the smoke script alone.

## Goal

Confirm `better-sqlite3`'s Node 20 native binding loads in this workspace, and stand up the migration-runner smoke script + rebuild notes so LPF-002 has a known-good `Database` handle to build on. No application code, no schema, no data — just "the dependency loads and a temp database can be opened and stepped through migration 1's mechanism."

## Changes

- Install dependencies so `better-sqlite3` (already declared in `engine/package.json` at `^11.8.0`, with `@types/better-sqlite3 ^7.6.12`) is present and its native binding is built/rebuilt against the workspace Node 20 toolchain (`pnpm i`, then a rebuild of the native module if the postinstall did not run it).
- Confirm the engine package builds and typechecks with `better-sqlite3` imported.
- Add a tiny throwaway smoke script (not shipped app code) that: opens a temp database via `better-sqlite3`, sets `PRAGMA journal_mode = WAL` / `synchronous = NORMAL` / `foreign_keys = ON`, reads and writes `PRAGMA user_version`, and runs a stand-in "migration 1" (a `CREATE TABLE` + `INSERT OR IGNORE`) inside a `db.transaction(...)` to prove the runner mechanism and synchronous transaction wrapping work end to end.
- Capture any rebuild steps needed on the target platform in the script / its comments so LPF-002 and CI inherit a known-good install.

## Verification

- `pnpm i` completes and `better-sqlite3` resolves; the native binding loads without `ERR_DLOPEN_FAILED` / ABI-mismatch errors.
- The engine package builds and typechecks (`@types/better-sqlite3` resolves; `import Database from "better-sqlite3"` typechecks).
- The smoke script opens a temp DB, applies WAL + `synchronous=NORMAL` + `foreign_keys=ON`, advances `PRAGMA user_version` from 0 to 1 inside a transaction, and exits 0; re-running it against the same file is a no-op (user_version already 1).
- No application source, schema DDL, repository, importer, vector code, or model is added in this ticket.

## Out of Scope (zero-trace)

- No `openEngineDatabase`, no `SqlitePostLibraryRepository`, no importer, no row mappers — those are LPF-002 / LPF-003.
- No real migration 1 DDL committed to app code (the smoke script's table is throwaway).
- No `sqlite-vec`, no `@huggingface/transformers`, no embedder, no `post_vec` table, no migrations 2–3 — all belong to `voice-rag-generation`.
- No host wiring; `createBoundEngineServices` and `buildServer` are untouched.

## Pipeline Log

- **2026-06-26 — DONE (Green + Blue mechanical + gates).** Commit `1a63577` on `feat/LPF-local-persistence-foundation`. Single-file diff: `engine/scripts/sqlite-migration-smoke.mjs` (throwaway, outside `tsc` `src/` rootDir, so unshipped). Verified: `better-sqlite3@11.10.0` binding loads from engine (SQLite 3.49.2, no `ERR_DLOPEN_FAILED`); engine build + typecheck exit 0; smoke run1 sets WAL/synchronous=NORMAL/foreign_keys=ON, advances `user_version` 0→1 inside `db.transaction`, exits 0; run2 same-file no-op (`INSERT OR IGNORE` + version guard). Dummy table `lpf001_smoke_probe` — no real DDL. CI/rebuild notes in the script header. Gates: suppressions/ticket-ids/stubs/size CLEAN; the slop/scope leads were untracked sibling-feature docs + the script's intended diagnostic `console.log`s (verified not debug remnants). **Blue verdict: APPROVE** (no findings, both passes). No concerns recorded.
