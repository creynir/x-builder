# Deterministic Engine

Purpose: generate and score post candidates without depending on LLM availability.

## Stored Logic

- Canonical analyzer module: `engine/src/deterministic/post-analyzer.ts`
- Current exports: `analyzePost`, `detectFormat`, `runVoiceChecks`, `predictEngagement`, `derivePostCoachCard`, and related types.
- Current scope: stored and tested as engine-domain logic, not yet wired into `/ideas/generate` or a dedicated scoring endpoint.

## UI References

These screenshots are reference targets for the future deterministic engine cards:

- Engagement Prediction card: `assets/engagement-prediction-card-reference.png`
- Post Coach card: `assets/post-coach-card-reference.png`

The card data is represented in code as:

- `EngagementPrediction` from `predictEngagement`
- `PostCoachViewModel` from `derivePostCoachCard`
