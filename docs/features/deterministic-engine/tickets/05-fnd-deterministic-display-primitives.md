# [FND] Deterministic Display Primitives

## Goal

Add reusable UI primitives needed by deterministic scoring screens.

## Placement

Generic primitives may live in `client/src/ui/foundation.tsx` or adjacent foundation UI modules if the repo's local pattern prefers splitting.

Deterministic-specific cards must live under the writer/deterministic feature area.

## Generic Primitives

- `ScoreBar`
- `Input`, if the existing foundation lacks one.
- `Drawer`, if the existing foundation lacks one.
- `KeyValueList`
- Generic `CandidateCard` only if it is truly product-wide.

## Feature-Specific Components

- `CandidateDeterministicSummary`
- `ManualScoringContextPanel`
- `PostCoachCard`
- `EngagementPredictionCard`
- `DeterministicDetailInspector`

## Requirements

- Generic primitives must not bake in deterministic-specific copy.
- `ScoreBar` receives labels and help text from callers.
- Components use existing foundation tokens and interaction patterns.
- Layout must match the deterministic spec mockups at a practical component level.

## Tests

- Primitive render tests cover value, label, disabled, and loading states where relevant.
- Deterministic cards render from API view models, not analyzer logic.
- Post Coach card receives a `postCoach` view model and does not derive badge/counts/checks itself.
