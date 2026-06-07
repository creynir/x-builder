# [INT] Score Retry Preserves Generated Candidates

## Goal

Add Purple-owned integration or E2E coverage for deterministic score recovery.

## Scope

This is not a production implementation ticket. Use it only after the required `[FND]`, `[BE]`, and `[FE]` tickets are implemented.

## Scenario

- User generates candidates successfully.
- Deterministic scoring fails for one or more candidates.
- Candidate text stays visible.
- User retries score.
- Retry calls `/posts/analyze`.
- Retry does not call `/ideas/generate`.
- Successful retry attaches analysis to the existing candidate.

## Assertions

- Generated text is preserved throughout score failure and retry.
- Retry score does not regenerate candidates.
- Per-item `score_failed` state renders recovery UI.
- Full route failure renders route-level deterministic error UI.
- Existing generation retry behavior is not regressed.
