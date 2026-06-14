---
status: done
---

# RMU-003: [RFR] Extract `Switch` foundation component

## Refactor Scope

- Add `Switch` to `foundation.tsx` (client UI library), wrapping a native checkbox with the project's tokenized switch styling. No headless-primitive dependency.
- Refactor the settings route's `renderSwitch` / `orderedSwitches` usage (`settings-route.tsx`) to use the new `Switch`.
- Nothing else. `AdvancedContextPanel` (RMU-010) and `AccountProfileField` (RMU-014) consume `Switch` after it exists.

## Behavior-Preservation Invariants

- The "Show deterministic details" switch renders identically before and after: same label, checked state, `id`, `htmlFor` wiring, change handler, dirty tracking, and keyboard toggle (Space/Enter).
- The settings route SSR output for the switches is unchanged (verified via the existing `createSettingsRoutePublicDriver` snapshot).

## Integration Point

Settings route (existing mount). Newly available to the writer studio's advanced-context
panel and any future tokenized toggle.

## Scope Boundaries / Out of Scope

Behavior-preserving extraction only. Zero-trace: no new switch behavior, no new tokens, no
new props beyond what `renderSwitch` already supported. Does not adopt `Switch` in the
writer panel (that happens in RMU-010).

## Test Strategy & Fixture Ownership

Characterization pipeline: pinning tests derived from the existing settings-route switch
tests. Add a focused `Switch` component test under `client/src/ui/tests`. In-process SSR
render; no external boundary.

## Definition of Done

`pnpm test` + `pnpm typecheck` green; settings switches behave and render identically;
`Switch` is exported from `foundation.tsx`.

## Acceptance Criteria

- Given the settings route / When rendered before and after / Then the switch markup, label, and checked state are identical.
- Given the new `Switch` / When toggled by keyboard (Space) / Then it flips checked state and fires `onChange`.

## Edge Cases

Disabled state and `aria-checked` must match the prior inline markup.

## Pipeline Log

- 2026-06-14 — **Done.** Hybrid characterization pipeline: Red-RFR pinned settings-route switch behavior (`bdd6b78`) + added a `Switch` extraction-target test; the Switch test initially required `aria-checked` which conflicted with the no-`aria-checked` behavior-preservation pin — orchestrator caught it, Red corrected (`784629f`) to a bare-native-checkbox contract (matches the prior markup per the Edge Case). Blue Validate Pinning APPROVE (mutation-tested). Pre-Green gate: settings 31/31 green. Green (`113bf8a`) extracted a reusable `Switch` to `foundation.tsx` + rewired settings via a thin `renderSwitch` adapter → 179/179 client, full suite green, settings SSR byte-stable, zero test-path changes. Blue (Validate Green/RFR) + Yellow (facade) both APPROVE_WITH_CONCERNS.
- **Concern C2 (Blue+Yellow, non-blocking):** the foundation `Switch` defaults `className` to the route-specific `xb-settings-route__switch` token, and its inner label span hardcodes `xb-settings-route__switch-label` with no override prop. Behavior-preserving and parameterized (`className` overridable), so not fixable here without breaking the byte-stable pinning. **Forward-note for RMU-010/014:** the next consumers must pass an explicit `className`, and a foundation-token rename / label-class prop should be added when `AdvancedContextPanel`/`AccountProfileField` adopt `Switch`.
