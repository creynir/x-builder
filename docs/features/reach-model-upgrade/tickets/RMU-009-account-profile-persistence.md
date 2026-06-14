---
status: in-progress
---

# RMU-009: Persist `accountProfile` in engine settings

## Implementation Details

Wire the `accountProfile` field (added to `appSettingsSchema` in RMU-001) through engine
persistence and the settings route.

1. `JsonFileAppSettingsRepository.save`/`load` round-trip `accountProfile` (no special
   handling needed — it is a plain optional string field on `appSettingsSchema`). Load
   remains fail-soft: an old `settings.json` without `accountProfile` parses and the field
   is `undefined` (no migration).
2. `PATCH /settings` already validates via `appSettingsSchema`; confirm the new field is
   accepted and persisted. `GET /settings` returns it when set.
3. Confirm the judge route (RMU-008) reads `settings.accountProfile` as the fallback when
   the judge request omits it.

## Data Models

`appSettingsSchema.accountProfile` (RMU-001). Persisted under `~/.x-builder/engine-settings`.

## Integration Point

`GET/PATCH /settings`. User entry: the Settings page `accountProfile` field (RMU-014) →
`PATCH /settings`. Terminal outcome: a persisted profile that powers `audienceMatch` on the
next judge.

## Scope Boundaries / Out of Scope

Persistence + route validation only. Zero-trace: no UI (RMU-014), no judge prompt changes
(RMU-008). Other settings fields untouched.

## Test Strategy & Fixture Ownership

Unit; owning suite: `settings-repository` tests + settings route tests. Isolation: temp
root (the existing harness uses temp dirs). In-process.

## Definition of Done

Round-trip works; old files load fail-soft; `pnpm test` + `pnpm typecheck` green.

## Acceptance Criteria

- Given a `PATCH /settings` with `accountProfile: "30-40s founders, SaaS/AI/devtools, mostly non-US"` / Then it persists and `GET /settings` returns it.
- Given an old `settings.json` without `accountProfile` / When loaded / Then it succeeds and `accountProfile` is undefined (no error).
- Given a persisted `accountProfile` and a judge request without one / Then the judge route uses the persisted value (cross-checks RMU-008).

## Edge Cases

Empty/whitespace `accountProfile` is treated as "no profile" by the judge (→ `audienceMatch = null`).
A profile longer than the schema max is rejected at `PATCH` validation.
