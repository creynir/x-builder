---
status: done
---

# RMU-002: [RFR] Remove dead format-history, aiRating, and dormant relaxation paths

## Refactor Scope

- `format-history.ts` — delete (`appendPostFormatHistory`, `countRecentFormatStreak`, `buildFormatVarietyCheck`) and its tests.
- `types.ts` — remove `PostHistoryEntry`, `RecordPostHistoryEntryInput`, and the optional `varietyCheck` threading if it has no other live consumer.
- `varietyFormatLabels` — delete if unreferenced after the above (verify with `codebones graph` / `rg`).
- `aiRatingQualityMultipliers` table and the `fallbackAiRatingBand` in `const/scoring-weights.ts`.
- `aiRating` parameter throughout `AnalyzeOptions`, `analyzeDraftText`, `estimateEngagementRange`, `chooseQualityMultiplier`.
- The dormant `aiHighConfidenceSignalCount` / `aiMediumConfidenceSignalCount` relaxation in the confidence ladder.

Everything outside this list is untouchable. **Tension regex removal is NOT in this ticket**
— it changes prediction numerics and is therefore carved into RMU-007.

## Behavior-Preservation Invariants

- For any current request shape (`scoringContext` = `{ followers }` only, no `aiRating`, no `judgeSignals`), `/posts/analyze` output is identical before and after for `score`, `postCoach`, and `prediction`. These code paths are dead/unreachable in production (`analyzePosts` only ever passes `{ followers }`; `format-history` has zero non-test importers), so deletion is observably behavior-preserving.
- The engagement `confidence` value is unchanged for all inputs that never supplied `aiRating` (i.e. every production input today).

## Integration Point

No user-facing surface. Removes unreachable branches so RMU-005…008 build the greenfield
bridge cleanly rather than around the latent 0-10 path.

## Scope Boundaries / Out of Scope

Behavior-preserving deletions only. Zero-trace: no stubs, no commented-out code, no TODOs
left behind. No new logic; no tension-regex change; no schema change (`one_liner`/`goal_share`
are still emitted by the live classifier at this point — RMU-004 deletes them).

## Test Strategy & Fixture Ownership

Characterization pipeline: pinning tests are derived from the existing analyze-behavior
tests (do not author a new plan). Owning suite: engine deterministic tests. In-process.

## Definition of Done

`pnpm test` green with pinning tests passing before and after. `rg` for `format-history`,
`appendPostFormatHistory`, `aiRating`, `aiRatingQualityMultipliers` returns zero non-test
hits post-merge.

## Acceptance Criteria

- Given the current analyze test corpus / When analyze runs before and after this ticket / Then `score`, `postCoach`, and `prediction` are byte-identical.
- Given a post-merge `rg` for the deleted symbols / Then zero non-test hits.

## Edge Cases

If `varietyFormatLabels` or the `varietyCheck` param turns out to have a live consumer,
narrow the deletion and note it in the Pipeline Log rather than breaking that consumer.

## Pipeline Log

- 2026-06-14 — **Done.** Characterization pipeline: Red-RFR pinned production analyze behavior (`48e258f`, 15 concrete-value pinning tests in `production-analyze-contract.test.ts`) → Blue Validate Pinning APPROVE (mutation-tested falsifiable) → Red removed dead-surface tests (`d333ca4`) → pre-Green pinning gate 356/356 → Green deletion (`d14aa65`, 157 deletions) → post-Green gates clean (no test-path diff) → Blue (Validate Green/RFR) APPROVE + Yellow (facade) APPROVE.
- Deleted: `format-history.ts`, `aiRatingQualityMultipliers`/`fallbackAiRatingBand`, the `aiRating` param chain, the dormant `aiHigh/MediumConfidenceSignalCount` confidence relaxation, `PostHistoryEntry`/`RecordPostHistoryEntryInput`, `varietyFormatLabels`. DoD `rg` zero non-test hits. Full `pnpm test` green (engine 356 / client 171), typecheck 5/5, lint clean.
- **Narrowed (ticket Edge Case):** the `varietyCheck` param + threading was **kept** — it has a live consumer at `writing-checks.ts:342`. It is now producerless (its only producer `buildFormatVarietyCheck` was deleted) and production-fed-`undefined`; both validators confirmed it is wired end-to-end, not an orphan/facade.
