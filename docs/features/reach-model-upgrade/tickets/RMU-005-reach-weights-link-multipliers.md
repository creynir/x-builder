---
status: todo
---

# RMU-005: Reach-model weights, external-link detection, repeat/status/quality multipliers

## Implementation Details

Add the data tables and pure helper functions the two-regime engine (RMU-006) composes.
**No assembly of the four-regime output here** — these are tables + helpers only. Every
tuning constant carries `// CALIBRATE`.

1. **`reach-model-weights.ts`** (new const module, sibling of `const/scoring-weights.ts`):
   - `formatReachTable: Record<PostFormat, { p50Multiplier: number; escapeProbability: number }>` — `// CALIBRATE`:
     `fill_blank_tribal 3.0/0.30`, `cta_farm 3.0/0.30`, `fantasy_question 2.5/0.25`, `binary_choice 2.0/0.20`, `connect 1.8/0.15`, `audience_question 1.6/0.15`, `genuine_question 1.2/0.10`, `recognition_roast 1.5/0.12`, `hot_take 1.1/0.08`, `milestone 1.0/0.05`, `ab_choice 1.2/0.10`, `story 0.8/0.04`, `nuanced_question 0.5/0.03`, `wisdom_one_liner 1.0(status-gated)/0.03`, `insight_share 0.3/0.02`. **`Record<PostFormat,…>` must be exhaustive**, so also include `other 1.0/0.05` and neutral entries for the deprecated `one_liner 1.0/0.05` and `goal_share 1.0/0.05` (otherwise typecheck fails).
   - `replyRateTable: Record<PostFormat, number>` — `// CALIBRATE`: `cta_farm 0.020`, `fill_blank_tribal 0.015`, `binary_choice 0.018`, `fantasy_question 0.012`, `audience_question 0.012`, `connect 0.015`, `milestone 0.020`, `genuine_question 0.012`, `recognition_roast 0.008`, `hot_take 0.008`, everything else (incl. `other`, `one_liner`, `goal_share`) `0.005`. Exhaustive over `PostFormat`.
   - Coefficients (`// CALIBRATE`): `stallRangeLowCoeff 0.3`, `stallRangeHighCoeff 1.2`, `escapeRangeLowCoeff 3`, `escapeRangeHighCoeff 12`, `externalLinkMidpointMultiplier 0.2`, `externalLinkEscapeCap 0.03`, `repeatDecayBase 0.55`, `repeatDecayFloor 0.2`, `wisdomStatusDivisor 20000`, `wisdomStatusMin 0.3`, `wisdomStatusMax 1.5`.
2. **`detectExternalLink(text: string): boolean`** in `quality-signal-checks.ts`, co-located with `countUrls`: a match of the existing `/\bhttps?:\/\/[^\s)]+/gi` URL regex is an external link **unless** its host is in a small `mediaAttachmentHosts` allowlist (`pic.twitter.com`, `pbs.twimg.com`, `video.twimg.com`). `t.co` is treated as **external** (link wrapper, ambiguous). **Ambiguous → external** (spec rule). This is the LIVE-analyzer rule; the calibration normalizer uses a different t.co rule (see RMU-016).
3. **`staticQualityCompression(score: number): number`** in `prediction-estimator.ts` — `≥90→1.3`, `≥70→1.1`, `≥50→1.0`, `≥25→0.8`, else `→0.6`. `// CALIBRATE`. ADD this helper (consumed by `computeReachModel` in RMU-006). It does NOT delete the old `staticScoreQualityMultipliers` here — that const is still consumed by the current `estimateEngagementRange` until RMU-006 rebuilds it, so both `staticScoreQualityMultipliers` and `formatEngagementMultipliers` are removed in RMU-006 (zero-trace there).
4. **`computeRepeatMultiplier(repeatHistory, format): number`** — find the entry whose `format` matches; `max(repeatDecayFloor, repeatDecayBase ^ countLast7d)`; no match → `1.0`.
5. **`computeStatusMultiplier(format, followers): number`** — `format === "wisdom_one_liner" ? clamp(followers / wisdomStatusDivisor, wisdomStatusMin, wisdomStatusMax) : 1`.

## Data Models

`formatReachTable`, `replyRateTable`, the coefficient consts; consumes `PostFormat` and
`repeatHistoryEntrySchema` (RMU-001).

## Integration Point

Consumed by `computeReachModel` (RMU-006) and by `DeterministicAnalysisService` (which
calls `detectExternalLink` per item). No standalone user entry; reaches the user through
RMU-006's prediction.

## Scope Boundaries / Out of Scope

Tables + pure helpers only. Zero-trace: no four-regime assembly, no pEscape adjustments,
no judge branch. `evaluateLinkDensity` (the `link_density` quality check) is **untouched**
— different output, different consumer. Trending/tribe lexicons are RMU-007.

## Test Strategy & Fixture Ownership

Unit; inline fixtures + a `buildReachInput()` helper (test-owned, shared with RMU-006).
Assert the `Record<PostFormat, …>` maps compile (exhaustiveness). In-process, pure.

## Definition of Done

Helpers return the specified values; `detectExternalLink` distinguishes media hosts;
`pnpm test` + `pnpm typecheck` green; every constant marked `// CALIBRATE`.

## Acceptance Criteria

- Given text with `https://example.com` / When `detectExternalLink` / Then `true`.
- Given text whose only URL is `https://pic.twitter.com/abc` / When `detectExternalLink` / Then `false` (media host).
- Given text whose only URL is `https://t.co/x` / When `detectExternalLink` / Then `true` (ambiguous wrapper → external).
- Given `repeatHistory` entry for the format with `countLast7d=2` / When `computeRepeatMultiplier` / Then `≈ 0.3025`; with `countLast7d=10` / Then floored to `0.2`.
- Given `wisdom_one_liner` and `followers=1400` / When `computeStatusMultiplier` / Then `0.3`; `followers=20000` → `1.0`; `followers=58000` → `1.5`.
- Given `score=92` / When `staticQualityCompression` / Then `1.3`; `score=10` → `0.6`.

## Edge Cases

`repeatHistory` empty → `repeatMult = 1`. `followers` undefined for a `wisdom_one_liner`
→ status multiplier falls back to `1` (handled by RMU-006's base logic). A deprecated
`one_liner`/`goal_share` entry in `repeatHistory` simply won't match the new detected
format → `repeatMult = 1` (safe no-op).
