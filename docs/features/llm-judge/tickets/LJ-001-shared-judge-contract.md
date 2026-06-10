# LJ-001: [FND] Shared Judge Contract

## Goal

Define the provider-neutral wire contract for judging a single draft so engine and
client share one source of truth for the request, verdict, response, and failure code.

## Context

- The codex adapter already exists; this contract is what the engine judge service
  produces and the client renders.
- Verdict shape is intentionally small for the MVP: a numeric rating plus short
  qualitative critique. No ranking, no per-criterion breakdown.

## In Scope

- `judgeDraftRequestSchema`, `judgeVerdictSchema`, `judgeDraftResponseSchema` in
  `shared/src/schemas/judge.ts`.
- Add `judge_failed` to the `apiError` code enum and `judge` to its scope enum in
  `shared/src/schemas/shell.ts`.
- Export the new schemas and inferred types from `shared/src/index.ts`.
- Vitest coverage in `shared/src/schemas/tests/judge.test.ts`.

## Out Of Scope

- Engine service, prompt, or route.
- Client API method or UI.
- Any coupling to the deterministic analysis or prediction schemas.

## Requirements

- Request: `{ text: string }`, `text` length 1..8000.
- Verdict:
  - `rating`: integer 0..10
  - `headline`: string 1..160
  - `strengths`: array of strings (1..240 each), max 5
  - `improvements`: array of strings (1..240 each), max 5
- Response (success): `{ status: "judged", verdict, model: string 1..120, judgedAt: ISO datetime }`.
- Failures reuse the existing `apiError` shape with new code `judge_failed`, scope `judge`.
- Adding the new code/scope must not break existing `apiError` consumers.

## Integration Point

- Producer: engine judge route (LJ-002).
- Consumer: client api client + judge panel (LJ-003).
- User entry point: none in this ticket; the public surface is the schema set.
- Terminal outcome: a schema-valid verdict or a `judge_failed` apiError.

## Acceptance Criteria

- A valid request and a valid full judged response parse successfully.
- An empty draft request fails validation.
- A rating of 11, -1, or 7.5 fails verdict validation.
- More than five strengths or improvements fails validation.
- An `apiError` with code `judge_failed` and scope `judge` parses successfully.

## Test Strategy

- Suite: shared Vitest unit tests.
- Fixture strategy: inline valid verdict object, mutated for negative cases.
- Dependency category: pure schema, no IO.

## Dependencies

- Existing shared Zod schema harness and `apiErrorSchema`.

## Status

DONE — reran the dem-pipeline review gates (spec / test / code / intent / security)
after the initial solo pass. Intent + security PASS; spec/test/code returned
CONCERNS. Applied fixes: `text` now `.trim()`s (whitespace-only drafts rejected);
documented the empty-array and 0-10-scale decisions; test coverage expanded 6 -> 13
(headline caps, per-item string caps, status literal, missing-required field,
model/judgedAt bounds, text upper bound, empty-array accept, apiError non-regression).
Deliberately not changed: `.strict()` on the request (kept non-strict for
consistency with the sibling request schemas; usage is parse-based, not raw-body);
`judgedAt` stays UTC-only `.datetime()` (the LJ-002 producer emits `toISOString()`).
Build + full suite green (360 tests), no regressions.
