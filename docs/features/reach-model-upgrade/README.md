---
status: in-progress
---

# Reach-Model Upgrade

Deterministic two-regime reach model + LLM-judge bridge for the post analyzer. Replaces
the current quality-dominant prediction (quality multiplier 0.35–4.0, format 0.84–1.27)
with a **format-dominant** model: format drives reach, writing quality becomes a gate /
verdict driver only. Adds five judge rubric dimensions, an account-profile input, a
two-pass judge→reach refinement, and an in-repo calibration scaffold.

All tuning constants in this epic are initial placeholders, each marked `// CALIBRATE`,
to be refit by the calibration scaffold once the labeled corpus lands (Phase 4).

## Architecture Context

> Re-read before every ticket — this is the contract that prevents drift.

**Core inversion.** Format multipliers span 0.2×–7× with a fat tail; writing quality is
nearly uncorrelated with impressions. So format becomes the dominant reach lever, and the
0–100 quality score keeps only its gate/verdict job (the score, check pools, `min()`
aggregation in `calculateDeterministicScore`, and verdict bands in `selectPostCoachBadge`
are **unchanged**). The static quality multiplier is compressed to 0.6–1.3.

**Additive-discriminant rule (never rename a UI-consumed field).** New four-regime fields
are added to the `available` variant of `engagementPredictionSchema`; the legacy fields are
**derived** so every existing consumer keeps working:
`rangeLow = stallRange.low`, `rangeHigh = escapeRange.high`, `midpoint = predictedMidImpressions`.
The existing `.refine(rangeLow <= midpoint <= rangeHigh)` and `reachRangeSchema(low <= high)`
are kept valid **by construction, not by coincidence** — the `mid/base` multiplier product is
NOT bounded ≥ 0.3 (e.g. `insight_share 0.3 × low quality 0.6 × repeat 0.2 = 0.036`), so the
band floor and combined high are derived to bracket the honest midpoint without ever clamping
it up (see Two-regime reach below). Spreads are computed in **log space**. `one_liner` and
`goal_share` remain valid `detectedPostFormatSchema` members for one release (the classifier
stops emitting them); removed next release.

**Two-regime reach.** `base = trailingMedianImpressions ?? clamp(0.4·followers, …)`;
`mid = max(1, base · formatMult · qualityMult · linkMult · repeatMult · statusMult)`;
`midpoint = round(mid)` (honest — never clamped up). Bands are derived to bracket the
midpoint for every multiplier product and every `// CALIBRATE` value:
`stallRange = [min(round(0.3·base), midpoint), max(stallLow, round(1.2·mid))]`,
`escapeRange = [round(3·base), max(round(12·base), midpoint)]`,
`rangeLow = stallRange.low`, `rangeHigh = escapeRange.high`.
`escapeProbability` (pEscape) from the per-format table, adjusted; `expectedReplies`
from per-format reply rates. **pEscape vs midpoint discipline:** answer-effort and
trending-topic adjustments move **pEscape / expectedReplies only — never the midpoint**.
The external-link penalty is the one effect that does both: midpoint ×0.2 **and** a
separate pEscape cap at 0.03.

**Canonical contract names (locked after architecture validation).**
- Judge→estimator channel: `scoringContext.judgeSignals: { impressions: int 0-100, replies: int 0-100 }`. The client extracts **only those two scalars** from `verdict.scores` on the pass-2 re-issue.
- Prediction provenance: `qualityBasis: "static" | "judge"` (server-supplied) on the `available` variant. The UI maps `"judge"` → "Refined with judge signal" badge.
- `replyVsQuoteOrientation` is a 0-100 display-only score (100 = reply-collecting, 0 = quote-tweet), not an enum.
- The judge→reach bridge is **greenfield**: today only a latent 0-10 `aiRatingQualityMultipliers` table + dead `aiRating` plumbing exist (never fed by `analyzePosts`). The bridge uses the continuous `judgedQualityMultiplier = clamp(0.5·(2.5/0.5)^(impressions/100), 0.5, 2.5)` keyed off `scores.impressions` (NOT `overall`); the 0-10 table is deleted, not reused. `scores.replies` overrides the deterministic reply rate via `lerp(0.002, 0.025, replies/100)`. Double-count risk (judge also sees format) is documented inline; calibration disentangles it.

**Two-pass flow.** Instant deterministic render (`qualityBasis="static"`) → judge fires in
parallel → on judge success the client re-POSTs `/posts/analyze` with `judgeSignals` →
the refined prediction (`qualityBasis="judge"`) **replaces** the original in the model.
Pre- and post-judge reach are **different scales**; the model holds exactly one prediction
per draft version, so no diff is renderable. Stale-judge races are dropped via
requestId + draft-text equality.

**Calibration by aggregation (not regression).** At ~350 rows over 15+ features, OLS is the
wrong tool. The fit is per-format aggregation: format multiplier = geometric median of
`actual_impressions / trailing_median_imps` per format; `escapeProbability` = empirical
escape-label fraction per format; reply rate = median `replies/impressions` per format;
repeat decay and status curve from per-bucket aggregation. Validation: leave-one-account-out
**Spearman** rank correlation (hand-rolled) + escape-label **AUC** (hand-rolled). No stats
dependency. Accuracy targets (rho ≥ 0.5) are untestable until the corpus lands — calibration
tickets test **mechanics only**.

## API Endpoints

- `POST /posts/analyze` — extend `scoringContext` (new Phase-0 inputs + optional `judgeSignals`); response prediction gains four-regime fields + `qualityBasis`/`baseSource`/`reachModelVersion`. Two-pass: pass-1 (no `judgeSignals`) and pass-2 (with `judgeSignals`).
- `POST /drafts/judge` — request gains optional `accountProfile`; response `scores` gains 5 dimensions. Server falls back to persisted `settings.accountProfile` when the request omits it.
- `GET/PATCH /settings` — `appSettingsSchema` gains optional `accountProfile`.

## Component Breakdown

- `classifyPostFormat` — rebuilt cascade + new `PostFormat` members. Consumed by `analyzeDraftText`, `formatReachTable`, `replyRateTable`, label maps (all `Record<PostFormat, …>`, compile-exhaustive).
- `computeReachModel` (in `prediction-estimator`) — the two-regime engine; replaces the body of `estimateEngagementRange`.
- `reach-model-weights` — new const module (`formatReachTable`, `replyRateTable`, status/link/repeat/range coefficients), all `// CALIBRATE`.
- `detectExternalLink` (in `quality-signal-checks`) — server-side URL-vs-media detection. `evaluateLinkDensity` (the `link_density` quality check) is kept unchanged.
- `trending-topic-lexicon` (dated) + `tribeVocativeTerms` — split out of `timelyTopicTerms`.
- `JudgeDraftService.judge` — +5 dims, `accountProfile` prompt input.
- `toJudgedQualityMultiplier` / reply-rate override — the greenfield bridge.
- `@x-builder/calibration` (`tools/calibration`) — normalizer, predictor-runner, per-format fit, leave-one-account-out validator.
- Client: `AdvancedContextPanel`, `RepeatHistoryControl`, `ReachRegimeBlock`, extended `EngagementPredictionCard`/`JudgePanel`, `AccountProfileField`, `Switch`, and the `WriterPageModel.refinement` two-pass orchestration.

## Dependencies

- `@x-builder/shared` Zod schemas are the cross-package contract (RMU-001 produces all of them).
- LLM judge depends on the existing provider CLIs (codex/claude/cursor) — mocked in tests via the in-process `JudgeLlmGateway` fake; never invoked in `pnpm test`.
- The labeled corpus JSONL is **not yet in the repo**; calibration ships synthetic fixtures and tests mechanics only.

## Sub-Tickets Overview

See `tickets/README.md` for the build-order index. 20 tickets: 1 `[FND]`, 2 `[RFR]`,
1 `[CHORE]`, 10 implementation, 2 `[INT]`, 1 `[E2E]`, 1 `[DOC]`.
