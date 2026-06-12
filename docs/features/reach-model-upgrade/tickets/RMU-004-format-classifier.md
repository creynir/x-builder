---
status: todo
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
10. `milestone` — number + {followers, days, MRR, users, impressions, sales} + first person. (rename/extend of `goal_share`)
11. `story` — ≥3 visible lines + first-person `\b(i|my|we)\b`. (kept)
12. `ab_choice` — bullet list `/^[-*]\s+/m` with ≤5 visible lines. (kept)
13. `nuanced_question` — a question with 2+ clauses, conditional framing, or self-incriminating phrasing ("be honest, do you actually…").
14. `genuine_question` (fallback) — easy single-clause question (`endsWith("?")`, ≤3 visible lines).
15. `wisdom_one_liner` — single visible line, advice/truth claim, no question, no story.
16. `insight_share` — final fallback.
17. `other` — empty input.

Update `predictionFormatLabels` to be exhaustive over the full union. The classifier
**stops emitting** `one_liner` and `goal_share` (still valid schema members per RMU-001).

## Data Models

Consumes `detectedPostFormatSchema` / `PostFormat` from RMU-001. No reach numerics here.

## Integration Point

`analyzeDraftText` → `/posts/analyze` response `detectedFormat` (client renders it raw).
User entry: typing a draft in the writer studio.

## Scope Boundaries / Out of Scope

Classification only. Zero-trace: no edits to reach tables, multipliers, or
`formatReachTable`/`replyRateTable` (RMU-005). Does not remove `one_liner`/`goal_share`
from the schema. No label change for existing members the UI already renders.

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
- Given "I hit 10k followers in 73 days" / When classified / Then `milestone`.
- Given a plain single-clause question "What's your stack?" / When classified / Then `genuine_question` (fallback preserved).
- Given an advice one-liner with no question/story / When classified / Then `wisdom_one_liner`.
- Given each remaining example string in the cascade / When classified / Then it maps to its named member.

## Edge Cases

Empty → `other`. A bulleted A/B list is `ab_choice`, not `binary_choice`. A multi-clause
question that also reads as a hypothetical resolves by cascade order (`fantasy_question`
before `nuanced_question`). The classifier never returns `one_liner`/`goal_share`.
