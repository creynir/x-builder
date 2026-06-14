---
status: done
---

# RMU-006: Two-regime reach output + expectedReplies + base override + disabled-guard fix

## Implementation Details

Replace the body of `estimateEngagementRange` with `computeReachModel`, assembling the
four-regime output from the RMU-005 tables/helpers. Spreads computed in **log space**.

1. **Base + disabled-guard precedence.** Respecify `toEngagementPrediction`'s disabled logic
   (the live followers-first short-circuit is a bug under the new spec):
   - (a) `followers` absent **AND** `trailingMedianImpressions` absent → `{ status:"disabled", reason:"missing_followers" }`.
   - (b) else if the analyzer prediction is `null` (text < `minimumTextLength`) → `{ status:"disabled", reason:"text_too_short" }` (precedence unchanged from today).
   - (c) else → `available`. `base = trailingMedianImpressions ?? clamp(0.4·followers, existing follower bounds)`; `baseSource = trailingMedianImpressions !== undefined ? "trailing_median" : "follower_estimate"`. Floor `base` to ≥1 before any log-space computation.
   `computeReachModel`'s own null-guard uses the SAME "followers undefined AND median undefined" condition so the two guards agree (no split-brain).
2. **Midpoint.** `mid = base · formatMult · qualityMult · linkMult · repeatMult · statusMult` where `formatMult = formatReachTable[format].p50Multiplier`, `qualityMult = staticQualityCompression(score)` (static path only here — judge branch is RMU-008), `linkMult = hasExternalLink ? externalLinkMidpointMultiplier(0.2) : 1`, `repeatMult = computeRepeatMultiplier(...)`, `statusMult = computeStatusMultiplier(...)`.
3. **pEscape.** `escapeProbability = formatReachTable[format].escapeProbability`, adjusted: ×0.5 if format ∈ {`nuanced_question`, `wisdom_one_liner`, `insight_share`}; **capped at `externalLinkEscapeCap` (0.03) when `hasExternalLink`**. Answer-effort and trending adjustments are added in RMU-007 (neutral here).
4. **Ranges (log space) — each kept internally ordered by construction.** The multiplier product is NOT bounded ≥ 0.3 (e.g. `insight_share 0.3 × static-low 0.6 × repeat 0.2 = 0.036`), so `mid` can fall far below `0.3·base`; a naive `[0.3·base, 1.2·mid]` would invert (`low > high`). With `mid` floored to `≥1` and `predictedMidImpressions = round(mid)` (honest, never clamped):
   - `stallRange = [round(min(0.3·base, mid)), round(max(0.3·base, 1.2·mid))]`  — `low ≤ high` for every product (`low ≤ 0.3·base ≤ high`, and `low ≤ mid ≤ 1.2·mid ≤ high`)
   - `escapeRange = [round(3·base), round(12·base)]`  — `3 < 12`, always ordered

   This guarantees `reachRangeSchema(low ≤ high)` for both ranges regardless of the product or any `// CALIBRATE` value. There is **no** cross-field `rangeLow ≤ midpoint ≤ rangeHigh` invariant in the end state — those legacy fields are gone (removed in RMU-011).
5. **expectedReplies.** `mid · replyRateTable[format]` (static path; judge `replies` override is RMU-008; tribe +20% is RMU-007).
6. **Set the new fields.** `predictedMidImpressions = round(mid)`, `stallRange`, `escapeRange`, `escapeProbability`, `expectedReplies`, `signals`, `qualityBasis = "static"`, `baseSource`, `baseImpressions = base`, `reachModelVersion`. **Temporary migration bridge (deleted in RMU-011):** because the un-migrated client still reads them, also populate `rangeLow = stallRange.low`, `rangeHigh = escapeRange.high`, `midpoint = predictedMidImpressions`, `confidence` — solely to keep the client compiling/working until RMU-011 migrates it. This is NOT a permanent shim and carries no semantic weight. (If the pipeline forbids even a transitional bridge, fold the client field-read migration into this ticket and emit the new fields only.)
7. **Confidence (transitional).** `confidence` is a legacy field; compute it via the existing ladder only as part of the bridge, and delete it with the bridge in RMU-011. The four-regime output + pEscape is what replaces it for the user — add no new confidence behavior here.
8. **Service wiring + use-time defaults.** `DeterministicAnalysisService.analyzePosts` reads the full `scoringContext` and computes `hasExternalLink = detectExternalLink(item.text)` per item, passing `{ followers, trailingMedianImpressions, repeatHistory, hasExternalLink }` into `analyzeDraftText`. The scoringContext inputs carry **no schema `.default()`** (RMU-001 rule), so apply defaults at use-time here: `repeatHistory ?? []`, `willAttachMedia ?? false`.
8b. **Tighten the prediction schema (this ticket is the producer).** The four-regime fields were `.optional()` at RMU-001 because nothing emitted them; the rebuilt estimator now ALWAYS emits them, so tighten `predictedMidImpressions`, `stallRange`, `escapeRange`, `escapeProbability`, `expectedReplies`, `baseImpressions`, `baseSource`, `qualityBasis`, `reachModelVersion` to **required** in `availableEngagementPredictionSchema`. (The legacy bridge fields stay until RMU-011.)
9. **Delete the now-dead legacy constants** (zero-trace — they go dead the moment `estimateEngagementRange` is rebuilt onto `formatReachTable`/`staticQualityCompression`): remove `formatEngagementMultipliers` and `staticScoreQualityMultipliers` (and the `scoreBand`/`formatMultiplier` lookups that referenced them) from `const/scoring-weights.ts` and `prediction-estimator.ts`. RMU-002 could not (both were still live then).

## Data Models

Produces the `available` prediction four-regime fields from RMU-001. Consumes RMU-005
tables/helpers.

## Integration Point

`POST /posts/analyze` pass-1 (`qualityBasis="static"`). User entry: auto-score in the
writer studio (debounced). Terminal outcome: four-regime prediction rendered (RMU-011).

## Scope Boundaries / Out of Scope

Static-quality path only. Zero-trace: no `judgeSignals` branch (RMU-008), no answer-effort
/ trending / tribe adjustments (RMU-007 — keep them neutral here). Quality score, check
pools, `min()` aggregation, and verdict bands are UNCHANGED. This ticket also removes the
now-dead `formatEngagementMultipliers` and `staticScoreQualityMultipliers` (step 9) — after
it, `rg` for either symbol returns zero non-test hits.

## Test Strategy & Fixture Ownership

Unit + extend the `/posts/analyze` response-shape test. `buildReachInput()` builder
(shared with RMU-005). In-process.

## Definition of Done

Four-regime fields present and ordered; disabled-guard precedence correct; log-space
spreads; `pnpm test` + `pnpm typecheck` green.

## Acceptance Criteria

- Given `followers=5000`, no median, format `cta_farm` / When analyzed / Then `baseSource="follower_estimate"`, `escapeRange=[round(3·base), round(12·base)]`, `predictedMidImpressions=round(mid)`, `qualityBasis="static"`, and both ranges ordered.
- Given `trailingMedianImpressions=2000` present and `followers` ABSENT / When analyzed / Then the prediction is `available` with `baseSource="trailing_median"` and base derived from 2000 (NOT `disabled/missing_followers`).
- Given `trailingMedianImpressions=2000` AND followers present / Then `baseSource="trailing_median"` (median wins).
- Given BOTH `followers` and `trailingMedianImpressions` absent / Then `disabled` with `reason="missing_followers"`.
- Given a base present but text < 15 chars / Then `disabled` with `reason="text_too_short"` (precedence preserved).
- Given an external-link draft / Then `predictedMidImpressions` is ×0.2 **and** `escapeProbability ≤ 0.03` (the cap moves pEscape; the ×0.2 moves the midpoint — separate effects).
- Given format `nuanced_question` / Then `escapeProbability` is half the table value.
- Given a worst-case low-multiplier draft — `insight_share` × static-low quality (0.6) × repeat (`countLast7d≥10`→0.2) × external-link (0.2), product ≈ 0.0072·base / When analyzed / Then the prediction PARSES (no Zod throw): `stallRange.low ≤ stallRange.high` and `escapeRange.low ≤ escapeRange.high`; `predictedMidImpressions` is the honest `round(mid)`, NOT clamped up to `0.3·base`.
- Given any `available` prediction (any multiplier product, any `// CALIBRATE` value) / Then both `stallRange` and `escapeRange` are ordered (`low ≤ high`) — by construction (step 4).
- Given the merged engine / When `rg` for `formatEngagementMultipliers` and `staticScoreQualityMultipliers` runs / Then zero non-test hits (deleted per step 9).

## Edge Cases

`trailingMedianImpressions=0` is a present value → `available`/`trailing_median`, base
floored to ≥1 (also closes the `log(0)` risk). Both base inputs absent → `missing_followers`.
`statusMult` only applies to `wisdom_one_liner`.

## Pipeline Log

- 2026-06-14 — **Done.** Standard pipeline (model rebuild): Red (`34a9248`) two-regime + disabled-guard + by-construction ranges + schema-tightening + rewrote 6 old-model pin files → Blue Validate Red **REJECT** (follower-estimate base only derived-from-produced, never hard-pinned — a base-computation bug would slip through) → Red fix (`1502795`, hard-pinned base 5000→2000, floor 100→80, cap 50000→4000) → Blue APPROVE → Green (`40a8b77`) `computeReachModel` + disabled-guard fix + schema tightening (9 fields → required) + deleted `formatEngagementMultipliers`/`staticScoreQualityMultipliers` → Green flagged the tightening broke 3 client fixtures → Red fixture update (`0c5f384`, added the four-regime fields to the client available-prediction fixtures) → Blue (Validate Green) + Yellow both APPROVE. Full `pnpm test` green (shared 81 / engine 466 / client 179), typecheck 5/5, lint clean, gates clean, deleted consts zero non-test hits.
- F1 resolved in code: ranges ordered by construction (`stallRange=[round(min(0.3·base,mid)), round(max(0.3·base,1.2·mid))]`, `escapeRange=[round(3·base),round(12·base)]`); honest midpoint never clamped up (verified by the worst-case + 16×4×2 ordering sweep). Base unambiguous (`baseImpressionsPerThousandFollowers=400` ⇒ `clamp(0.4·followers,80,4000)`).
- Transitional bridge: legacy `rangeLow`/`rangeHigh`/`midpoint`/`confidence` derived from the regimes, live consumer (client `components.tsx`) today, **deleted in RMU-011**. Confidence signal_key renamed `zeitgeist`→`timely_wording` (within the transitional confidence bridge; no new behavior).
