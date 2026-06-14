---
status: done
---

# RMU-004: Format classifier — new members + corrected cascade

## Implementation Details

Rebuild `classifyPostFormat` (`format-classifier.ts`) as a corrected first-match-wins
cascade. Fixes the confirmed bugs: `connect` matched only 4 literal fragments;
"drop your startup link" wrongly landed in `one_liner`. Note: `goal_share` is **reachable
today** for phrase-trigger posts (a live test asserts it for "My goal is to ship 3
experiments by end of June") — the real gap is that **numeric milestone posts** ("I hit 10k
followers in 73 days") never match its trigger phrases. The new `milestone` class
(rename/extend of `goal_share`) must catch **both** the phrase form and the numeric form, so
Red rewrites the existing `goal_share` assertion to expect `milestone` (not a bogus
"was-unreachable" regression).

New cascade order (first match wins; concepts, not final regexes — write robust detectors):

1. `hot_take` — existing prefix detector (`hot take:`, `unpopular opinion:`, `popular opinion:`, `real talk:`).
2. `genuine_question` (prefix) — `genuine question:` prefix.
3. `fill_blank_tribal` — 2+ parallel lines of shape "X has/is Y" (or "X is full of Y"), followed by a final line that is incomplete, ends with `?`, or ends with `…`/`...`.
4. `cta_farm` — imperative verb {drop, share, show, pitch, tell, name, post, reply with, comment} + possessive/object {your, ur, me, below} **OR** a reciprocity offer ("I'll rate/roast/check/follow"). Catches "drop your startup link", "pitch me your company in 1 word", "show me your homepage".
5. `fantasy_question` — second-person hypothetical with a concrete stake (money amount, "imagine", "you just", "if you had/could/were") that ends with `?`.
6. `binary_choice` — "X or Y?" in ≤ ~8 words, or a question followed by exactly 2 short options. Distinct from `ab_choice` (bulleted lists).
7. `audience_question` — tribe vocative (`Founders,` `Builders,` `Creators,` `Solo founders,` `Indie hackers,` `Makers,`) + a question answerable in < ~10s. (kept)
8. `connect` — pure "let's connect" with NO CTA object (the broadened CTA cases now belong to `cta_farm`).
9. `recognition_roast` — observational humor with a recognizable subject and no advice ("I know a guy", "your X friends", second-person roast, self-deprecating numbers joke).
10. `milestone` — first person AND a number AND either (a) a milestone noun {followers, days, MRR, users, impressions, sales} (numeric-achievement form, e.g. "I hit 10k followers in 73 days"), OR (b) a goal phrase {my goal, aiming to, by end of, i'm going to} (phrase form, e.g. "My goal is to ship 3 experiments by end of June"). This is the rename/**extend** of `goal_share` — it must catch BOTH `goal_share`'s old phrase-trigger posts and the numeric milestones `goal_share` missed.
11. `story` — ≥3 visible lines + first-person `\b(i|my|we)\b`. (kept)
12. `ab_choice` — bullet list `/^[-*]\s+/m` with ≤5 visible lines. (kept)
13. `nuanced_question` — a question with 2+ clauses, conditional framing, or self-incriminating phrasing ("be honest, do you actually…").
14. `genuine_question` (fallback) — easy single-clause question (`endsWith("?")`, ≤3 visible lines).
15. `wisdom_one_liner` — single visible line, advice/truth claim, no question, no story.
16. `insight_share` — final fallback.
17. `other` — empty input.

The classifier no longer produces `one_liner` or `goal_share` (their content is now split
across `wisdom_one_liner` / `recognition_roast` and absorbed by `milestone`). **This ticket
deletes `one_liner` and `goal_share` outright** — remove them from `PostFormat` (`types.ts`)
and `detectedPostFormatSchema` (shared), and from every `Record<PostFormat, …>` map
(`predictionFormatLabels` here; `varietyFormatLabels`/`formatEngagementMultipliers` are
deleted wholesale in RMU-002/RMU-006). They were retained from RMU-001 only because the live
classifier still emitted them — this is their last emitter, so they go now (no deprecation
window, no kept-for-a-release members). After this ticket a payload carrying `one_liner`/`goal_share`
fails to parse.

## Data Models

Consumes `detectedPostFormatSchema` / `PostFormat` from RMU-001. No reach numerics here.

## Integration Point

`analyzeDraftText` → `/posts/analyze` response `detectedFormat` (client renders it raw).
User entry: typing a draft in the writer studio.

## Scope Boundaries / Out of Scope

Classification only. Zero-trace: no edits to reach tables, multipliers, or
`formatReachTable`/`replyRateTable` (RMU-005). **Removes** `one_liner`/`goal_share` from
`PostFormat`/`detectedPostFormatSchema` and `predictionFormatLabels` (per Implementation
Details — they are no longer emitted; `varietyFormatLabels`/`formatEngagementMultipliers`
are deleted wholesale in RMU-002/RMU-006). No label change for the members the UI still renders.

## Test Strategy & Fixture Ownership

Unit. Owning suite: engine deterministic tests (extend the existing classifier test).
Fixture: a test-owned `corpusExamples` table mapping every spec example string → expected
member. In-process, pure.

## Definition of Done

Every example string in the cascade above classifies to its named member; the two named
regression cases pass; `pnpm test` + `pnpm typecheck` green; `predictionFormatLabels`
exhaustive.

## Acceptance Criteria

- Given "drop your startup link" / When classified / Then `cta_farm` (was `one_liner`).
- Given "Codex or Claude Code?" / When classified / Then `binary_choice`.
- Given "pitch me your company in 1 word" / When classified / Then `cta_farm`.
- Given "USA has ChatGPT / China has DeepSeek / Europe has?" / When classified / Then `fill_blank_tribal`.
- Given "You just sold your company for $100M. What's the first thing you do?" / When classified / Then `fantasy_question`.
- Given "be honest, do you actually ship on weekends, or just tweet about it?" / When classified / Then `nuanced_question`.
- Given "I hit 10k followers in 73 days" / When classified / Then `milestone` (numeric-achievement form).
- Given "My goal is to ship 3 experiments by end of June" / When classified / Then `milestone` (phrase form — the legacy `goal_share` assertion is rewritten to expect `milestone`, NOT a "was-unreachable" regression and NOT `wisdom_one_liner`).
- Given a plain single-clause question "What's your stack?" / When classified / Then `genuine_question` (fallback preserved).
- Given an advice one-liner with no question/story / When classified / Then `wisdom_one_liner`.
- Given each remaining example string in the cascade / When classified / Then it maps to its named member.

## Edge Cases

Empty → `other`. A bulleted A/B list is `ab_choice`, not `binary_choice`. A multi-clause
question that also reads as a hypothetical resolves by cascade order (`fantasy_question`
before `nuanced_question`). The classifier never returns `one_liner`/`goal_share`.

## Pipeline Log

- 2026-06-14 — **Done.** Standard pipeline: Red (`1302dd6`) corpus cascade + `one_liner`/`goal_share` schema-rejection + reclassified prediction pins → Blue Validate Red APPROVE (reclassification math independently recomputed) → Green (`2e94f67`) rebuilt the 17-step cascade + deleted both members (shared enum, engine `PostFormat`, `predictionFormatLabels`, `formatEngagementMultipliers`) → Blue (Validate Green) APPROVE (regexes linear on 100k inputs; pre-Green checkout = 16 fails) + Yellow (intent) APPROVE (full live-path trace; real detectors; zero orphans). Full `pnpm test` green (shared 79 / engine 383 / client 179), typecheck 5/5, lint clean, `gates.py all` clean, `rg` zero non-test hits for the deleted members.
- Note: ticket initially self-contradicted (Implementation Details said delete; stale Scope-Boundaries line said keep) — proceeded with deletion per the epic clean-replacement principle + RMU-001/RMU-019; the Scope line was subsequently corrected.
- Transitional consequence (flagged by Red, confirmed by Blue): reclassified single-line drafts (old `one_liner`→`wisdom_one_liner`) hit the neutral `1.0` `formatEngagementMultipliers` fill (RMU-001) on the un-rebuilt estimator → lose the `format_*` signal → confidence drops `medium`→`low`. Pinned as the new reality; **RMU-006 supersedes** it when it rebuilds the estimator/multipliers.
- Yellow notes (non-blocking, intended): `wisdom_one_liner` (step 15) catches any surviving single line (not only "advice/truth" — descriptive prose, per "concepts not regexes"); `milestone` (step 10) requires a literal digit (consistent with legacy `goal_share`).
