---
status: done
---

# EXS-007: Add ExternalXSignals settings section

## Implementation Details

Add `ExternalXSignalsSettingsSection` to the existing settings panel flow. `SettingsAffordance` owns all transport calls and loadable/action state. `SettingsPanel` remains presentational and renders the section between Feedback loop and X archive.

The section manages external X signal sources and displays server-derived external evidence patterns. It must not compute patterns client-side and must not describe external evidence as the user's captured posts or post library.

## Data Models

`SettingsAffordance` adds a loadable overview and action state:

```ts
type ExternalXSignalsActionState =
  | "idle"
  | { status: "adding"; screenName: string }
  | { status: "refreshing"; sourceId: string }
  | { status: "removing"; sourceId: string }
  | { status: "failed"; operation: "add" | "refresh" | "remove"; message: string; sourceId?: string };
```

`ExternalXSignalsSettingsSection` props include overview, action state, and callbacks that call only canonical transport methods:

- `getExternalXSignalsOverview(request?)`
- `addExternalXSignalSource(request)`
- `removeExternalXSignalSource(request)`
- `refreshExternalXSignalSource(request)`

## Integration Point

Producer: `SettingsAffordance` state/callbacks and `ExternalXSignalsSettingsSection` UI.

Known consumers: settings dialog users and E2E tests.

User entry point: click the existing settings launcher in the overlay.

Terminal outcome: the user can add, refresh, remove, and inspect external signal sources and evidence-backed patterns inside the settings panel.

## Scope Boundaries / Out of Scope

In scope: settings state, section rendering, add/remove/refresh handlers, overview refresh after mutations, empty/loading/error/populated states, and overlay tests.

Out of scope: no backend aggregation, no route changes, no transport method additions, no new design-system primitives, no standalone route/page, no active navigation automation, no X credential UI, no publish actions.

Zero-trace: no client-side pattern computation, no hardcoded fake source rows, no stale transport method names.

## Test Strategy & Fixture Ownership

Coverage level: overlay component/browser tests. Owning suite: overlay settings tests using `FakeEngineTransport` and token-seeded shadow host. Fixture strategy: schema-valid overview fixtures for empty/loading/error/populated, add duplicate response, refresh pending response, remove response, and long evidence text. Dependency category: in-process fake transport. Isolation boundary: no real runner, browser CDP, x.com, network, or user storage.

## Definition of Done

- Settings open fetches external overview in parallel with existing settings data.
- Add calls `addExternalXSignalSource` and refreshes overview on success.
- Remove calls `removeExternalXSignalSource` and refreshes overview on success.
- Refresh calls `refreshExternalXSignalSource` and refreshes overview on success.
- Empty/loading/error/populated states render without breaking existing settings sections.
- External evidence copy is distinct from own captured posts.

## Acceptance Criteria

- Given settings opens / When external overview is loading / Then the ExternalXSignals section renders a `Skeleton` without shifting other sections.
- Given no external sources / When overview resolves / Then an `EmptyState` invites adding a source.
- Given a valid handle / When the user submits the add form / Then `addExternalXSignalSource` is called and overview refreshes.
- Given a source row / When the user clicks refresh / Then `refreshExternalXSignalSource` is called and row busy state is visible.
- Given a source row / When the user clicks remove / Then `removeExternalXSignalSource` is called and overview refreshes.
- Given external patterns / When overview resolves / Then pattern rows show labels, badges, source/evidence counts, and capped evidence previews.

## Visual AC (UI tickets only)

Use existing v2 primitives: `Input`, `Button`, `Badge`, `Alert`, `EmptyState`, `KeyValueList`, `Skeleton`, and `IconButton` only if an existing icon source is already available.

Use existing settings density and tokens: `var(--space-2)`, `var(--type-body-small)`, `var(--xb-text-muted)`, `var(--xb-text)`, `var(--xb-border-edge)`, `var(--border-width-thin)`, and existing badge variants. No nested cards, no marketing layout, no new global CSS. Long handles, post IDs, and evidence previews wrap or truncate without resizing the panel. Status feedback uses text and `aria-live="polite"`; it is not color-only.

## Edge Cases

- Duplicate source returns existing source copy without rendering two rows.
- Add/refresh/remove failures render inline `Alert` copy and preserve current overview.
- Refresh pending/no-observation state is visible and honest.
- Long evidence text does not overflow the settings panel.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented `ExternalXSignalsSettingsSection` in the settings dialog, with `SettingsAffordance` owning canonical transport calls and load/action state.
- 2026-06-28: Verification: `./node_modules/.bin/vitest run src/settings/settings-panel.test.tsx src/settings/settings-affordance.test.tsx` (31 passed); `git diff --check`; RGB `gates.py all --base c6a83fb`.
- 2026-06-28: Overlay typecheck was run and remains blocked by pre-existing unrelated test fixture drift in provenance, generate categories, and judge-strip tests; no EXS-007 files appeared in the failure list.
