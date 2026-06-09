# Deterministic Engine Flow Spec - Screen List

Stage: product-flow-spec / Stage 1 EXTRACT

Status: draft for review

## Inputs

### Flow Map

- [Feature Inventory](../map/01-feature-inventory.md)
- [Flow Index](../map/02-flow-index.md)
- [Generate Candidates With Deterministic Scores](../map/02-flows/generate-candidates-with-deterministic-scores.md)
- [Score Or Revise Draft With Manual Context](../map/02-flows/score-or-revise-draft-with-manual-context.md)
- [Inspect Deterministic Details](../map/02-flows/inspect-deterministic-details.md)
- [Repair Missing Context Or Deterministic Failure](../map/02-flows/repair-missing-context-or-deterministic-failure.md)
- [Flow Map Validation Report](../map/03-validation-report.md)

### Design System

- [Product Foundations](../../../design-system/product-foundations.md)
- [Product Tokens CSS](../../../design-system/product-tokens.css)
- [Product Components](../../../design-system/product-components.md)
- [Product Patterns](../../../design-system/product-patterns.md)
- [Product Screens](../../../design-system/product-screens.md)

### Visual References

- [Post Coach reference](../assets/post-coach-card-reference.png)
- [Engagement Prediction reference](../assets/engagement-prediction-card-reference.png)

### Backend And Client Code

- `engine/src/deterministic/post-analyzer.ts`
- `engine/src/deterministic/tests/post-analyzer.test.ts`
- `engine/src/server/server.ts`
- `shared/src/schemas/shell.ts`
- `client/src/features/writer/writer-page.tsx`
- `client/src/ui/foundation.tsx`

## Flow-Map Context To Carry Forward

- Problem: deterministic scoring must work without X integration and without Codex judge.
- Primary persona: internal founder/operator writing X posts.
- Day-one manual inputs:
  - post/candidate text: required
  - follower count: required for Engagement Prediction, not required for Post Coach
  - AI rating: optional advanced input, probably hidden on day one
  - recent history: optional later input for variety checks
- Success metrics:
  - idea to scored candidate set completed
  - manual follower context supplied or intentionally skipped
  - deterministic details opened
  - score failures recovered without losing text
- Guardrails:
  - show `Heuristic rank, not prediction.`
  - do not imply live X metrics exist
  - separate deterministic output from `Codex judge`
  - preserve candidate text when scoring fails

## Screens Found

| # | Screen / Region | Type | Route | Referenced By | Priority |
|---|---|---|---|---|---|
| 1 | Writer Route Deterministic Workbench | Page | `/writer` | generate, score draft, repair | P0 |
| 2 | Manual Scoring Context Panel | Panel | within `/writer` | generate, score draft, repair | P0 |
| 3 | Candidate Deterministic Summary | Component region | within Writer candidate board | generate, inspect, repair | P0 |
| 4 | Deterministic Detail Inspector | Inspector / Drawer | within `/writer` | inspect, score draft, generate | P0 |
| 5 | Route Error Banner | Banner | route-local | repair | P1, covered by BE UI shell |
| 6 | Settings Route | Page | `/settings` | repair, future defaults | P1, referenced only |

## Deduplication Notes

- The Writer route is already partially implemented. This spec describes the deterministic extension, not the entire shell.
- Route Error Banner and Settings Route are already covered by BE UI shell specs. Deterministic implementation should reuse them rather than creating new recovery components.
- Candidate Deterministic Summary is a region inside `CandidateCard`, but it gets its own spec because its data contract and states are central to implementation.
- Manual Scoring Context Panel can start inline in Writer and later mirror defaults from Settings.

## Backend Capabilities Discovered

### Existing Functions

| Function | Input | Output | UI Implication |
|---|---|---|---|
| `analyzePost` | text, optional followers, aiRating, enabled checks, variety check | `AnalyzeResult` with format, score, prediction | Main composition primitive for scoring candidate/draft text. |
| `detectFormat` | text | `Format` enum | Candidate summary can show deterministic format. |
| `runVoiceChecks` | text, enabled checks, variety check | `PostScore` | Post Coach card uses checks, learnings, engageability. |
| `predictEngagement` | text, score, format, followers, aiRating | `EngagementPrediction | null` | Prediction card needs followers and enough text. |
| `derivePostCoachCard` | score, hasText, previewMode, expanded | `PostCoachViewModel` | Detail inspector can render card from analyzer output. |
| `createVarietyCheck` | text, recent history | `VoiceCheck | null` | Later history-backed nudge. |

### Existing API Endpoints

| Endpoint | Method | Current Status | Purpose | UI Implication |
|---|---|---|---|---|
| `/ideas/generate` | POST | implemented | Generate three candidate texts | Needs scoring composition or response extension. |
| `/status` | GET | implemented in current code | Runtime readiness | Deterministic status can gate error/partial state. |
| `/settings` | GET/PATCH | implemented in current code | Local settings | `showDeterministicDetails` exists; follower default does not. |
| `/posts/analyze` or equivalent | POST | missing | Score candidate/draft text | Required unless `/ideas/generate` returns analysis. |

### Data Models / Types

| Type | Key Fields | UI Implication |
|---|---|---|
| `AnalyzeResult` | `text`, `format`, `score`, `prediction` | Candidate and detail screens need all fields. |
| `PostScore` | `value`, `checks`, `learnings`, `engageability` | Score band, counts, check lists, learning rows. |
| `VoiceCheck` | `id`, `kind`, `label`, `status` | Check rows map pass/warn/fail to icons/text. |
| `PostCoachViewModel` | empty or ready state, badge, counts, sections, helper/footer | Use for Post Coach UI rather than re-deriving in client. |
| `EngagementPrediction` | range, midpoint, confidence, signals | Prediction range card and signal list. |
| `PredictionSignal` | `signal_key`, `label`, `multiplier` | Signal rows show label and multiplier. |

## Coverage Check

### Screens That Need Backend Data Or Contracts

| Screen / Region | Backend Need | Current Gap |
|---|---|---|
| Writer Route Deterministic Workbench | generated candidates plus per-candidate analysis | `/ideas/generate` response lacks analysis. |
| Manual Scoring Context Panel | route-local or persisted follower count | no schema/setting for followers. |
| Candidate Deterministic Summary | score value, format, check counts, prediction availability | no shared candidate analysis schema. |
| Deterministic Detail Inspector | full `PostCoachViewModel`, `EngagementPrediction`, selected candidate id | no API contract yet. |

### Backend Capabilities With No UI Yet

| Capability | Should UI Own It Day One? | Notes |
|---|---|---|
| `aiRating` | No, advanced/deferred | Better populated by Codex judge later. |
| `enabled` check toggles | No, deferred | Could become settings/debug feature. |
| `varietyCheck` from history | Not until run history | Mention in architecture only. |
| `recordPostHistory` | Not in this UI slice | Requires persistence flow. |

### Recommended Spec Order

1. Writer Route Deterministic Workbench.
2. Manual Scoring Context Panel.
3. Candidate Deterministic Summary.
4. Deterministic Detail Inspector.

## Paths

- Design system: `docs/design-system/`
- Component library: `client/src/ui/foundation.tsx`, `docs/design-system/product-components.md`
- Product design outputs: `docs/design-system/product-foundations.md`, `docs/design-system/product-patterns.md`, `docs/design-system/product-screens.md`
- Flow-map context: `docs/features/deterministic-engine/map/`
- Backend codebase: `engine/src/deterministic/post-analyzer.ts`, `engine/src/server/server.ts`, `shared/src/schemas/shell.ts`

## Stage 1 Review Gate

The P0 spec scope is the four deterministic Writer regions. Route Error Banner and Settings Route should be referenced, not re-specified.
