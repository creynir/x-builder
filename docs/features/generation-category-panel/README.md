---
status: done
---

# Generation Category Panel

Roadmap note: the left-side post generation section should expose all available generation categories in one bounded box instead of hiding categories behind an awkward overflowing control.

## Architecture Context

This is a UI-only improvement to the existing compose cockpit generation rail. The sizing ambiguity is resolved as `max-height: 70vh` on the generation category panel, not a hard fixed `height` and not a new width contract. Width remains owned by the existing cockpit left pin.

`ComposeCockpit` continues to own category loading through `EngineTransport.getGenerateCategories`, pending state, and generation callbacks. `ComposeGenerateRail` remains presentational: it renders every `GenerateCategory` it receives in DOM order, calls `onGenerate(category)` with the full category object, shows pending state by `category.id`, and keeps cooldown/warming badges informational. The category service now returns 15 generator categories: opportunity-weighted generator lanes first, with corpus metadata overlaid where available, so weak archived formats do not suppress stronger generator options.

The panel itself owns only local DOM scroll. In wide mode, the rail panel must be locally bounded at `70vh` and scroll internally when the returned categories overflow. In stacked mode, the existing cockpit pin may further constrain the effective height to its current `60vh`; this feature must not change stacked cockpit pin sizing or create new layout contracts for the other cockpit zones.

Zero-trace boundary: no changes to generation prompts, scoring, judge behavior, category taxonomy, category ranking/capping, transport contracts, runner bindings, Fastify routes, or composer write behavior.

## API Endpoints

None changed. `EngineTransport.getGenerateCategories`, `EngineTransport.generateIdeas`, and the existing fallback `GET /generate/categories` contract remain unchanged.

## Component Breakdown

- `ComposeGenerateRail` - implementation surface; bounded scroll container around the existing category button list.
- `ComposeCockpit` - unchanged parent mount, category fetch, pending derivation, and generate callback.
- `GenerateCategory` - existing shared category shape consumed as-is, including `recentCount` and `windowDays`.

## Dependencies

- Existing overlay v2 primitives: `Button`, `Badge`, and `Tooltip`.
- Existing overlay browser-test harness and fake transport helpers.
- Existing `GenerateCategory` shared schema.

## Requested Behavior

- Show all available post generation categories in the left-side generation button section.
- Keep the category list inside a bounded box.
- Use an internal scrollbar when more categories are available than fit in the box.
- Requested sizing note resolved for implementation: use `max-height: 70vh` for the category box. Do not add a new hard-coded width.

## Product Boundary

- UI layout improvement only.
- The panel itself is UI-only. The current backend source policy is 15 opportunity-weighted generator lanes, with corpus-backed entries annotated as `top_performer`/`frequent` where available.

## Existing References

- `docs/features/generation-and-judge-surface/README.md`
- `docs/features/x-overlay-browser/README.md`
- `overlay/src/compose/compose-cockpit.tsx`
- `engine/src/server/server.ts` category endpoint wiring, if category availability needs to be checked during implementation.

## Sub-Tickets Overview

1. `GCP-001: Bounded Generation Category Panel`
2. `GCP-002: [INT] Rail Integration Regression`

## Bookkeeping Notes

This is in the next build queue after `smarter-generation-context`.

The implementation agent should verify the current category rendering surface before changing UI and preserve the boundary above.

## Pipeline Log

- 2026-06-28: Arch recon approved with one concern folded into ticket wording: stacked mode is already constrained by the existing `60vh` cockpit pin, so tests must not require rail-only scroll ownership there.
- 2026-06-28: GCP-001 and GCP-002 completed; bounded rail UI and integration regression coverage are in place.
- 2026-06-30: Backend category source corrected from 3–4 ranked formats to 15 opportunity-weighted generator lanes; the rail still renders every returned category.
