---
status: done
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

## Pipeline Log

- 2026-06-14 — **Done.** Standard pipeline, single clean cycle: Red (`68939a5`) extended the owning suite `client/src/shell/tests/settings-route.test.tsx` (+9 tests: AC1 dirty, AC2 persist+reload, AC3 reset, the whitespace edge, and the Visual/a11y set — position-after-`</select>`, rows 3–4, `.xb-settings-route__field` wrapper + exact label/helper copy, `id="settings-accountProfile"`/`<label for>`/`aria-describedby`→helper, and React-SSR escaped controlled-textarea inner-text) → Blue Validate Red APPROVE (anti-rubber-stamp: catches `<input>`-instead-of-`<textarea>`, missing `settingsEqual`, wrong position, dropped `aria-describedby`; confirmed Red's test-local-type widening is the established suite pattern + the React-SSR inner-text helpers are correct). Green (`295eab4`): `"accountProfile"` added to `TextSettingsFieldName`, `accountProfile: ""` to `defaultSettings`, `left.accountProfile === right.accountProfile` to `settingsEqual`, an `accountProfileHelper` const + a `renderTextAreaField` local helper (mirrors `renderTextField`) mounted after the judge-provider select, routed through `updateTextField` + the public driver, plus a token-only `.xb-settings-route__field textarea` CSS rule (`--text-measure-ui` max-inline-size) + `textarea:focus-visible` → Blue (Validate Green) APPROVE + Yellow APPROVE — **no concerns**. Full client suite **246 passed / 0 failed**, typecheck + lint clean, gates clean. Zero-trace confirmed: the client judge caller posts only `{ text }`; the engine resolves `accountProfile` from persisted settings (RMU-008/009); writer/judge code untouched. AA contrast inherited from the established settings-field tokens.
