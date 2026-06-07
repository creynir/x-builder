# Deterministic Engine Tickets

These disk tickets translate the flow-map, flow-spec, and arch-recon output into RGB TDD work.

## Label Semantics

- `[FND]`: foundational production code or contracts.
- `[BE]`: backend production implementation.
- `[FE]`: frontend production implementation.
- `[INT]`: Purple-owned integration or E2E tests only.

Do not use `[INT]` for normal implementation tickets in the RGB pipeline.

## Required Context

Before starting the backlog, read:

- `docs/what-we-are-building.md`
- `docs/component-breakdown.md`
- `docs/features/README.md`
- `docs/features/deterministic-engine/README.md`
- `docs/features/deterministic-engine/map/01-feature-inventory.md`
- `docs/features/deterministic-engine/map/02-flow-index.md`
- `docs/features/deterministic-engine/map/02-flows/*.md`
- `docs/features/deterministic-engine/map/03-validation-report.md`
- `docs/features/deterministic-engine/spec/screen-list.md`
- `docs/features/deterministic-engine/spec/*.md`
- `docs/features/deterministic-engine/spec/mockups/*.html`

## Architecture Decisions

- Keep `/ideas/generate` text-only.
- Add `POST /posts/analyze` for deterministic scoring.
- Generate candidates first, render candidate text, then score candidates.
- Score retry retries analysis only and must not regenerate candidate text.
- Manual follower count is request-scoped day one.
- No X integration or imported performance metrics day one.
- Without followers, Post Coach still works and prediction returns a disabled state.
- Never use the analyzer's implicit `1000` follower fallback as an unlabeled prediction.
- Engine owns deterministic analysis and Post Coach derivation.
- Shared owns the Zod API schemas.
- UI consumes API view models and must not import or rederive analyzer logic.

## Backlog Order

1. `[FND] Shared deterministic analyze schemas`
2. `[FND] DeterministicAnalysisService wrapper`
3. `[BE] POST /posts/analyze Fastify route`
4. `[FE] EngineApiClient.analyzePosts`
5. `[FND] Deterministic display primitives`
6. `[FE] Writer two-phase generation/scoring state`
7. `[FE] Manual follower context and prediction recompute`
8. `[FE] Slot format vs detected format rendering`
9. `[FE] Deterministic detail inspector`
10. `[INT] Writer deterministic happy path`
11. `[INT] Score retry preserves generated candidates`
