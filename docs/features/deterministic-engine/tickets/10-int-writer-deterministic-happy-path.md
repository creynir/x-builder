# [INT] Writer Deterministic Happy Path

## Goal

Add Purple-owned integration or E2E coverage for the complete happy path.

## Scope

This is not a production implementation ticket. Use it only after the required `[FND]`, `[BE]`, and `[FE]` tickets are implemented.

## Scenario

- User opens Writer.
- User enters an idea.
- User optionally enters manual followers.
- User generates candidates.
- Candidate text appears.
- Deterministic scoring completes.
- Each candidate shows score, Post Coach summary, and prediction state.
- User opens the detail inspector and sees expanded deterministic details.

## Assertions

- `/ideas/generate` is called for generation.
- `/posts/analyze` is called for scoring.
- Candidate text remains visible.
- Post Coach appears from API data.
- Manual followers enable prediction.
- Heuristic copy is honest and does not claim measured performance.
