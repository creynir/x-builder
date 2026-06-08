# [FND] Deterministic Text Enrichment Checks

## Goal

Enrich the deterministic analyzer with additional text-only Post Coach checks that are explainable, local, and relevant to X-like post performance without claiming to emulate X ranking.

## Context

- Public X sources describe For You as a personalized recommendation system with candidate sourcing, user/context hydration, ML ranking, multi-action predictions, and filtering.
- The deterministic engine is not an X ranking model. It is a pre-post writing signal checker.
- Existing analyzer checks already cover hook, tension, concreteness, value, rhythm, weak closers, AI tells, buzzwords, hashtags, format, and engageability.
- Existing `VoiceCheck[]` is enough for this ticket. Do not change shared schemas.
- UI and API consumers should receive these checks through existing `score.checks` and engine-produced Post Coach sections.

## Sources

- X For You feed public repository: `https://github.com/xai-org/x-algorithm`
- Phoenix public README: `https://raw.githubusercontent.com/xai-org/x-algorithm/main/phoenix/README.md`
- X engineering post, 2023 recommendation algorithm: `https://blog.x.com/engineering/en_us/topics/open-source/2023/twitter-recommendation-algorithm`
- X recommendations policy/help page: `https://help.x.com/en/rules-and-policies/recommendations`

## Non-Goals

- No LLM call.
- No X API call.
- No profile lookup.
- No imported metrics dependency.
- No profile-health claim.
- No visible `reply_score`, `profile_click_score`, `dwell_score`, or other probability-like subscore.
- No claim that the app predicts X ranking, X reach, or production action weights.

## Requirements

- Add deterministic text-only checks to the canonical analyzer.
- Checks must return existing `VoiceCheck` fields only: `id`, `label`, `status`, and optional `kind`.
- Most new findings should be `warn`, not `fail`, unless the issue is objectively severe.
- Labels must use writing-quality language, not algorithmic claims.
- New checks must be stable enough for unit tests and explainable in Post Coach.

## Checks To Add

### `quality_answerable_question`

Detect whether a question gives the reader an obvious way to reply.

- Pass when there is one clear answerable question, A/B choice, specific example request, or experience-based prompt.
- Warn when the post ends with vague closers like `thoughts?`, `agree?`, or `any advice?`.
- Warn or fail when the post stacks several unrelated questions.
- Do not require every post to ask a question.

### `quality_vague_curiosity`

Detect curiosity bait without a concrete anchor.

- Warn for vague hooks such as `this changed everything`, `nobody talks about this`, `you won't believe`, or similar phrasing when the post lacks a concrete noun, number, named thing, audience, or mechanism.
- Pass when curiosity is paired with a specific topic, mechanism, audience, or example.

### `quality_standalone_context`

Detect whether the first line can stand alone in a fast feed.

- Pass when the opener names the subject, audience, mechanism, or concrete object.
- Warn when the opener relies on unexplained `this`, `that`, `it`, or `they`.

### `quality_claim_evidence`

Flag unsupported sweeping claims.

- Warn for broad claim words like `always`, `never`, `everyone`, `nobody`, `guaranteed`, `best`, or `only way` when no evidence marker exists.
- Treat numbers, timeframe, named example, direct experience, or softened framing as evidence markers.
- Do not fact-check the claim; only flag wording risk.

### `quality_profile_click_reason`

Approximate whether the post gives a reader a reason to inspect the author's profile.

- Pass when the post implies lived experience, a project, a shipped/tested/analyzed artifact, a concrete result, a lesson learned, or niche expertise.
- Warn when it is generic advice with no author-specific angle.
- Do not reference actual profile data.

### `quality_one_idea_focus`

Detect overloaded posts.

- Pass when the post has one dominant claim, question, or observation.
- Warn when the post has several unrelated questions, unrelated bullets, or too many pivots such as `also`, `plus`, `another thing`, or `one more`.

### `line_length`

Improve scanability for multi-line posts.

- Pass when non-empty lines are reasonably scannable.
- Warn when any non-empty line is too dense, around 180 characters or more.

### `link_density`

Detect external-link friction without claiming links are downranked.

- Pass when there are no URLs.
- Warn when one URL is present with copy such as `External link present - make the post useful without the click`.
- Fail only for multiple URLs if the post becomes link-heavy.

### `mention_density`

Detect mention-heavy readability risk.

- Pass when mentions are restrained.
- Warn when there are more than two `@` mentions or mention density is high relative to word count.
- Label as readability/scanability risk, not ranking risk.

## Trend Multiplier Checkpoint

Review the existing trend-term behavior separately from adding new checks.

Current concern: one matched trend term appears to hit the maximum boost immediately through the existing multiplier expression.

Acceptance for this ticket:

- Add tests that document current `zeitgeist` prediction behavior, or gate the boost behind grounded context if product explicitly approves changing it.
- Do not silently change prediction math without an assertion that describes the intended before/after behavior.
- Do not call keyword matches "trends" in UI copy unless live trend/context data exists.

## Tests

- Unit tests cover pass/warn/fail fixtures for each new check.
- Analyzer tests prove the new checks are present in `score.checks`.
- Existing Post Coach grouping continues to work through failed/warned/passed sections.
- Tests assert no new schema fields are required.
- Regression tests assert labels do not claim:
  - X ranking prediction.
  - imported personal performance data.
  - profile-health diagnosis.
  - live trend knowledge.
- If prediction math changes, tests show the intended effect and keep missing-followers behavior unchanged.

## Implementation Notes

- Primary implementation surface: `engine/src/deterministic/post-analyzer.ts`.
- Primary test surface: `engine/src/deterministic/tests/post-analyzer.test.ts`.
- Add service-level regression coverage only if prediction output changes.
- Expect score drift because quality checks are normalized over the number of quality checks. Update affected snapshots deliberately.
