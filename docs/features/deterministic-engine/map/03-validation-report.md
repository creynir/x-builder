# Deterministic Engine Flow Map Validation Report

Date: 2026-06-07

Scope: 4 flows, 6 canonical screens/regions, 14 feature inventory items.

## Summary

- Features covered: 11/14.
- Flows complete: 4/4 at breadboard level.
- Screen naming issues: 0.
- Dead ends: 0 known.
- Orphan screens: 0 within this feature folder.
- Cross-flow issues: 2 open handoff decisions.
- Strategic coverage gaps: 5.
- Open questions: 8 critical/important.

## Feature Coverage

### Covered

| Feature | Covered by Flow | Steps |
|---|---|---|
| Analyze post text | Generate, Score Draft, Inspect | analysis and details steps |
| Manual follower context | Generate, Score Draft, Repair | context panel and prediction recovery |
| Optional AI rating context | Inventory only | intentionally not day-one primary |
| Candidate score composition | Generate | scoring composition branch |
| Candidate deterministic summary | Generate, Inspect, Repair | summary and retry |
| Post Coach card | Score Draft, Inspect | detail inspector |
| Engagement Prediction card | Generate, Score Draft, Inspect | prediction branches |
| Deterministic detail inspector | Inspect | full flow |
| Deterministic-only partial state | Generate, Repair | Codex unavailable and score partial |
| Score endpoint/shared schema | Generate, Repair | dependency gap surfaced |
| Manual context persistence | Repair, Settings handoff | partial handoff |

### Not Covered Yet

| Feature | Status | Why Missing |
|---|---|---|
| Run/candidate persistence | Mentioned | Needs storage architecture after flow/spec. |
| Variety check from history | Logic exists | Depends on run history and persisted format sequence. |
| X outcome comparison | Deferred | Requires phase 2 X/manual metric import. |

## Flow Completeness

| Flow | Entry Points | Happy Path | Decisions Complete | Errors Documented | Edge Cases |
|---|---|---|---|---|---|
| Generate candidates with deterministic scores | Yes | Yes | Yes | Yes | Yes |
| Score or revise a draft with manual context | Yes | Yes | Yes | Yes | Yes |
| Inspect deterministic details | Yes | Yes | Yes | Yes | Yes |
| Repair missing context or deterministic failure | Yes | Yes | Yes | Yes | Yes |

## Screen Consistency

Canonical screen names are consistent across all flows:

- Writer Route Deterministic Workbench
- Manual Scoring Context Panel
- Candidate Deterministic Summary
- Deterministic Detail Inspector
- Route Error Banner
- Settings Route

## Dead Ends And Orphans

No mapped dead ends were found. Every failure path has either Retry, enter context, Open Settings, or continue without prediction.

Potential orphan from roadmap:

- Settings Writer Defaults is referenced as an important follow-up but not mapped as a full flow. This is acceptable if manual context starts inline in Writer.

## Cross-Flow Integrity

| From Flow | Exit Step | To Flow | Entry Point | Context Preserved? | Gap |
|---|---|---|---|---|---|
| Generate | Select candidate | Inspect details | Candidate details action | Yes | Analysis shape must be attached to candidate. |
| Generate | Missing followers | Repair | Manual context panel | Yes | Need persistence/route-local decision. |
| Score Draft | Analyze failure | Repair | Score retry warning | Yes | Need error scope/schema. |
| Repair | Open Settings | Settings Route | Route Error Banner action | Partial | Need return path and apply-default behavior. |

## Strategic Coverage

### Metrics

| Metric | Flow Step / Event | Instrumentable? | Gap |
|---|---|---:|---|
| Idea to scored candidates | Generate success | Yes | Needs event schema. |
| Manual context completion | Followers applied | Yes | Need decide route-local vs Settings default. |
| Detail inspection | Details opened | Yes | Need selected candidate id. |
| Score recovery | Retry score success | Yes | Need score endpoint or composition boundary. |
| Prediction accuracy later | Outcome comparison | No day one | Requires metric import and persisted estimates. |

### IA / Content

| Need | Status | Gap |
|---|---|---|
| Heuristic label | Covered | Must appear near aggregate score. |
| Manual followers copy | Covered | Exact copy needs approval. |
| Prediction unavailable copy | Covered | Needs schema reason values. |
| Static learnings disclosure | Partial | Current analyzer has static learning copy that says "your data"; may need temporary wording until imports exist. |
| Score dimension labels | Partial | Current analyzer has one score plus checks, not four explicit score dimensions. |

### Service Dependencies

| Dependency | Affected Flow | Visible Wait/Error State | Owner | Gap |
|---|---|---|---|---|
| `/ideas/generate` | Generate | candidate skeleton / route banner | engine/writer | no scores in response |
| score/analyze endpoint | all flows | score skeleton / score warning | deterministic engine | missing |
| shared score schemas | all flows | invalid response handling | shared | missing |
| Settings persistence | repair | status/settings return | shell/settings | partial |
| storage/run history | variety/persistence | stale/cached state | storage | not implemented |

## Implementation Gaps

| Screen / Capability | In Flow Map | In Code | In Design System | Gap |
|---|---:|---:|---:|---|
| Writer Route Deterministic Workbench | Yes | Partial | Yes | Current Writer renders text-only candidates. |
| Manual Scoring Context Panel | Yes | No | Components exist | Need numeric input, validation, persistence decision. |
| Candidate Deterministic Summary | Yes | No | `CandidateCard`, `ScoreBar` spec exists | Need components/fields. |
| Deterministic Detail Inspector | Yes | No | `Drawer`, `KeyValueList`, cards possible | Need implementation. |
| Post Coach view model | Yes | Yes | Reference image only | Need UI component. |
| Engagement Prediction view model | Yes | Yes | Reference image only | Need UI component. |
| Analyze endpoint/schema | Yes | No | N/A | Need architecture decision. |

## Consolidated Open Questions

### Must answer before building

1. Should scored generation be one endpoint or two endpoint calls?
2. What shared schema represents `AnalyzeResult`, `PostScore`, `EngagementPrediction`, and card view models?
3. Is manual follower count required before showing prediction, or does the card stay disabled until supplied?
4. What copy replaces current static "your data" learning text until real imported metrics exist?

### Should answer before building

5. Should manual followers be stored in Settings, route state, or both?
6. What is the day-one mapping for reach, engagement, impressions, and voice-match when current analyzer exposes one score?
7. Should `aiRating` be hidden day one or exposed as an advanced calibration field?

### Can answer during building

8. Exact hover/focus behavior and expanded/collapsed defaults for Post Coach details.

## Recommended Next Actions

1. Run product-flow-spec for the four canonical screens/regions.
2. Feed the unresolved endpoint/schema decision into arch recon.
3. In RGB TDD, start with shared schemas and analyzer API tests before UI cards.
4. Add copy review for manual follower and heuristic/prediction language before implementation.
