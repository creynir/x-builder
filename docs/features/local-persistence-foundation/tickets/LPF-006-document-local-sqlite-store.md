---
status: done
---

# LPF-006: [DOC] Document the local SQLite store and one-time migration

## Target page

A user-facing page under `docs/` (plain markdown — there is no published docs site, so it lives alongside the existing top-level docs such as `docs/component-breakdown.md`). Suggested path: `docs/local-data-storage.md`. Link it from the docs index / any existing "where your data lives" or local-data section.

## Diataxis quadrant

**Reference / Explanation.** It documents *what exists and where* (Reference: the file path, the artifacts, the migration behavior) and *why it is shaped that way* (Explanation: the corpus is a local database, not a flat file, and it never leaves the machine). It is not a step-by-step tutorial and not a task-oriented how-to.

## What user-facing behavior to document

- **Where the corpus lives now.** The local corpus and metric data are stored in a single SQLite database at `~/.x-builder/engine-settings/storage/x-builder.db`. It is local-only and user-private (`chmod 0600`); nothing is uploaded.
- **The corpus is no longer a flat JSON file.** Explain that earlier versions stored everything in `post-library.json`, and that the corpus has moved into the database. Users should not hand-edit the database.
- **The one-time migration.** On first start after upgrading, x-builder automatically imports any existing `post-library.json` into the new database and renames the old file to `post-library.json.migrated`. The migration runs once and is safe to repeat (restarting does nothing further). The `.migrated` file is kept (not deleted) as a backup the user can retain or remove.
- **Nothing the user must do.** The migration is automatic; there is no setting to flip and no import button for this. (Distinguish this from the separate, user-initiated *archive import* of `tweets.js`, which is unrelated.)
- **What is and isn't in the database.** It holds the canonical own-post corpus, metric observations, source provenance, profile snapshots, import runs, derived insights, and the active scoring context. It does not hold raw archive file contents, and (note for forward-readers) the voice/vector index is added by a later feature.

## Scope

Documentation only — no code. Do not document internal schema/DDL, the `EngineTransport`, or implementation symbols; keep it to observable, user-facing behavior and the on-disk artifacts.

## Pipeline Log

- **2026-06-26 — DONE ([DOC]: White).** Created `docs/local-data-storage.md` ("Where your data lives") — Reference/Explanation, matching the existing plain-markdown docs style (H1, no frontmatter, prose + table). Documents: the local SQLite DB at `~/.x-builder/engine-settings/storage/x-builder.db` (local-only, `0600`, never uploaded), the move off the flat `post-library.json`, the automatic one-time migration (imports then renames to `post-library.json.migrated`, kept as backup; idempotent), nothing-for-the-user-to-do, the distinction from user-initiated `tweets.js` archive import, and what is/isn't in the DB (forward note: vector index is a later feature). No internal symbols/DDL. Also corrected the now-stale `storage/post-library.json` reference in `docs/component-breakdown.md` to `storage/x-builder.db` and cross-linked the new page. No docs-site generator (plain markdown), so no build step.
