---
status: in-progress
---

# GCP-001: Bounded Generation Category Panel

## Implementation Details

Update `ComposeGenerateRail` so its existing category-list panel is a bounded scroll container:

```ts
{
  maxHeight: "70vh",
  overflowY: "auto",
  overscrollBehavior: "contain",
  boxSizing: "border-box",
}
```

Keep the existing token-driven panel styling, vertical category button stack, `Button` ghost/block usage, pending loading state, cooldown/warming `Badge` + `Tooltip`, label truncation, and full-object `onGenerate(category)` callback behavior.

Do not introduce a new component unless the existing component cannot express the panel boundary cleanly. Do not change `ComposeCockpit` category loading, generation callbacks, or pin sizing for this ticket.

## Data Models

No schema changes.

`GenerateCategory` is consumed as currently defined:

```ts
type GenerateCategory = {
  id: string;
  label: string;
  format: DetectedPostFormat;
  basis: "top_performer" | "frequent" | "default";
  cooldownStatus: CooldownStatus;
  sampleCount: number;
  recentCount: number;
  windowDays: number;
};
```

Test fixtures for this component must include `recentCount` and `windowDays` explicitly, or be constructed through the shared schema so stale older fixture shapes cannot hide drift.

## Integration Point

Parent mount: `ComposeCockpit` renders `ComposeGenerateRail` inside the existing left cockpit pin when the compose context is active.

User entry point: the user opens the X composer through the overlay runner; `ComposeCockpit` loads categories and the left rail appears.

Terminal outcome: every returned category remains visible or reachable by scrolling within the bounded rail panel; clicking a category still triggers the existing generate flow through `onGenerate(category)`.

## Scope Boundaries / Out of Scope

In scope:

- Rail-local bounded panel styling.
- Internal vertical scroll for long category lists in the rail panel.
- Current category button, pending, cooldown, tooltip, and click behavior.
- Updating rail-owned browser tests and rail-owned category fixtures.

Out of scope, with zero code changes:

- Category source, ranking, capping, taxonomy, or labels.
- `GenerateCategoryService`, `EngineTransport`, runner bindings, Fastify routes, or shared transport schemas.
- Generation prompts, judge behavior, scoring behavior, apply-all behavior, or composer write behavior.
- Cockpit pin sizing. In stacked mode, the existing outer pin may further constrain effective height to `60vh`.
- Repointing the top-level Playwright E2E harness.

## Test Strategy & Fixture Ownership

Coverage level: overlay component/browser tests.

Owning suite: `ComposeGenerateRail` browser tests.

Fixture strategy: use the overlay-owned generate-category fixture helpers, updated to the current `GenerateCategory` shape with `recentCount` and `windowDays`, plus a synthetic long-list builder local to the owning test area.

Dependency category: in-process React/browser render only. No engine, runner, real X session, live transport, filesystem, or persisted user state.

Isolation boundary: shadow-host browser-test harness with design tokens seeded; no reliance on page scroll, open ports, real runtime state, or customer-owned data.

Expected Red tests:

- Long-list rendering proves every supplied category label appears.
- The rail panel exposes `max-height: 70vh`, `overflow-y: auto`, scroll containment, and border-box sizing.
- Pending state remains limited to the matching `category.id`.
- Cooldown/warming badge and tooltip behavior remain intact.
- Full-object click payload remains intact.
- Empty categories still render no rail content.

## Definition of Done

- `ComposeGenerateRail` has a local `maxHeight: "70vh"` panel boundary.
- Overflow remains internal to the rail panel in wide mode.
- Existing category rendering, pending, cooldown, tooltip, truncation, and click behavior remains unchanged.
- Current category fixtures no longer describe or rely on the older pre-`recentCount` / pre-`windowDays` shape.
- Targeted overlay browser tests pass.
- Overlay typecheck passes for touched files.

## Acceptance Criteria

- Given many categories, when `ComposeGenerateRail` renders, then every category label is present and the panel has an internal vertical scroll boundary.
- Given a pending category id, when the rail renders, then only that category button is disabled/loading and sibling buttons remain enabled.
- Given a category with `cooldownStatus` other than `clear`, when the rail renders, then its warning badge and tooltip remain visible without disabling the category.
- Given an empty category list, when the rail renders, then it returns no panel content and does not throw.
- Given a user clicks a category, when `onGenerate` fires, then the callback receives the full `GenerateCategory` object.

## Visual AC

- The rail panel uses the existing Aurora/neon tokens: `--xb-surface-panel`, `--xb-border-edge`, `--radius-md`, and `--space-*`.
- The rail panel uses `max-height: 70vh`; it does not add a new hard-coded width.
- Long labels remain one-line truncated with the full label preserved through the existing title/accessibility behavior.
- No horizontal overflow is introduced by long labels or cooldown badges.
- Wide mode proves the rail panel itself is bounded and scrollable.
- Stacked mode respects the existing stacked cockpit pin constraint; the ticket must not require changing the outer `60vh` stacked pin.

## Edge Cases

- One category.
- Empty categories array.
- Unknown pending id.
- Very long category labels.
- Many cooldown/warming categories.
- Category load failure in `ComposeCockpit` producing `[]`.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon; stacked-mode scroll ownership concern folded into Visual AC and scope boundaries.

- 2026-06-28: RGB pipeline started; pre-flight passed and ticket moved to in-progress.
