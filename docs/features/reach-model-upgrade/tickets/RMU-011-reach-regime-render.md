---
status: in-progress
---

# RMU-011: Four-regime prediction render (`ReachRegimeBlock`)

## Implementation Details

**Replace** the `EngagementPredictionCard` body to render the four-regime contract directly —
not a feature-detected add-on. Client and engine ship together, so the old Range / Midpoint /
Confidence rows are **removed, not preserved**. **This ticket also deletes the RMU-006
migration bridge:** remove `rangeLow`/`rangeHigh`/`midpoint`/`confidence` from
`availableEngagementPredictionSchema`, the engine `EngagementPrediction` type, the estimator
output, and the `confidence` ladder — nothing reads them after this ticket.

1. **`ReachRegimeBlock`** (new):
   ```ts
   type ReachRegime = {
     predictedMidImpressions: number;
     pEscape: number;                  // 0..1 (from escapeProbability)
     stallRange: { low: number; high: number };
     escapeRange: { low: number; high: number };
     expectedReplies: number;
     qualityBasis: "static" | "judge"; // server-supplied
   };
   ```
   Renders: "Expected reach" → `predictedMidImpressions`; "Escape likelihood" → `pEscape` as a
   percentage with `Badge variant="info"`; "Typical reach" → `stallRange.low – stallRange.high`;
   "If it breaks out" → `escapeRange.low – escapeRange.high`; "Expected replies" →
   `expectedReplies`. When `qualityBasis === "judge"`, render one `Badge variant="accent"`
   "Refined with judge signal"; `"static"` → no badge. **No second prediction, no delta, no diff.**
2. **`EngagementPredictionCard`** — the `available` branch renders `ReachRegimeBlock` + the
   `signals` list (kept). The `disabled` branch is unchanged.
3. **`predictionSummary`** (chip in `CandidateDeterministicSummary`) — rewrite to the new
   fields, e.g. `"${stallRange.low}–${stallRange.high} typical · ${pct(pEscape)} escape"`.
   The old `rangeLow - rangeHigh, confidence` string is replaced, not appended to.

## Data Models

CONSUMES `availableEngagementPredictionSchema` (RMU-001): `predictedMidImpressions`,
`escapeProbability` (rendered as `pEscape`), `stallRange`, `escapeRange`, `expectedReplies`,
`signals`, `qualityBasis`. Producer: RMU-006 (static) / RMU-008 (judge). This ticket REMOVES
`rangeLow`/`rangeHigh`/`midpoint`/`confidence` from the schema, engine type, and estimator
(the RMU-006 bridge) — after it, nothing references them.

## Integration Point

The three existing prediction call sites — `DraftDeterministicEvaluation`,
`DeterministicDetailInspector`, and the chip via `CandidateDeterministicSummary`. No new
mount. User sees escape likelihood, typical + breakout ranges, and expected replies after a
draft is scored.

## Scope Boundaries / Out of Scope

Render + delete the transitional legacy prediction fields (the RMU-006 bridge). Does NOT set
`qualityBasis` (server-supplied; the refine flow producing `"judge"` is RMU-013).
Disabled-prediction branch unchanged. Zero-trace: no diff/delta UI, no before/after pair, and
**no `rangeLow`/`rangeHigh`/`midpoint`/`confidence` remain anywhere after this ticket**.

## Test Strategy & Fixture Ownership

Component. Owning suite: writer `deterministic-components` tests. Fixture: a
`buildAvailablePrediction()` builder including `pEscape`/`stallRange`/`escapeRange`/
`expectedReplies`/`qualityBasis` (test-owned, shared). In-process SSR.

## Definition of Done

Card renders the four-regime block + signals; disabled branch unchanged; summary chip uses
the new fields; the legacy prediction fields are deleted (`rg` for `rangeLow`/`rangeHigh`/
`midpoint`/`confidence` in the prediction schema/type/estimator/card → 0 hits);
`pnpm test` + `pnpm typecheck` green.

## Acceptance Criteria

- Given an available prediction with `predictedMidImpressions=1500`, `pEscape=0.12`, stall `[800,2400]`, escape `[6000,40000]`, replies `9`, `qualityBasis="static"` / When rendered / Then the card shows the expected reach, "12% escape", "800 – 2,400", "6,000 – 40,000", "9", the signals list, AND no "Refined with judge signal" badge.
- Given `qualityBasis="judge"` / When rendered / Then the "Refined with judge signal" `Badge variant="accent"` appears (mapped internally) and the regime values render normally.
- Given a disabled prediction (`missing_followers`) / When rendered / Then the "Prediction unavailable" Alert + recovery render (disabled branch unchanged).
- Given the summary chip / Then it renders from the new fields (typical range + escape %); the old `rangeLow - rangeHigh, confidence` string no longer exists.
- Given the merged client+shared / When `rg` for `rangeLow`/`rangeHigh`/`midpoint`/`confidence` in the prediction path runs / Then zero hits.

## Visual AC

Regime rows reuse the `.xb-deterministic-signals` row layout; escape `Badge variant="info"`;
"Refined with judge signal" `Badge variant="accent"` only when `qualityBasis === "judge"`;
no number-transition animation; **identical card height across `qualityBasis` values (no CLS)**;
`pEscape` percentage carries a text label (not color-only); regime sub-labels are `<dt>`/`<p>`,
not headings (no skipped levels under the card `h3`).

## Edge Cases

`pEscape` 0 or 1; `stallRange`/`escapeRange` with equal low/high; `qualityBasis` is always
present (server-supplied) — no legacy-payload fallback path.
