---
status: done
---

# EFL-006: [DOC] Document External Feedback Loop

## Goal

Replace the External Feedback Loop stub with an explanation page that documents how external patterns influence generation guidance while staying separate from the user's own corpus and feedback loop.

## Changes

Target page path: `docs/features/external-feedback-loop/README.md`

Diataxis quadrant: Explanation

Document:

- what external feedback guidance is;
- what data it may consume;
- why guidance is engine-private;
- why there is no request-schema field, transport method, or UI surface;
- the producer/consumer construction contract between `ExternalXSignalsService`, `ExternalPatternSnapshotReader`, `ExternalPatternGuidanceProvider`, and `createGenerationGuidanceResolver`;
- why `JudgeDraftService` and `ApplyJudgeSuggestionsService` do not receive external patterns in v1;
- how External Feedback Loop differs from External X Signals and My Feedback Loop.

## Verification

- Read the updated page and confirm it does not imply external posts become voice samples, feedback actuals, local post history, active context, or auto-tuned scoring data.
- Confirm the page states that the existing Generate rail is the user entry point and that public generation request/response contracts are unchanged.
- Confirm the page states that external guidance consumes persisted pattern snapshots only, not raw evidence.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon. Documentation target and Diataxis quadrant added per validator requirement.
- 2026-06-29: Documentation pipeline started after EFL-005 approval.
- 2026-06-29: White documentation pass applied to `docs/features/external-feedback-loop/README.md`; page verified as Explanation coverage for generation-only external pattern guidance and no-contamination boundaries.
