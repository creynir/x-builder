---
status: done
---

# MFL-010: [DOC] Document My Feedback Loop

## Target Page

- `docs/how-to/use-my-feedback-loop.md`

## Diataxis Quadrant

How-To

## User-Facing Behavior To Document

Document how the local overlay records deliberate prediction snapshots, waits for captured actuals, shows predicted-vs-actual outcomes, and lets the user manually link predictions when automatic matching is ambiguous or unavailable.

The doc must explain:

- recording is deliberate only;
- typed drafts are not recorded automatically;
- actual performance comes from local captured/imported post metrics;
- ambiguous matches require explicit manual linking;
- all data stays local in the SQLite store;
- no cloud analytics or external metric service is used.

## Scope Boundaries / Out of Scope

In scope: user-facing workflow, settings summary, manual link behavior, local-data boundary, troubleshooting common states.

Out of scope: no internal table names, no implementation class names, no future auto-tuning, no vector/embedding roadmap, no claims about guaranteed reach.

## Definition of Done

- The page uses existing docs tone and markdown style.
- The page documents only shipped behavior from MFL-001 through MFL-009.
- The feature README and tickets README remain consistent with the shipped behavior.
- Traceability comment includes MFL-001 through MFL-010 and the verification date.

## Acceptance Criteria

- Given a user wants to understand why a feedback row is pending / When they read the doc / Then they can tell whether the app is waiting for capture or needs manual linking.
- Given a user is worried about privacy / When they read the doc / Then they see that data stays local and typed drafts are not recorded automatically.
- Given a user sees an ambiguous match / When they read the doc / Then they know to link the prediction to the correct X post id/status URL.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Implemented the user-facing how-to page and aligned feature/ticket documentation status.
