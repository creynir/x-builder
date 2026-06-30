# Agent Operator Skill Arch-Recon Report

## Scope

Build repo-versioned Codex skills that let agents run, inspect, and explain the local x-builder system without rediscovering setup, browser/CDP, storage, archive, context, feedback-loop, and safety rules.

## Current Repo Truth

- `AGENTS.md` identifies the product surface as a React shadow-DOM overlay in `overlay/`, a Playwright/CDP runner in `runner/`, local services and Fastify fallback API in `engine/`, and shared Zod contracts in `shared/`.
- Root scripts are `pnpm build`, `pnpm test`, `pnpm typecheck`, and `pnpm lint`.
- The runner bin is `runner/bin/x-builder.js`; it imports built `runner/dist/*` and requires the built overlay bundle.
- Reconnect mode is selected with `XB_CDP_ENDPOINT`, attaches to an existing Chrome over CDP, injects the overlay into an x.com tab, and disconnects without closing Chrome.
- Current persistent storage is SQLite at `~/.x-builder/engine-settings/storage/x-builder.db`.
- Startup applies SQLite migrations and imports old `post-library.json` once when present.
- Archive import is user-triggered `tweets.js` import. It is independent of automatic JSON-to-SQLite migration.
- Active context is local archive/history personalization, not Home-feed learning.
- My Feedback Loop stores deliberate prediction snapshots and links them to local captured/imported posts. Ambiguous matches fail closed.

## Drift Notes

- `docs/features/my-x-archive-import/README.md` still contains historical JSON storage language. Prefer `docs/local-data-storage.md` and current engine/runner code for storage behavior.
- `docs/features/x-overlay-browser/README.md` includes older architecture text that mentions 17 bindings and JSON v1/v2 notes. Current runner comments refer to a larger binding set and SQLite-backed production services.

## Implementation Shape

- `x-builder-operator`: procedural skill for normal operation, explanation, safety boundaries, and feature semantics.
- `x-builder-doctor`: diagnostic skill with a bundled read-only Node script.
- `doctor.mjs`: no dependencies beyond Node; checks Node/pnpm, repo package metadata, build artifacts, settings/storage paths, SQLite `user_version` when `sqlite3` is available, and Chrome CDP `/json/version`.

## Safety Boundary

Skills must not post, like, follow, repost, DM, replay auth headers, bypass login/consent, auto-scroll/auto-paginate to harvest, use the Home feed as a learning source, handle cloud credentials, or write directly to SQLite outside supported app/migration paths.
