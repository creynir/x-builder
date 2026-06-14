---
status: done
---

# RMU-007: Reach signals — remove tension, split trending/tribe lexicons, answer-effort → pEscape/replies

## Implementation Details

This ticket finishes the reach-signal layer. The answer-effort heuristic and the trending
lexicon are **reach features whose output is a pEscape / expectedReplies adjustment — never
a midpoint multiplier.** That distinction is what keeps the two-regime output honest, so the
ACs assert it explicitly.

1. **Delete the tension signal** — remove the tension regex (`/\b(but|yet|never|actually|instead|however|rather|despite|supposed to)\b/i`) and `tensionMultiplier` (1.25) from `estimateEngagementRange`/weights. It has no corpus support and rewards an AI-slop tell.
2. **Split `timelyTopicTerms`:**
   - **`trending-topic-lexicon.ts`** (new module) with a REQUIRED dated header: `export const trendingTopicAsOf = "<YYYY-MM-DD>"; // CALIBRATE — entries EXPIRE; review every release` and `trendingTopicTerms = ["claude","codex","gpt","gemini","agent","agents", …] as const` (`// CALIBRATE`), plus `trendingTopicBonusPerMatch = 0.15`, `trendingTopicMaxBonus = 0.40` (`// CALIBRATE`). The trending bonus applies to **pEscape**: `escapeProbability *= 1 + min(0.40, 0.15 · matchCount)`.
   - **`tribeVocativeTerms`** (in `rule-lexicon.ts` or the new module): `{founder(s), indie, solo, builder(s), growth, shipping, launch}`. A `tribe_vocative` boolean (true when any term matches) applies **+20% to `expectedReplies` only** — never to midpoint or pEscape.
   - Remove the old blended `timelyTopicTerms` export once the estimator no longer imports it.
3. **Answer-effort heuristic** in `computeReachModel`:
   - explicit constraint "in 1 word" / "in one word" → `escapeProbability *= 1.4`, `expectedReplies *= 2.0`.
   - options list / binary choice → no adjustment (already in the format multiplier).
   - anecdote/justification question ("how did you…", "what made you…", "…and why?") → `escapeProbability *= 0.7`.
   - self-disclosure of failure or money specifics → same `escapeProbability *= 0.7` penalty.

All adjustments compose multiplicatively on the RMU-006 base pEscape; pEscape is clamped to
[0, 1] (and re-capped at 0.03 if `hasExternalLink`, so the external-link cap wins).

## Data Models

`trending-topic-lexicon` exports, `tribeVocativeTerms`. Consumes the RMU-006
`computeReachModel` pEscape/expectedReplies.

## Integration Point

`computeReachModel` → `/posts/analyze`. User entry: auto-score. Terminal outcome: adjusted
escape likelihood + expected replies in the prediction.

## Scope Boundaries / Out of Scope

pEscape + expectedReplies adjustments and lexicon split only. **Zero-trace: none of these
adjustments may touch the midpoint.** No tension code may remain. No judge branch.

## Test Strategy & Fixture Ownership

Unit; `buildReachInput()` builder. In-process. Tests assert the adjustments land on
`escapeProbability` / `expectedReplies` and that `midpoint` is unchanged by them.

## Definition of Done

Tension code gone; lexicons split; `trendingTopicAsOf` present and dated; answer-effort
moves only pEscape/replies; `pnpm test` + `pnpm typecheck` green.

## Acceptance Criteria

- Given a draft containing "…but…" / When analyzed / Then there is NO tension signal and the midpoint matches the no-"but" baseline.
- Given a draft containing "claude" / When analyzed / Then `escapeProbability` gets ×(1+0.15) and the **midpoint is unchanged** by it.
- Given 3+ trending terms / Then the pEscape bonus is capped at +0.40.
- Given a draft ending "…in 1 word?" / Then `escapeProbability` ×1.4 and `expectedReplies` ×2.0 (midpoint unchanged by these).
- Given "how did you build that, and why?" / Then `escapeProbability` ×0.7 (midpoint unchanged).
- Given a founder/builder tribe term / Then `expectedReplies` is +20% and pEscape/midpoint are unchanged by it.
- Given `trendingTopicAsOf` / Then it is a non-empty date string and the module comment flags expiry.

## Edge Cases

A trending term in an external-link post: the 0.03 cap still wins (applied last).
"in 1 word" combined with anecdote phrasing composes both pEscape factors. pEscape never
exceeds 1 after bonuses.

## Pipeline Log

- 2026-06-14 — **Done.** Standard pipeline: Red (`f885f24`) pinned tension-removal + trending/tribe lexicon split + answer-effort, each with a midpoint-unchanged guard (format+score held fixed); scope-confirmed (did NOT touch `quality_tension`/engagement-readiness) → Blue Validate Red APPROVE → Green (`b9bcf85`) removed the prediction tension signal + `tensionMultiplier`, added `trending-topic-lexicon.ts` (dated `2026-06-14`) + `tribeVocativeTerms`, wired trending(pEscape)/tribe(replies+20%)/answer-effort adjustments into `computeReachModel`, re-keyed the transitional `timely_wording` signal to `trendingTopicTerms`, removed blended `timelyTopicTerms` → Green flagged 3 stale RMU-006 contract pins (fixtures contained "agent"/"launch") → Red pin update (`5d898e1`, applied the trending/tribe factors to those pEscape/replies pins; midpoint/ranges unchanged) → Blue (Validate Green) + Yellow both APPROVE. Full `pnpm test` green (engine 482 / client 179 / shared 81), typecheck 5/5, lint clean, gates clean.
- Invariant verified in source: every RMU-007 adjustment writes only `escapeProbability`/`expectedReplies` (midpoint fixed beforehand); external-link 0.03 cap applied LAST; pEscape clamped [0,1]. `tensionMultiplier`/`timelyTopicTerms` removed (zero non-test hits); `quality_tension` quality-score check untouched.
