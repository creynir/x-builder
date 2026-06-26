# AGENTS.md

## Project Profile

> Maintained by the arch-recon skill (single writer, append-only). Facts only — no architectural opinions. Other pipeline skills read this section; precedence: observed repo reality → ticket/Architecture Context → these facts → generic conventions.

### Repo Map

- `overlay/` — `@x-builder/overlay`: the product UI — a React shadow-DOM overlay injected into x.com (includes the v2 component primitives under `overlay/src/ui/`)
- `runner/` — `@x-builder/runner`: Playwright runner that attaches to your logged-in Chrome over CDP, injects the overlay, captures GraphQL, and hosts the in-process engine over a transport seam
- `engine/` — `@x-builder/engine`: scoring, judge/generate/apply services, archive import, settings + post-library repositories (also exposes a Fastify API)
- `shared/` — `@x-builder/shared`: Zod schemas shared across packages
- `e2e-tests/` — `@x-builder/e2e-tests`: end-to-end suites (excluded from `pnpm test`, run via `pnpm test:e2e`). NOTE: its Playwright webServer still boots the removed client SPA — needs repointing to the overlay/runner harness.
- (removed) `client/` — the legacy Vite/React writer studio was deleted; its v2 primitives moved to `overlay/src/ui/`.
- `tools/` — internal tooling notes (README only)
- `docs/features/<slug>/` — per-feature docs: `map/`, `spec/`, `architecture/`, `tickets/`

### Stack & Commands

- Node.js 20+, pnpm 9.15.0 (Corepack), Turbo 2, TypeScript 5.7, Vitest 3, Zod, Fastify (engine), Vite + React (overlay), Playwright (runner)
- Build: `pnpm build` · Run the overlay: launch Chrome with `--remote-debugging-port=9222` (logged into x.com), then `XB_CDP_ENDPOINT=http://127.0.0.1:9222 node runner/bin/x-builder.js` · Unit/integration tests: `pnpm test` · Typecheck: `pnpm typecheck` · Lint: `pnpm lint`
- Engine settings persist locally under `~/.x-builder/engine-settings`

### Ticket Source

- `local: docs/features/` — no Linear on this project. Tickets live at `docs/features/<slug>/tickets/<ID>-<slug>.md` with a `tickets/README.md` build-order index.

### Docs Target

- `docs/` — plain markdown, no docs site generator.

### Pattern References

- none registered

### Reference Repos

- none registered (this repo itself serves as the reference for pipeline runs)
