# Deterministic Engine Flow Map - Feature Inventory

Product: X Builder

Stage: product-flow-map / Stage 1 DISCOVER

Status: draft for review

Scan scope:

- `docs/what-we-are-building.md`
- `docs/component-breakdown.md`
- `docs/features/deterministic-engine/README.md`
- `docs/features/writer-logic/README.md`
- `docs/features/post-library-manual-import/README.md`
- `docs/design-system/product-components.md`
- `docs/design-system/product-patterns.md`
- `docs/design-system/product-screens.md`
- `docs/design-system/product-foundations.md`
- `engine/src/deterministic/post-analyzer.ts`
- `engine/src/deterministic/tests/post-analyzer.test.ts`
- `engine/src/server/server.ts`
- `shared/src/schemas/shell.ts`
- `client/src/features/writer/writer-page.tsx`

## Problem Frame

- Problem statement: X Builder needs deterministic post scoring and explanation UI that works before X integration and before Codex judging is available, so the writer can decide what to post with visible heuristic evidence.
- Primary audience: one internal founder/operator writing X posts locally.
- Success metrics:
  - User can generate or paste candidates and see deterministic scores without Codex.
  - User can supply manual account context, especially follower count, before engagement prediction is shown.
  - Every candidate shows the label `Heuristic rank, not prediction.`
  - User can inspect why a candidate scored well or poorly through Post Coach and Engagement Prediction cards.
  - Missing manual context and deterministic engine failures preserve draft text and candidate outputs.
- Guardrails:
  - Do not imply live X metrics or X account integration exists on day one.
  - Do not present engagement ranges as measured predictions.
  - Do not merge deterministic scoring and `Codex judge` into one recommendation.
  - Do not block deterministic results when Codex is unavailable.
  - Do not invent manual metrics beyond what day-one scoring can actually use.
- Constraints:
  - Canonical logic exists in `engine/src/deterministic/post-analyzer.ts`.
  - Current server exposes `/ideas/generate`, but it returns candidate text only.
  - No dedicated score endpoint or shared score schema exists yet.
  - Engagement prediction currently uses `followers`, optional `aiRating`, detected format, and deterministic score.
  - Voice profile, known-post evidence, run history, and X metrics are phase 1/2 dependencies but not yet fully implemented.
- Decision principles:
  - Score locally first: deterministic feedback should run inline and not wait for Codex.
  - Ask only for context that changes the result: day one needs manual followers; optional AI rating is a power-user calibration input.
  - Label uncertainty aggressively: manual followers and heuristic ranges are estimates.
  - Keep the writer in control: scores explain tradeoffs, but user selection wins.

## Personas

### Founder Writer

- Role: internal author deciding what to publish on X.
- Goal: turn a raw idea or draft into a stronger post and understand likely weaknesses.
- Context: local workbench, repeated use, no day-one X auth.
- Source: `docs/what-we-are-building.md`, design-system docs.
- Confidence: high.

### Deterministic Engine Implementer

- Role: developer wiring analyzer outputs into shared schemas, API endpoints, and UI cards.
- Goal: preserve analyzer semantics while exposing useful UI states and tests.
- Context: next implementation stage before arch recon and RGB TDD.
- Source: `engine/src/deterministic/post-analyzer.ts`, `docs/component-breakdown.md`.
- Confidence: high.

### Future Feedback Loop Operator

- Role: same founder after publishing posts and importing outcomes.
- Goal: compare heuristic estimates to real outcomes and improve scoring later.
- Context: phase 2 X/manual metrics import.
- Source: `docs/what-we-are-building.md`, feature roadmap.
- Confidence: medium.

## JTBD Mapping

| JTBD Step | What the user does | Deterministic feature coverage |
|---|---|---|
| Define | Decide whether to score a draft, generate candidates, or inspect a selected candidate | Writer route entry, candidate board, score detail inspector |
| Locate | Find manual account context and deterministic details | Manual Scoring Context panel, score badges, detail action |
| Prepare | Enter idea/draft and supply follower count | Idea textarea, draft textarea, followers input, optional AI rating input |
| Confirm | Check whether deterministic scorer can run and whether context is sufficient | Top status bar, inline missing-context alert, disabled prediction state |
| Execute | Generate candidates or score pasted text | `/ideas/generate`, future score endpoint, in-process analyzer |
| Monitor | Watch scoring and card derivation complete | Candidate skeletons, score loading state, aria-live updates |
| Modify | Edit draft, adjust manual followers/AI rating, toggle details | recompute scoring, update prediction ranges, expand Post Coach |
| Conclude | Copy, save, mark later/used, or hand candidate to Codex judge | existing writer actions later; deterministic output persists with candidate/run |

## IA / Content / Service Notes

### Information Architecture

| Section / Screen | Parent | Primary Nav? | Label Risk | Notes |
|---|---|---|---|---|
| Writer Route Deterministic Workbench | App Shell | Yes | Low | Deterministic scoring appears in Writer, not a separate dashboard. |
| Manual Scoring Context Panel | Writer Route | No | Medium | Must avoid sounding like connected analytics; label as manual account context. |
| Candidate Deterministic Summary | Candidate Board | No | Low | Use `ScoreBar`, badges, and explicit heuristic label. |
| Deterministic Detail Inspector | Writer Route inspector/drawer | No | Low | Houses Post Coach and Engagement Prediction cards. |
| Settings Writer Defaults | Settings Route | Yes | Low | Default follower count and show-details toggle can live here later. |

### Content Model

| Content Type | Key Fields | Owner | Appears In | Gaps |
|---|---|---|---|---|
| Analyze input | `text`, `followers`, `aiRating`, enabled checks, variety check | Deterministic engine | score endpoint, Writer | No shared request schema yet. |
| Analyze result | `text`, `format`, `score`, `prediction` | Deterministic engine | candidate summary, detail inspector | No API response schema yet. |
| Post score | `value`, `checks`, `learnings`, `engageability` | Deterministic engine | Post Coach | Needs UI mapping to score bands and check groups. |
| Engagement prediction | `rangeLow`, `rangeHigh`, `midpoint`, `confidence`, `signals` | Deterministic engine | Engagement Prediction card | Needs manual followers disclosure. |
| Manual account context | follower count, optional AI rating, source timestamp | Writer/settings | context panel, prediction card | No persistence model yet. |
| Candidate | id, format, text, deterministic analysis, judge later | Writer/shared | candidate board | Current shared candidate lacks scores. |

### Service Dependencies

| User Step | Visible System Response | Backstage Process | Owner | Risk |
|---|---|---|---|---|
| Generate candidates | Candidate cards load, then scores appear | `/ideas/generate` plus analyzer composition | Writer + deterministic engine | Current endpoint does not return scores. |
| Score pasted draft | Score card loads or inline validation appears | Future `POST /posts/analyze` or local writer composition | Deterministic engine | Endpoint contract not defined. |
| Enter followers | Prediction range recomputes | `predictEngagement` with manual followers | Deterministic engine | Defaulting to 1000 can mislead if not disclosed. |
| Inspect details | Post Coach and Prediction cards render | `derivePostCoachCard`, `predictEngagement` | Client UI | Card components not built yet. |
| Save/copy candidate | Deterministic analysis persists with run/candidate | Storage boundary | Writer/storage | Persistence not implemented in this feature. |

### Accessibility-Critical Moments

| Flow / State | Risk | Later Test Needed | Notes |
|---|---|---|---|
| Score changes after typing | Screen reader users may miss updated score | aria-live polite region | Do not announce every keystroke; announce after debounce/run. |
| Missing followers | Disabled prediction without explanation | keyboard + SR | Alert must name recovery field. |
| Detail inspector opens | Focus can get lost between candidate card and inspector | focus management | Return focus to the opening candidate action. |
| Score bars | Color-only meaning | visual + SR | Always show numeric value and band text. |

## Feature Inventory

| # | Feature | Description | Persona | JTBD Step | Status | Priority | Source |
|---|---|---|---|---|---|---|---|
| 1 | Analyze post text | Detect format, run voice checks, derive score, learnings, engageability, and optional prediction for a post. | Founder Writer | Execute | Engineering | P0 | `post-analyzer.ts` |
| 2 | Manual follower context | Let the user enter follower count because no day-one X integration exists. | Founder Writer | Prepare | Gap | P0 | `predictEngagement`, user prompt |
| 3 | Optional AI rating context | Let a power user add an external 1-10 quality rating when available. | Founder Writer | Prepare | Mentioned in code | P2 | `AnalyzeOptions.aiRating` |
| 4 | Candidate score composition | Attach deterministic analysis to each generated candidate. | Deterministic Engine Implementer | Execute | Gap | P0 | `/ideas/generate`, analyzer code |
| 5 | Candidate deterministic summary | Show overall heuristic rank, dimensions/check counts, reasons, risks, and missing-context status on each candidate. | Founder Writer | Confirm | Design complete | P0 | design-system `CandidateCard`, `ScoreBar` |
| 6 | Post Coach card | Show failed, warned, passed checks, engageability, learning snippets, and helper copy. | Founder Writer | Monitor | Logic exists | P0 | `derivePostCoachCard`, reference asset |
| 7 | Engagement Prediction card | Show heuristic impression range, confidence, and signals when text and followers are available. | Founder Writer | Monitor | Logic exists | P0 | `predictEngagement`, reference asset |
| 8 | Deterministic detail inspector | Let user inspect a selected candidate's score details without hiding the candidate board. | Founder Writer | Locate | Gap | P0 | product screens/patterns |
| 9 | Deterministic-only partial state | Keep scoring visible when Codex judge is unavailable. | Founder Writer | Confirm | Design complete | P0 | product patterns |
| 10 | Score endpoint/shared schema | Define request and response schemas for analyze results. | Deterministic Engine Implementer | Execute | Gap | P0 | shared/server code |
| 11 | Manual context persistence | Remember default followers and show-details preference locally. | Founder Writer | Conclude | Partial | P1 | Settings `showDeterministicDetails` |
| 12 | Run/candidate persistence | Persist deterministic outputs with generated runs for later learning. | Future Feedback Loop Operator | Conclude | Mentioned | P1 | `what-we-are-building.md` |
| 13 | Variety check from history | Penalize repeated format when recent local history exists. | Founder Writer | Modify | Logic exists | P2 | `createVarietyCheck` |
| 14 | X outcome comparison | Compare predictions to measured metrics after import. | Future Feedback Loop Operator | Conclude | Deferred | P2 | phase 2 docs |

## Gaps Identified

### Missing from implementation

- No score-bearing shared schema for `AnalyzeResult`, `PostScore`, `PostCoachViewModel`, or `EngagementPrediction`.
- No dedicated scoring endpoint; current `/ideas/generate` only returns text candidates.
- Current `GeneratedIdeaCandidate` schema has no deterministic analysis fields.
- No UI for manual follower count, even though prediction quality depends on it.
- No Post Coach or Engagement Prediction components in the client UI.
- No persistence contract for saving deterministic analysis with a run/candidate.

### Underspecified

- Whether day-one generation endpoint should return scored candidates directly or the client should call a separate scoring endpoint after generation.
- Whether manual follower count is route-local, stored in Settings, or both.
- Whether `aiRating` should be exposed day one; recommendation is no by default, advanced only.
- How deterministic "reach score", "engagement score", and "impressions score" map to the current analyzer, which currently exposes one score plus prediction range.
- How much current card reference copy should be preserved verbatim versus adapted to X Builder design-system language.

### Risky if skipped

- If follower count silently defaults to `1000`, engagement ranges will look more certain than they are.
- If scores are rendered without failed/warned checks, users will optimize for a number instead of the post.
- If score output is not part of the shared schema, RGB TDD agents will implement inconsistent client/server contracts.
- If deterministic and Codex judge outputs share one visual channel, the product will violate a core day-one guardrail.

## Recommended Flow List

### Critical - map first

1. Generate candidates with deterministic scores - core Writer loop from idea to scored first-pass candidates.
2. Score or revise a draft with manual context - covers no-X day-one usage and Post Coach feedback.
3. Inspect deterministic details - opens Post Coach and Engagement Prediction for a selected candidate.
4. Repair missing context or deterministic failure - handles absent followers, engine unavailable, and score API failures.

### Important - map second

5. Persist selected candidate with deterministic analysis - needed before feedback loop learning.
6. Adjust scoring defaults in Settings - default followers and show deterministic details.
7. Apply variety check from local history - depends on run history.

### Deferred

8. Compare prediction to real X metrics - requires X/manual metrics import.
9. Update scoring weights from outcomes - belongs to feedback loop architecture.
10. Batch score imported posts - useful later, not required for day-one Writer loop.

## Open Questions

1. Should scored generation be a single endpoint (`POST /ideas/generate` returns candidates with `analysis`) or a two-step flow (`/ideas/generate` then `/posts/analyze`)?
2. Should manual follower count be required before showing any prediction, or can the UI show a disabled card until supplied?
3. Do we expose `aiRating` on day one? Recommendation: hide under advanced details unless LLM judge can populate it later.
4. What is the day-one mapping for reach, engagement, impressions, and voice-match scores when the current analyzer exposes one score plus prediction?
5. Should the manual follower value live in Settings as a default and also be editable inline per run?

## Review Gate

Recommended Stage 2 flow-map scope:

1. Generate candidates with deterministic scores.
2. Score or revise a draft with manual context.
3. Inspect deterministic details.
4. Repair missing context or deterministic failure.

These are enough to feed product-flow-spec, then arch recon, then RGB TDD.
