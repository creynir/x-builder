---
status: done
---

# RMU-012: Five new judge dimensions + null `audienceMatch` recovery state

## Implementation Details

Render the 5 new judge dimensions in `JudgePanel`, after the existing 8 score rows
(unchanged). Note: `JudgePanel` and `judgeScoreRows` both live in `writer-page.tsx` (the
exported `JudgePanel` component + the `judgeScoreRows` constant) — there is no standalone
`JudgePanel` file; extend them in place.

1. **`judgeAuxiliaryRows`** (new constant alongside `judgeScoreRows`) — the three plain
   0-100 numeric dims: `answerEffort` ("Answer effort"), `strangerAnswerability`
   ("Stranger answerability"), `statusDependency` ("Status dependency"). Rendered like the
   existing numeric rows.
2. **`AudienceMatchRow`** (new) — `audienceMatch` is `number | null`. When a number, render
   a normal row. When `null`, render the value as "Needs account profile" plus an inline
   `Button variant="ghost"` "Add account profile" that calls the existing `onOpenSettings`
   prop (navigates to Settings, where RMU-014's field lives).
3. **`replyVsQuoteOrientation`** — render as a **display-only 0-100 value on a labeled poled
   scale** ("Reply-oriented ↔ Quote-oriented", 100 = reply-collecting, 0 = quote-tweet).
   NOT a `ScoreBar`/progressbar, NOT an enum string.

Append all to the existing `xb-judge-scores` `<dl>`.

## Data Models

CONSUMES the extended `judgeScoresSchema`/`judgeVerdictSchema` (RMU-001): `answerEffort`,
`strangerAnswerability`, `statusDependency` (int 0-100), `audienceMatch: number | null`,
`replyVsQuoteOrientation` (int 0-100). Producer: RMU-008.

## Integration Point

`JudgePanel` (existing mount in `WriterPageView`). User entry: clicking "Judge draft".
Terminal outcome: 13 score rows; `audienceMatch` either a number or the recovery prompt.

## Scope Boundaries / Out of Scope

Render only. Does NOT add the two-pass refine loop (RMU-013). The 8 existing rows are
unchanged. Zero-trace: no enum rendering for `replyVsQuoteOrientation`, no `ScoreBar` for it.

## Test Strategy & Fixture Ownership

Component. Owning suite: writer `judge` tests. Fixture: extend the `JudgeVerdict` builder
with the 5 dims, including an `audienceMatch: null` variant and a numeric variant, and a
numeric `replyVsQuoteOrientation`. In-process SSR.

## Definition of Done

13 rows render; null `audienceMatch` shows the recovery button wired to `onOpenSettings`;
`replyVsQuoteOrientation` renders as a labeled numeric scale; `pnpm test` + `pnpm typecheck` green.

## Acceptance Criteria

- Given a verdict with the 5 dims, `audienceMatch=72`, `replyVsQuoteOrientation=80`, When rendered, Then 13 score rows show, `audienceMatch` shows 72, and `replyVsQuoteOrientation` shows 80 on the "Reply-oriented ↔ Quote-oriented" scale.
- Given `audienceMatch=null`, When rendered, Then the row reads "Needs account profile" with an "Add account profile" button that calls `onOpenSettings`.
- Given `replyVsQuoteOrientation=80`, When rendered, Then it is a display-only labeled numeric value (no progress bar, no ScoreBar, no enum string).

## Visual AC

New rows match the existing `xb-judge-scores__row` styling; null `audienceMatch` value uses
`--text-uncertain`; recovery button `Button variant="ghost"` with `aria-label` "Add account
profile in Settings"; orientation poles labeled with `--type-caption`/`--text-secondary`;
AA contrast verified.

## Edge Cases

Dims at 0 and 100; `replyVsQuoteOrientation` at 0 (fully quote) and 100 (fully reply);
a legacy verdict missing the new dims renders gracefully (omit the new rows).

## Pipeline Log

- 2026-06-14 — **Done.** Standard pipeline, two Red rejection cycles (both test-code defects, no impl thrash): Red (`27d813f`) 8 failing render/wiring tests + the 0-not-dropped guard, 211 passing. **Blue REJECT cycle 1** — `scoresList` helper (`judge.test.tsx:414`) returned `match[1]` (`string | undefined`) from a `=> string` helper → TS2322 under `noUncheckedIndexedAccess`, un-greenable independent of the impl gap → Red fix (`1ac44f7`) narrowed via the sibling `escapeBadge?.[1]` pattern → Blue APPROVE. Green then surfaced a **second** defect (orchestrator-verified before routing): the null-recovery wiring test (`:587`) bound `element` to a **non-invoked** `<JudgePanel/>` JSX element, whose `props.children` is unrendered, so `findByAriaLabel`→`flattenElements` threw "Expected an element with aria-label" for ANY implementation — un-satisfiable. **Red fix cycle 2** (`711b0ff`) bound `element = JudgePanel({…})` (invoked), mirroring `foundation.test.tsx:471`'s `Switch({…})`; Blue re-APPROVE (with a calibration note owning the two-cycle miss — for traversal/handler-wiring tests, distinguish a render-assertion failure from a harness-throw failure). Green (`f5d1eb0`): `onOpenSettings?` optional prop on `JudgePanel` (required would break the 18 existing JudgePanel tests via TS2741; threaded as **required** end-to-end `WriterPage`→`WriterPageView`→`JudgePanel`, so production is always wired), `judgeAuxiliaryRows` (3 numeric dims) + the `audienceMatch` number/null branch (`Button variant="ghost"`, aria-label "Add account profile in Settings", `--text-uncertain`) + the display-only `replyVsQuoteOrientation` pole scale (three `<span>`s, no ScoreBar/progressbar/enum), plus token-driven CSS (`xb-judge-scores__uncertain`/`__orientation`/`__pole`/`__orientation-value`). Full client suite **219 passed / 0 failed**, typecheck + lint clean, gates clean (scope/ticket-ids/stubs/slop/ui-tokens). Blue (Validate Green) APPROVE + Yellow APPROVE — **no concerns**. 13 rows render; 8 legacy rows byte-unchanged; null `audienceMatch` recovery button wired to `onOpenSettings`; orientation is a labeled numeric scale. No RMU-013 refine logic present (zero-trace confirmed).
