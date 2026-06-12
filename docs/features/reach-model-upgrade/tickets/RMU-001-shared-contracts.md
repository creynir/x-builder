---
status: todo
---

# RMU-001: [FND] Extend shared Zod contracts

## Implementation Details

Extend `@x-builder/shared` (re-export every new symbol from `shared/src/index.ts`) and
mirror the engine-side types. **Schema-only ticket** — no classifier, estimator, judge, or
UI behavior changes. All new tuning-relevant constants live in later tickets; this ticket
only widens the contracts.

1. **`detectedPostFormatSchema` + `PostFormat`** (in `deterministic-analysis.ts` and engine `types.ts`): add members `fill_blank_tribal`, `cta_farm`, `fantasy_question`, `binary_choice`, `nuanced_question`, `recognition_roast`, `wisdom_one_liner`, `milestone`. Keep existing members including `one_liner` and `goal_share` (deprecated-but-valid for one release — classifier stops emitting them in RMU-004). The union backs `Record<PostFormat, …>` maps, so **every currently-exhaustive map must gain entries for the 8 new members to keep `typecheck` green at this point in the build**: `predictionFormatLabels`, `varietyFormatLabels`, and `formatEngagementMultipliers`. (Those last two entries are transient — `varietyFormatLabels` is deleted in RMU-002 and `formatEngagementMultipliers` in RMU-006; add them anyway so RMU-001 compiles in isolation.) The client renders `detectedFormat` raw — no client label map to update.
2. **`scoringContextSchema`** (replaces the inline `{ followers }` in `analyzePostsRequestSchema`):
   - `followers: z.number().int().positive().optional()` (unchanged)
   - `trailingMedianImpressions: z.number().int().min(0).optional()`
   - `repeatHistory: z.array(repeatHistoryEntrySchema).max(40).default([])`
   - `plannedHourUtc: z.number().int().min(0).max(23).optional()`
   - `willAttachMedia: z.boolean().default(false)`
   - `accountAgeYears: z.number().int().min(0).max(50).optional()`
   - `judgeSignals: judgeSignalsSchema.optional()` (present only on the pass-2 re-issue)
   - `repeatHistoryEntrySchema = z.object({ format: detectedPostFormatSchema, lastPostedAt: z.string().datetime(), countLast7d: z.number().int().min(0).max(100) })`
   - `judgeSignalsSchema = z.object({ impressions: z.number().int().min(0).max(100), replies: z.number().int().min(0).max(100) })`
3. **`availableEngagementPredictionSchema`** — add to the `available` variant (keep all legacy fields):
   - `predictedMidImpressions: int ≥ 0`, `stallRange: reachRangeSchema`, `escapeRange: reachRangeSchema`, `escapeProbability: z.number().min(0).max(1)`, `expectedReplies: z.number().min(0)`, `baseImpressions: int ≥ 0`, `baseSource: z.enum(["trailing_median","follower_estimate"])`, `qualityBasis: z.enum(["static","judge"])`, `reachModelVersion: z.string().min(1).max(40)`.
   - `reachRangeSchema = z.object({ low: int ≥ 0, high: int ≥ 0 }).refine(r => r.low <= r.high)`.
   - Keep the existing `.refine(rangeLow <= midpoint <= rangeHigh)`.
   - **No refine change.** The legacy fields and ranges are **derived in RMU-006 to satisfy both refines by construction** (the multiplier product is not bounded ≥ 0.3, so the band floor / combined high are computed to bracket the honest midpoint — see RMU-006). This ticket only declares the schema; it does not bound the values.
4. **`judgeScoresSchema`** — add (same `judgeScoreValue = z.number().int().min(0).max(100)` contract): `answerEffort`, `strangerAnswerability`, `statusDependency`, `replyVsQuoteOrientation`; and `audienceMatch: judgeScoreValue.nullable()` (nullable, NOT optional — always present on the wire, explicit `null` when no profile). Extend the judge JSON-output schema (`verdictOutputSchema`) and `judgeInstructions` in lockstep in RMU-008.
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
- Legacy fields stay; nothing renamed or removed.

## Test Strategy & Fixture Ownership

Unit. Owning suite: `shared/src/schemas/tests/*` (extend `deterministic-analyze.test.ts`,
`judge.test.ts`, `shell.test.ts`). Inline object fixtures. In-process; no external boundary.

## Definition of Done

`pnpm typecheck` and `pnpm test --filter @x-builder/shared` green. New fields parse; legacy
payloads (no new fields) still parse with defaults applied. All `Record<PostFormat, …>`
maps compile.

## Acceptance Criteria

- Given a legacy analyze request with only `{ followers }` in `scoringContext` / When parsed / Then it succeeds with `repeatHistory: []`, `willAttachMedia: false`, the rest undefined.
- Given an `available` prediction with `stallRange.low=10`, `escapeRange.high=900`, `midpoint=120`, `rangeLow=10`, `rangeHigh=900` / When parsed / Then the ordering refine passes.
- Given judge scores with `audienceMatch: null` and the 4 new numeric dims / When parsed / Then it succeeds; `audienceMatch` omitted entirely → fails (nullable, not optional).
- Given `appSettings` JSON without `accountProfile` / When parsed / Then load succeeds, `accountProfile` undefined.
- Given `scoringContext.judgeSignals.impressions = 101` / Then rejected; given `repeatHistory` with 41 entries / Then rejected.

## Edge Cases

`trailingMedianImpressions = 0` is a present value (not absent). `judgeSignals` absent on
pass-1 is valid. Deprecated `one_liner`/`goal_share` still parse as `detectedFormat` values.
