---
status: todo
---

# RMU-008: Judge rubric +5 dims, accountProfile input, judge→reach two-pass bridge

## Implementation Details

Greenfield judge→reach bridge (the old 0-10 `aiRating` path was deleted in RMU-002).

1. **Judge rubric +5 dims.** Extend `judgeInstructions` and the judge JSON-output schema
   (`verdictOutputSchema`) for the 5 dimensions added to `judgeScoresSchema` in RMU-001:
   `answerEffort` (100 = one-word reply, 0 = essay), `strangerAnswerability` (100 = anyone
   reacts, 0 = insiders only), `statusDependency` (100 = needs a famous bio, 0 =
   self-evident/humor — judge scores the TEXT only; the client combines with follower count),
   `audienceMatch` (given `accountProfile`; explicit `null` when no profile is provided),
   `replyVsQuoteOrientation` (0-100 display-only: 100 = built to collect replies, 0 = built
   to be quote-tweeted). `audienceMatch` allows `null` in the output schema.
   **Tighten the schema (this ticket is the producer).** The 5 dims were `.optional()` at
   RMU-001 because the judge emitted only the 8 existing dims; the judge now always emits all
   13, so tighten in `judgeScoresSchema`: the 4 behavioral dims (`answerEffort`,
   `strangerAnswerability`, `statusDependency`, `replyVsQuoteOrientation`) → **required**, and
   `audienceMatch` → `judgeScoreValue.nullable()` (**required on the wire, explicit `null`**
   when no profile — the "nullable, NOT optional" end state). Add the test that a full verdict
   carrying the new dims must include the 4 behavioral dims and a present (possibly `null`)
   `audienceMatch`.
2. **`accountProfile` input.** `JudgeDraftService.judge(text, accountProfile?)`; the
   `/drafts/judge` route reads `accountProfile` from the request, falling back to the
   persisted `settings.accountProfile` (RMU-009). Pass it into the structured-prompt
   envelope; instruct the model to return `audienceMatch = null` and say so when no profile
   is present. `deriveJudgeVerdict(scores.overall)` and the verdict bands are UNCHANGED —
   `overall` keeps its verdict job.
3. **The bridge (continuous, keyed off `scores.impressions`).** Add
   `toJudgedQualityMultiplier(impressions: number): number` in `prediction-estimator.ts`:
   `clamp(0.5 · (2.5/0.5)^(impressions/100), 0.5, 2.5)` (`// CALIBRATE`). Document inline the
   **double-count risk** (the judge also sees format, so a wide judged multiplier partly
   re-counts the format effect; calibration disentangles). When `scoringContext.judgeSignals`
   is present, `computeReachModel` uses `qualityMult = toJudgedQualityMultiplier(judgeSignals.impressions)`
   instead of `staticQualityCompression(score)` — this replaces the **quality slot only**;
   format/link/repeat/status multipliers still apply. Set `qualityBasis = "judge"`.
4. **Reply-rate override.** When `judgeSignals` is present,
   `expectedReplies = mid · lerp(0.002, 0.025, judgeSignals.replies/100)` instead of
   `replyRateTable[format]` (`// CALIBRATE`). The tribe +20% (RMU-007) still applies.
5. **Two-pass contract.** Pass-1 (`/posts/analyze` without `judgeSignals`) →
   `qualityBasis="static"`. Pass-2 (re-issue with `scoringContext.judgeSignals = { impressions, replies }`)
   → `qualityBasis="judge"`. Pre- and post-judge reach are **different scales** — no code
   here diffs them.

## Security Note

`accountProfile` is user-authored free text that flows into the judge LLM prompt — a
prompt-injection / PII surface. Mitigations already in the design: validated (`.trim().max(600)`),
inserted only inside the existing structured-prompt envelope, never interpolated into a
shell command or SQL, and stored locally. Low risk for a local single-user tool; flag it for
the security review at epic close (RMU-019/Crimson) rather than adding bespoke sanitization here.

## Data Models

Consumes RMU-001 `judgeScoresSchema` (+5 dims), `judgeDraftRequestSchema.accountProfile`,
`scoringContext.judgeSignals`, and the `qualityBasis` field.

## Integration Point

`POST /drafts/judge` (pass-1 judge, "Judge draft" button) and `POST /posts/analyze` pass-2
(client re-issue with `judgeSignals`). Terminal outcome: a `qualityBasis="judge"` prediction
+ the 5 new dims in the verdict.

## Scope Boundaries / Out of Scope

Engine + judge + estimator only. Client orchestration is RMU-013. Zero-trace: no UI, no diff
between passes. The 8 existing judge dims and `deriveJudgeVerdict` are unchanged.

## Test Strategy & Fixture Ownership

Unit (judge dims + bridge via the in-process `JudgeLlmGateway` fake — never a real CLI) +
the route two-pass via Fastify `inject` (carried in the `[INT]` ticket RMU-017). Extend the
judge fixture with the 5 dims (incl. `audienceMatch: null` and a numeric variant). The judge
LLM is a **true external** dependency → in-process fake / recorded fixture only.

## Definition of Done

5 dims produced and validated; `accountProfile` reaches the prompt with settings fallback;
the bridge replaces only the quality slot; `qualityBasis` stamped correctly; `pnpm test` +
`pnpm typecheck` green.

## Acceptance Criteria

- Given `judgeSignals.impressions=100` / When the bridge runs / Then `judgedQualityMultiplier = 2.5`; `=0` → `0.5`; `=50` → `≈1.118`.
- Given a pass-2 request with `judgeSignals` / Then `qualityBasis="judge"` and the static quality slot is bypassed (format/link/repeat/status still applied).
- Given `judgeSignals.replies=80` / Then `expectedReplies = mid · lerp(0.002, 0.025, 0.8)`.
- Given no `accountProfile` (request and settings both empty) / When judged / Then `audienceMatch = null`.
- Given `accountProfile` set in settings and absent from the request body / Then the judge receives the settings value and `audienceMatch` is non-null.
- Given the verdict / Then `overall` and `deriveJudgeVerdict` are unchanged from today.

## Edge Cases

Judge failure → no pass-2 (client keeps the static reach). `judgeSignals` out of 0-100 →
`validation_failed` at request parse. The double-count risk is documented, not "fixed".
