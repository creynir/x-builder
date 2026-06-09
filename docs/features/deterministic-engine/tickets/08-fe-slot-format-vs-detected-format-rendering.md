# [FE] Slot Format Vs Detected Format Rendering

## Goal

Render writer slot format and analyzer detected format as separate concepts.

## Context

- Generated candidates use writer slots such as `one-liner`, `mini-framework`, and `debate-question`.
- Analyzer detected formats use separate values such as `one_liner`, `insight_share`, or other analyzer categories.

## Requirements

- Candidate cards show the writer source slot where relevant.
- Detail or metadata areas show analyzer detected format where relevant.
- Do not overwrite source format with detected format.
- Mixed or unexpected detected formats must not break candidate rendering.

## Tests

- Candidate summary shows source slot from generation.
- Detail inspector shows detected analyzer format from analysis.
- Source slot remains stable when detected format differs.
- Missing optional source format renders gracefully for pasted/manual drafts.
