---
status: done
---

# RMU-001: [FND] Extend shared Zod contracts

## Implementation Details

Extend `@x-builder/shared` (re-export every new symbol from `shared/src/index.ts`) and
mirror the engine-side types. **Schema-only ticket** — no classifier, estimator, judge, or
UI behavior changes. All new tuning-relevant constants live in later tickets; this ticket
only widens the contracts.

**Optional-until-producer rule (load-bearing).** Any field added here whose producer does not
emit it yet is plain `.optional()` at RMU-001 — the producer's ticket tightens it to required
(prediction four-regime fields → RMU-006; judge 5 dims → RMU-008). And **no parse-time
`.default()`** on the new inputs: a default injects keys at parse time, which is a runtime
behavior change and breaks exact-request assertions (e.g. the `/posts/analyze` route forwards
the parsed request and `posts-analyze.test.ts` asserts `toHaveBeenCalledWith(request)`).
Consumers apply use-time defaults instead. This keeps RMU-001 genuinely schema-only and the
engine suite green.

1. **`detectedPostFormatSchema` + `PostFormat`** (in `deterministic-analysis.ts` and engine `types.ts`): add members `fill_blank_tribal`, `cta_farm`, `fantasy_question`, `binary_choice`, `nuanced_question`, `recognition_roast`, `wisdom_one_liner`, `milestone`. **Keep `one_liner`/`goal_share` here ONLY because the live classifier still emits them** — they are deleted in RMU-004 (their last emitter), NOT retained for any compat/“one release” window. The union backs `Record<PostFormat, …>` maps, so **every currently-exhaustive map must gain entries for the 8 new members to keep `typecheck` green at this point**: `predictionFormatLabels`, `varietyFormatLabels`, and `formatEngagementMultipliers` (the latter two maps are deleted wholesale in RMU-002/RMU-006). The client renders `detectedFormat` raw — no client label map to update.
2. **`scoringContextSchema`** (replaces the inline `{ followers }` in `analyzePostsRequestSchema`):
   - `followers: z.number().int().positive().optional()` (unchanged)
   - `trailingMedianImpressions: z.number().int().min(0).optional()`
   - `repeatHistory: z.array(repeatHistoryEntrySchema).max(40).optional()` (NO `.default([])` — consumer uses `repeatHistory ?? []` at use-time, RMU-006)
   - `plannedHourUtc: z.number().int().min(0).max(23).optional()`
   - `willAttachMedia: z.boolean().optional()` (NO `.default(false)` — consumer uses `willAttachMedia ?? false`)
   - `accountAgeYears: z.number().int().min(0).max(50).optional()`
   - `judgeSignals: judgeSignalsSchema.optional()` (present only on the pass-2 re-issue)
   - `repeatHistoryEntrySchema = z.object({ format: detectedPostFormatSchema, lastPostedAt: z.string().datetime(), countLast7d: z.number().int().min(0).max(100) })`
   - `judgeSignalsSchema = z.object({ impressions: z.number().int().min(0).max(100), replies: z.number().int().min(0).max(100) })`
3. **`availableEngagementPredictionSchema`** — the **end-state** `available` variant carries the four-regime fields plus `signals` (kept — real explainability, with new multiplier contents). The final contract has **no** `rangeLow`/`rangeHigh`/`midpoint`/`confidence`.
   - New fields (**all `.optional()` at RMU-001** — the estimator emits them starting in RMU-006, which tightens them to required): `predictedMidImpressions: int ≥ 0`, `stallRange: reachRangeSchema`, `escapeRange: reachRangeSchema`, `escapeProbability: z.number().min(0).max(1)`, `expectedReplies: z.number().min(0)`, `baseImpressions: int ≥ 0`, `baseSource: z.enum(["trailing_median","follower_estimate"])`, `qualityBasis: z.enum(["static","judge"])`, `reachModelVersion: z.string().min(1).max(40)`.
   - `reachRangeSchema = z.object({ low: int ≥ 0, high: int ≥ 0 }).refine(r => r.low <= r.high)` — the only prediction invariant.
   - **Transitional only:** the current estimator + client still read `rangeLow`/`rangeHigh`/`midpoint`/`confidence`, so leave those fields (and their existing `.refine(rangeLow ≤ midpoint ≤ rangeHigh)`) on the variant **for now** — a temporary migration bridge **deleted in RMU-011** when the client migrates, NOT a permanent shim. RMU-019 asserts none survive. (If the pipeline forbids even a transitional field, fold the client field-read migration into RMU-006 so the old fields never coexist with the new — see the build note in the epic README.)
4. **`judgeScoresSchema`** — add the 5 new dims (same `judgeScoreValue = z.number().int().min(0).max(100)` base), **all `.optional()` at RMU-001** (the judge emits only the 8 existing dims until RMU-008): `answerEffort`, `strangerAnswerability`, `statusDependency`, `replyVsQuoteOrientation` each `judgeScoreValue.optional()`, and `audienceMatch: judgeScoreValue.nullable().optional()`. **No conditional refine.** RMU-008 (the producer) tightens them: the 4 behavioral dims → required, and `audienceMatch` → `judgeScoreValue.nullable()` (required on the wire, explicit `null` when no profile — the "nullable, NOT optional" end state lives in RMU-008, not here). `verdictOutputSchema`/`judgeInstructions` are extended in RMU-008.
5. **`judgeDraftRequestSchema`** — add `accountProfile: z.string().trim().min(1).max(600).optional()`.
6. **`appSettingsSchema`** (`shell.ts`) — add `accountProfile: z.string().trim().max(600).optional()`.

## Data Models

All of the above. These are the authoritative cross-package contracts; every later ticket
consumes them by symbol name.

## Integration Point

Producer of all shared contracts. Consumed by `analyzePostsRequestSchema`,
`judgeDraftRequestSchema`, `appSettingsSchema`, the engine analyzer/estimator/judge, and
the client (RMU-010…014). No user-facing behavior on its own; the entry point is the
schemas other modules import.

## Scope Boundaries / Out of Scope

- IN: Zod schema + TS type widening, re-exports, exhaustive map type updates.
- OUT (zero-trace): classifier logic, multiplier tables, the bridge formula, judge prompt text, UI, calibration. No new `// CALIBRATE` constants here.
- Obsolete fields/members are removed within the epic (not retained for compat); any field that outlives its ticket is a temporary migration bridge with a named deletion ticket. No permanent shims.

## Test Strategy & Fixture Ownership

Unit. Owning suite: `shared/src/schemas/tests/*` (extend `deterministic-analyze.test.ts`,
`judge.test.ts`, `shell.test.ts`). Inline object fixtures. In-process; no external boundary.

## Definition of Done

`pnpm typecheck` and **full `pnpm test`** green — RMU-001 changes no runtime behavior (new
fields are optional, no parse-time `.default()`), so the engine suite (incl. `posts-analyze`
exact-request forwarding) stays green without edits. New optional fields parse; a request with
only `{ followers }` round-trips unchanged. All `Record<PostFormat, …>` maps compile.

## Acceptance Criteria

- Given an analyze request with only `{ followers }` in `scoringContext` / When parsed / Then it succeeds and the parsed `scoringContext` deep-equals `{ followers }` — no keys injected (no `.default()`), so `/posts/analyze` still forwards the exact request (`posts-analyze.test.ts` `toHaveBeenCalledWith(request)` stays green).
- Given an `available` prediction with `stallRange={low:10,high:240}` and `escapeRange={low:300,high:900}` / When parsed / Then it succeeds; a `reachRange` with `low > high` is rejected.
- Given a verdict with only the 8 existing dims / When parsed / Then it succeeds (the 5 new dims are optional at RMU-001). Given a verdict that also includes `audienceMatch: null` / Then it succeeds. (RMU-008 adds the test that a full 12-dim verdict must carry the 4 behavioral dims and a present `audienceMatch`.)
- Given `appSettings` JSON without `accountProfile` / When parsed / Then load succeeds, `accountProfile` undefined.
- Given `scoringContext.judgeSignals.impressions = 101` / Then rejected; given `repeatHistory` with 41 entries / Then rejected.

## Edge Cases

`trailingMedianImpressions = 0` is a present value (not absent). `judgeSignals` absent on
pass-1 is valid. `one_liner`/`goal_share` still parse at RMU-001 (the live classifier still emits them); RMU-004 removes them from the enum.

## Pipeline Log

- 2026-06-14 — **Done.** RGB pipeline: Red (`96a2876`) → Blue APPROVE → Green (`c4a515f`) → contract revision (`9a6e29d`, optional-until-producer) → corrective Red (`986c332`, Blue APPROVE) → corrective Green (`df3663e`). Step-7: Blue (Validate Green) APPROVE_WITH_CONCERNS, Yellow APPROVE. [FND] architectural checkpoint APPROVE. Full `pnpm test` green (shared 79 / engine 345 / client 171), `pnpm typecheck` 5/5, `pnpm lint` clean, `gates.py all` clean.
- Contract shape: legacy prediction fields + `one_liner`/`goal_share` kept as **transitional migration bridges** (deleted RMU-011 / RMU-004); new four-regime + judge dims are `.optional()` (tightened by producers RMU-006 / RMU-008); no parse-time `.default()` (use-time defaults in RMU-006).
- **Concern C1 (Blue, non-blocking):** an unrelated 313-line `docs/design-system/ui-uplift-brief.md` (untracked user file) was swept into Green's `c4a515f` by a broad `git add`. No AC/DoD/runtime/test impact. Recommend untracking (`git rm --cached`, keeps file on disk) to keep the RMU-001 changeset auditable. Pending user triage.
