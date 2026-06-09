# x-builder

**Local X post writing workbench.** Generate, score, inspect, and refine post candidates with a deterministic engine and a local UI.

X Builder is an internal, local-first app for deciding what to post on X. It takes an idea, generates candidate posts in a few formats, scores them with deterministic heuristics, and shows why each candidate may or may not work before you copy or save it elsewhere.

## What it does

| Area | What it provides |
| --- | --- |
| Writer studio | Draft an idea and generate one-liner, mini-framework, and debate-question candidates. |
| Deterministic scoring | Scores candidate reach, engagement, impressions, voice match, risks, and rewrite suggestions. |
| Detail inspection | Opens score breakdowns so a candidate is not just ranked, but explainable. |
| Manual context | Lets you add follower/context notes and recompute the score against that context. |
| Local engine | Serves Fastify API routes for health, status, settings, generation, and post analysis. |
| Shared contracts | Uses shared Zod schemas between the client and engine. |

Scores are heuristic ranks, not predictions. The product is built as an operator console for a single founder, not as a generic social media scheduler.

## How it works

1. The Vite client renders the local app shell and writer studio.
2. The Fastify engine exposes local API routes and normalizes errors.
3. Shared Zod schemas keep browser and engine payloads aligned.
4. The deterministic analysis service scores drafts and generated candidates.
5. Settings are stored locally under `~/.x-builder/engine-settings`.

## Requirements

- Node.js 20 or newer
- pnpm 9.15.0 or newer

If pnpm is not already available, enable it through Corepack:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

## Install

```bash
pnpm install
```

## Run locally

Start the engine and client together:

```bash
pnpm dev
```

Default local services:

| Service | URL |
| --- | --- |
| Client | `http://127.0.0.1:5173` |
| Engine | `http://127.0.0.1:4173` |
| Engine health | `http://127.0.0.1:4173/health` |
| Engine status | `http://127.0.0.1:4173/status` |

The engine host and port can be changed with environment variables:

```bash
X_BUILDER_ENGINE_HOST=127.0.0.1 X_BUILDER_ENGINE_PORT=4173 pnpm --filter @x-builder/engine dev
```

To run services separately:

```bash
# Terminal 1
pnpm --filter @x-builder/engine dev

# Terminal 2
pnpm --filter @x-builder/client dev
```

## Test and verify

```bash
# Unit and integration tests, excluding Playwright e2e
pnpm test

# TypeScript checks across workspaces
pnpm typecheck

# Playwright e2e tests
pnpm test:e2e

# Build all packages
pnpm build
```

## Workspace layout

```txt
client/      React + Vite local UI
engine/      Fastify engine and deterministic analysis service
shared/      Shared Zod schemas and TypeScript contracts
e2e-tests/   Playwright browser tests
docs/        Product, design, feature, and architecture notes
tools/       Developer tooling notes and scripts
```

## API surface

The local engine currently exposes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Basic engine liveness check. |
| `GET` | `/status` | Engine, deterministic scorer, Codex judge, and storage readiness. |
| `GET` | `/settings` | Load local app settings. |
| `PATCH` | `/settings` | Persist local app settings. |
| `POST` | `/ideas/generate` | Generate candidate posts from an idea. |
| `POST` | `/posts/analyze` | Run deterministic scoring for post candidates. |

## Current limitations

- Codex judge readiness is represented in status, but automatic Codex judging is not wired as the default runtime path yet.
- The generated candidates are deterministic placeholders while the full LLM writer path is still being built.
- X import, publishing, and analytics feedback loops are documented in `docs/features/` but are not complete product flows yet.
- This is a local internal app; it does not include hosted auth, multi-user storage, or deployment automation.
