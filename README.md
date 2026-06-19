# x-builder

**Local X writing workbench.** Turn a rough idea into post candidates, score them, and use your own archive as context before deciding what to publish.

X Builder runs on your machine. It is not a scheduler, publisher, or hosted social media tool. It is a private studio for shaping posts: draft an idea, generate a few angles, inspect the score, run an optional judge pass, and keep a local library of your own X posts for context.

## Quick start

Requirements:

- Node.js 20 or newer
- pnpm 9.15.0 or newer

If pnpm is not already available:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

Install and start the app:

```bash
pnpm install
pnpm dev
```

Open the client:

```txt
http://127.0.0.1:5173
```

The local engine runs at `http://127.0.0.1:4173`.

## First run

1. Open **Studio** and paste a post idea.
2. Generate candidates, then compare the score summaries.
3. Open a candidate to inspect the detailed Post Coach breakdown.
4. Optional: open **Post Library**, import `data/tweets.js` from your X archive, and activate archive context.
5. Optional: open **Settings** to configure the judge provider and account profile.

## What you can do

| Area | Use it for |
| --- | --- |
| Studio | Draft an idea and generate one-liner, mini-framework, and debate-question candidates. |
| Post Coach | Review reach, reply potential, voice match, risk, format fit, and rewrite guidance. |
| Draft Judge | Run a slower final-read pass through the selected local judge provider. |
| Post Library | Import your X archive, preview stored posts, and derive context from your own writing history. |
| Settings | Configure local readiness, judge provider, model fields, and account profile context. |

Scores are heuristics, not predictions. Treat them as a structured second opinion before you post manually.

## Importing your X archive

X Builder can use your downloaded X archive as local context.

1. Download and extract your X archive.
2. In **Post Library**, select `data/tweets.js`.
3. Validate the file to see importable posts, skipped records, and duplicates.
4. Import the archive.
5. Activate archive context to let Studio use derived signals from your posting history.

The archive file does not include every useful metric. X Builder can use the records available in `tweets.js`, but impressions, bookmarks, link clicks, profile clicks, quotes, and received replies are not available from that file.

## Local data

X Builder stores local app data under:

```txt
~/.x-builder/engine-settings
```

Current files include:

| File | Purpose |
| --- | --- |
| `settings.json` | App settings, judge provider choice, model fields, and account profile. |
| `storage/post-library.json` | Imported post library, import summaries, derived insights, and active archive context. |

There is no hosted account, remote database, or X publishing token in the default local setup.

## Useful commands

```bash
# Start client and engine together
pnpm dev

# Run unit and integration tests
pnpm test

# Run TypeScript checks
pnpm typecheck

# Run Playwright end-to-end tests
pnpm test:e2e

# Build all packages
pnpm build
```

To run the services separately:

```bash
# Terminal 1
pnpm --filter @x-builder/engine dev

# Terminal 2
pnpm --filter @x-builder/client dev
```

## Workspace layout

```txt
client/      React + Vite local UI
engine/      Fastify API, scoring, archive import, settings, and judge routes
shared/      Zod schemas and TypeScript contracts shared by client and engine
e2e-tests/   Playwright browser tests
docs/        Feature maps, specs, architecture notes, and ticket docs
tools/       Internal tooling notes and calibration helpers
```

## Local services

| Service | URL |
| --- | --- |
| Client | `http://127.0.0.1:5173` |
| Engine | `http://127.0.0.1:4173` |
| Health | `http://127.0.0.1:4173/health` |
| Status | `http://127.0.0.1:4173/status` |

The engine host and port can be changed with environment variables:

```bash
X_BUILDER_ENGINE_HOST=127.0.0.1 X_BUILDER_ENGINE_PORT=4173 pnpm --filter @x-builder/engine dev
```

## API surface

The UI is the primary way to use X Builder. The local engine also exposes these routes for development and tests:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Basic engine liveness check. |
| `GET` | `/status` | Engine, judge, and storage readiness. |
| `GET` | `/settings` | Load local app settings. |
| `PATCH` | `/settings` | Save local app settings. |
| `POST` | `/ideas/generate` | Generate post candidates from an idea. |
| `POST` | `/posts/analyze` | Score post candidates. |
| `POST` | `/drafts/judge` | Judge a selected draft with the configured provider. |
| `POST` | `/archive/tweets/validate` | Validate a selected `tweets.js` archive file. |
| `POST` | `/archive/tweets/import` | Import posts from a validated archive file. |
| `GET` | `/archive/imports/latest` | Load the latest archive import summary. |
| `GET` | `/archive/posts` | Page through imported library posts. |
| `GET` | `/archive/insights/latest` | Load derived archive insights. |
| `POST` | `/archive/context/activate` | Activate archive context for Studio. |
| `POST` | `/archive/context/deactivate` | Deactivate archive context. |
| `GET` | `/archive/context/active` | Load the active archive context. |

## Current limitations

- X Builder does not publish to X.
- Scores estimate post quality signals; they do not predict real reach.
- The default candidate generator is deterministic while the richer writer path is still evolving.
- The **Voice** route exists in navigation but is still a placeholder.
- Archive context is based on what `tweets.js` contains, so deeper analytics need another data source.
