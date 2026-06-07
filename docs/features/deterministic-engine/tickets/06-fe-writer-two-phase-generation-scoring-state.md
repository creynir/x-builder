# [FE] Writer Two-Phase Generation/Scoring State

## Goal

Wire the Writer route so generated candidates render first, then deterministic scoring attaches to each candidate.

## Context

- Existing Writer page keeps local state and retries generation with `lastPayload`.
- Generated candidate text must survive score failures.
- `/ideas/generate` remains text-only.

## Requirements

- After generation succeeds, render candidate text immediately.
- Trigger deterministic analysis separately through `EngineApiClient.analyzePosts`.
- Track per-candidate analysis state:
  - idle/loading
  - ready
  - failed
  - stale when manual context changes and analysis needs recompute
- Score failure must not clear generated candidates.
- Retry score must call analysis only.
- Route-level generation failure behavior must remain intact.

## Tests

- Generated text appears before scoring completes.
- Successful scoring attaches analysis by candidate id.
- Per-candidate score failure leaves candidate text visible.
- Retry score calls `analyzePosts` and does not call `generateIdeas`.
- Existing generation retry behavior still works.
