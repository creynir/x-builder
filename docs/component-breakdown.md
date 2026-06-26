# Component breakdown

The architecture of the x.com overlay product. Feature-level docs live under `docs/features/<slug>/`; how-to guides under `docs/how-to/`.

## Packages

```txt
overlay/   The product UI — a React shadow-DOM overlay injected into x.com's
           composer. Includes the v2 component primitives (overlay/src/ui/v2/).
runner/    Playwright runner — connectOverCDP to your logged-in Chrome, injects
           the overlay, passively captures X's GraphQL, and hosts the engine
           in-process over a transport seam.
engine/    Scoring (deterministic), the LLM judge / generate / apply services,
           the CLI provider layer, archive import, cooldown/repetition window,
           and the settings + post-library repositories.
shared/    Zod schemas + TypeScript contracts shared across packages.
tools/     Calibration helpers (offline reach-model fitting).
```

(The legacy `client/` web studio was removed in the overlay pivot; its v2 primitives moved into `overlay/src/ui/`.)

## How the pieces connect

- **Transport seam.** The overlay never calls a server. The runner exposes the engine's `EngineTransport` (the 17-method interface in `shared/src/schemas/engine-transport.ts`) onto the page as `window.__xbTransport`; the overlay calls it directly. No API server in the product path.
- **Corpus capture.** `runner/src/graphql-capture-observer.ts` reads X's GraphQL responses as you browse, `x-graphql-normalizer.ts` normalizes them, and `engine/src/capture/live-capture-service.ts` upserts (deduped by post id) into the post library. The archive importer (`engine/src/archive/`) is the second, independent enrichment source.
- **Settings + corpus storage.** `~/.x-builder/engine-settings/` — `settings.json` (judge provider, model, knowledge-base path, account profile) + `storage/x-builder.db` (the corpus, a local SQLite database). See [Where your data lives](local-data-storage.md).

## Component map

| Capability | Where |
|---|---|
| **Static engine** (reach prediction + Post Coach, deterministic) | `engine/src/deterministic/` → `/posts/analyze`; shown in `overlay/src/compose/static-engine-column.tsx` |
| **Reach model** (format-dominant, judge→reach two-pass) | `engine/src/deterministic/prediction-estimator.ts` + `const/reach-model-weights.ts` |
| **LLM judge** (13-dim verdict, inline annotations) | `engine/src/llm/judge-draft-service.ts`; UI `overlay/src/judge/judge-strip.tsx` |
| **CLI providers** (Codex / Claude / Cursor) | `engine/src/llm/{codex,claude,cursor}-cli-provider.ts` behind `structured-llm-service.ts` |
| **Generate** (grounded drafts) | `engine/src/llm/generate-ideas-service.ts` + `engine/src/suggest/`; rail `overlay/src/compose/compose-generate-rail.tsx` |
| **Apply suggestions** (judge→rewrite→re-judge) | `engine/src/llm/apply-judge-suggestions-service.ts` |
| **Cooldown** (7-day format repetition) | `engine/src/capture/repetition-window-service.ts` |
| **Archive import** | `engine/src/archive/` + `/archive/*` routes |
| **Overlay surfaces** | `overlay/src/compose/` (cockpit: rail / static / judge), `highlight/` (blue/green), `provenance/`, `settings/` |

## Feature docs

- **Built:** `x-overlay-browser/`, `deterministic-engine/`, `reach-model-upgrade/`, `founder-story-reach/`, `llm-judge/`, `codex-adapter/` (the CLI provider layer), `my-x-archive-import/`.
- **Planned:** `external-feedback-loop/`, `my-feedback-loop/` (close the predict→measure→learn loop), `external-x-import-signals/`.
- **New:** `generation-and-judge-surface/` (generate, apply-all, annotations, account-profile).
