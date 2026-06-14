---
status: in-progress
---

# RMU-014: `accountProfile` settings field

## Implementation Details

Add the multi-line `accountProfile` field to the Settings page, used by the judge for
`audienceMatch`.

1. **`renderTextAreaField`** helper (mirrors `renderTextField`) and **`AccountProfileField`**
   — a `<textarea>` (3–4 rows) mounted in `SettingsRouteView` after the judge-provider select
   (logical grouping with judge settings). Helper copy: "Describe your audience and niche. The
   judge uses this to score audience match."
2. **Wiring (required — these enumerate fields explicitly, so the field must be added to each):**
   - Add `"accountProfile"` to the `TextSettingsFieldName` union; route through `updateTextField`.
   - Add `left.accountProfile === right.accountProfile` to `settingsEqual` (else dirty tracking ignores it).
   - Add `accountProfile: ""` to `defaultSettings` (else `modelFromDefaults`/`createInitialModel` produce an invalid `AppSettings`).
   - Wire `updateField` and the SSR driver (`createSettingsRoutePublicDriver`).
3. The client treats empty/whitespace as "no profile". It does NOT add `accountProfile` to
   the judge request body — the engine reads the persisted settings value (RMU-008/009).

## Data Models

CONSUMES `appSettingsSchema.accountProfile` (RMU-001), persisted by RMU-009.

## Integration Point

`SettingsRouteView` form (after the judge-provider select). User entry: Settings route, edit
the textarea, Save. Terminal outcome: a persisted profile that powers `audienceMatch` on the
next judge (cross-checks RMU-012's null-state recovery flow).

## Scope Boundaries / Out of Scope

Settings UI + dirty/default wiring only. Does NOT send `accountProfile` in the judge request
(engine reads persisted settings). Other settings fields untouched. Zero-trace: no judge-
request wiring on the client.

## Test Strategy & Fixture Ownership

Component. Owning suite: `client/src/shell/tests/settings-route`. Fixture: extend the
`AppSettingsResponse` fixture with `accountProfile`. In-process SSR via the settings public
driver.

## Definition of Done

Field renders, dirty-tracks, persists, and resets with "Use defaults"; `pnpm test` +
`pnpm typecheck` + `pnpm lint` green.

## Acceptance Criteria

- Given Settings loaded, When the user types into the account-profile textarea, Then "Unsaved changes" appears (dirty tracking includes the field).
- Given a profile typed and Saved, When the route reloads, Then the textarea shows the persisted value.
- Given "Use defaults" clicked, Then `accountProfile` resets to "".
- Given an empty profile saved, When the judge runs, Then `audienceMatch` is null and the Studio shows "Needs account profile" (cross-checks RMU-012).

## Visual AC

Multi-line `<textarea>` (3–4 rows) using the `.xb-settings-route__field` tokens,
`--text-measure-ui` max width, helper copy, `<label htmlFor>` + `aria-describedby`.

## Edge Cases

Very long profile shows the max-length helper and is bounded by the schema max;
whitespace-only is treated as empty.
