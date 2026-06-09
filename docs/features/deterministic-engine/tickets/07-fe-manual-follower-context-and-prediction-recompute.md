# [FE] Manual Follower Context And Prediction Recompute

## Goal

Add day-one manual follower context for prediction without X integration.

## Context

- No X integration exists day one.
- Follower count is request-scoped and should not be persisted yet.
- Missing followers disables prediction but does not disable Post Coach.

## Requirements

- Add a manual follower count control in the Writer deterministic workbench.
- Validate empty and invalid values with clear inline feedback.
- Submit follower count with `analyzePosts`.
- Changing follower count marks prediction analysis stale and allows recompute.
- Recompute should call analysis only, not generation.
- Without followers, show missing-followers prediction state and keep Post Coach visible.

## Tests

- Empty followers shows disabled/missing prediction and visible Post Coach.
- Entering valid followers enables prediction after analysis.
- Invalid followers show inline validation without calling analysis.
- Updating followers calls `analyzePosts` and does not regenerate candidates.
- Follower count is not persisted across route reload unless a later ticket adds persistence.
