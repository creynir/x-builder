---
name: x-builder-operator
description: Operate and explain the local x-builder system. Use when Codex needs to run the overlay runner, attach to Chrome over CDP, inspect local engine/storage state, explain archive import, active context, feedback-loop linking, live capture, or safety boundaries in the x-builder repo.
---

# X Builder Operator

## Start Here

Confirm the working directory is the live x-builder checkout, then read repo-local truth before answering:

```bash
pwd
git status --short
sed -n '1,220p' AGENTS.md
sed -n '1,220p' docs/features/agent-operator-skill/README.md
```

If the task concerns failures or environment health, use `$x-builder-doctor` first. If docs conflict, prefer current code and newer storage docs over older feature text; `docs/features/my-x-archive-import/README.md` still contains historical JSON wording, while current storage is SQLite.

## Run The Local System

Build before using the runner bin; `runner/bin/x-builder.js` imports built `runner/dist/*` and the runner injects the built overlay bundle.

```bash
pnpm build
XB_CDP_ENDPOINT=http://127.0.0.1:9222 node runner/bin/x-builder.js
```

Use reconnect mode when the user already has an authenticated Chrome session:

- Chrome must be running with a remote debugging endpoint, commonly `--remote-debugging-port=9222`.
- The endpoint comes from `XB_CDP_ENDPOINT`; an empty value is treated as unset.
- The runner attaches with `chromium.connectOverCDP`, prefers an existing `x.com` tab, injects the overlay, binds `window.__xbTransport`, and observes already-fetched X GraphQL responses.
- Stopping the runner in reconnect mode disconnects the CDP session; it must not close the user's Chrome or tabs.

Use launch mode only when reconnect is not requested. Launch mode opens the dedicated profile at `~/.x-builder/browser-profile`, where the user logs into X separately.

## Verify Readiness

Prefer direct, bounded checks:

```bash
node docs/features/agent-operator-skill/skills/x-builder-doctor/scripts/doctor.mjs
pnpm test
pnpm typecheck
pnpm lint
```

For a running HTTP engine fallback, the default endpoint is `http://127.0.0.1:8787` unless `X_BUILDER_ENGINE_HOST` or `X_BUILDER_ENGINE_PORT` override it. Useful routes:

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/status
curl -s http://127.0.0.1:8787/archive/context/active
curl -s http://127.0.0.1:8787/capture/summary
```

The overlay path usually uses in-process runner bindings, not HTTP. In the browser, inspect these only as diagnostics:

```js
document.getElementById("xb-overlay-root")
window.__xbTransport
window.__xbuilder_getOverlayReadiness?.()
```

Do not treat first mount as enough when the user reports refresh issues; verify the overlay survives reload/navigation.

## Storage Rules

Current local data lives under:

```txt
~/.x-builder/engine-settings/
~/.x-builder/engine-settings/storage/x-builder.db
```

Operational rules:

- Treat the SQLite database as internal storage. Do not hand-edit it or write SQL except through supported migrations, repositories, or app APIs.
- The database contains the canonical own-post corpus, metric observations, provenance, profile snapshots, import runs, derived insights, active context, feedback predictions/links, external X signals, and rebuildable voice embeddings.
- On startup, the runner/engine opens `storage/x-builder.db`, runs append-only migrations, and imports an old `storage/post-library.json` once, renaming it to `post-library.json.migrated`.
- The voice index is a rebuildable projection. If it is missing or stale, generation should fall back to recent original posts.

## Archive And Active Context

Archive import is an optional fast-start source. The user selects `data/tweets.js` from their X archive; x-builder parses it without executing JavaScript.

Remember these distinctions:

- Archive import is user-triggered; JSON-to-SQLite migration is automatic startup maintenance.
- `tweets.js` has likes/retweets but not reliable impressions. It provides weak historical proxies, not true reach actuals.
- Active context is local personalization from archive/local history: reach baseline, cadence/rotation, voice, and audience hints.
- Active context is not Home-feed learning and not a license to scrape unrelated feeds.
- Import and activation flow through the overlay settings panel and engine/transport APIs.

## Feedback Loop

My Feedback Loop stores deliberate prediction snapshots only. Normal typing and debounce scoring are not stored automatically.

Predictions are recorded when the overlay writes a generated draft, applies all suggestions and keeps the rewrite, or the user clicks Record posted draft. Actuals come later from the local post library via live capture or archive/imported records.

Linking rules:

- Exact single normalized match can auto-link.
- Known X post id can link from a captured post.
- Manual link accepts a numeric post id or `/status/<id>` URL in settings.
- Multiple matches fail closed; the system must not guess.
- Linking does not fetch from X, publish, edit, or mutate the post.

## Live Capture Boundary

The runner may observe responses X already fetched for visible pages, normalize supported own-post/profile operations, and ingest them into local storage.

Allowed:

- Analyze visible content and already-fetched GraphQL responses.
- Suggest, judge, score, generate, and fill the composer after an explicit user click.
- Capture the logged-in user's own authored posts and public metrics as the user navigates.

Forbidden:

- Direct X posting, liking, following, reposting, DMs, or publish confirmation.
- Bypassing login, browser consent, or user confirmation.
- Crafting authenticated GraphQL calls, replaying auth headers, auto-pagination, or auto-scroll harvesting.
- Using the Home feed as a learning source.
- Cloud sync, hosted analytics, external credentials, or direct SQLite writes outside supported paths.

## Explain The System

When explaining behavior, name the boundary:

- `overlay/`: React shadow-DOM UI injected into x.com.
- `runner/`: Playwright/CDP lifecycle, overlay injection, transport bindings, passive GraphQL observation.
- `engine/`: local services, Fastify fallback API, SQLite repositories, archive/feedback/generation/judge services.
- `shared/`: Zod contracts used across runner, engine, and overlay.

Tie claims to exact files when possible: `runner/src/runner-app.ts`, `engine/src/server/server.ts`, `engine/src/server/open-engine-database.ts`, `docs/local-data-storage.md`, and `docs/how-to/use-my-feedback-loop.md`.
