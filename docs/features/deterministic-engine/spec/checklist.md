# Flow Spec Checklist: Deterministic Engine Day One

Date: 2026-06-07

Screens specced: 4

Screens mocked up: 4

Overall completeness: 86%

## Summary

- Screens fully complete at spec level: 4/4.
- Screens with mockups: 4/4.
- Missing states: 0 known.
- Undocumented interactions: 0 known for deterministic scope.
- Forms without validation: 0.
- Modals/panels without focus management: 0.
- Missing design-system components: 2 likely product-specific implementations.
- Spec to mockup mismatches: 1 intentional simplification.
- Content/localization/responsive gaps: 3.
- Handoff readiness gaps: 5, mostly API/schema decisions for arch recon.

## State Coverage

| Screen | Ideal | Empty | Loading | Error | Partial | Complete? |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Writer Route Deterministic Workbench | Yes | Yes | Yes | Yes | Yes | Yes |
| Manual Scoring Context Panel | Yes | Yes | Yes | Yes | Yes | Yes |
| Candidate Deterministic Summary | Yes | Yes | Yes | Yes | Yes | Yes |
| Deterministic Detail Inspector | Yes | Yes | Yes | Yes | Yes | Yes |

## Interaction Gaps

No P0 deterministic interactions are undocumented.

Deferred writer actions are intentionally referenced but not specified here:

- Copy candidate.
- Save to library.
- Mark used/later.
- Retry Codex judge.

Those belong to Writer Logic and LLM Judge specs.

## Modal / Panel Gaps

| Panel | Trigger | Focus | Keyboard | Dismiss | Focus Return | Gap |
|---|---|---|---|---|---|---|
| Manual Scoring Context Panel | inline route/prediction CTA | field on invalid submit | standard form tab order | not dismissible by default | n/a | None |
| Deterministic Detail Inspector | Details action | heading/close in drawer mode | Escape closes drawer | close button/Escape | Details trigger | Need implementation decision: persistent aside vs drawer by breakpoint. |

## Form Gaps

| Form | Fields | Validation | Submit | Failure | Gap |
|---|---|---|---|---|---|
| Idea Generation Form | idea | 1-4000 chars | generate and score | field or route error | None |
| Manual Account Context Form | followers, optional AI rating later | positive integer; AI rating 1-10 if exposed | apply context | field/panel error | Need max follower policy. |

## Accessibility Gaps

| Area | Status | Follow-up |
|---|---|---|
| Score live updates | Specified | Implement polite announcements after score completion, not per keystroke. |
| Detail drawer focus | Specified | Verify Escape close and focus return in E2E. |
| Score bars | Specified | Ensure numeric and band labels are visible and exposed. |
| Missing followers | Specified | Ensure disabled prediction points to follower input. |
| Mockups | Partial | HTML mockups include landmarks/labels but are not full automated accessibility tests. |

## Content / Localization / Responsive Gaps

- Current analyzer learning copy says `your data` even when no imported X/user metrics exist. Before implementation, copy should be qualified as static heuristic guidance or gated until real data exists.
- Manual follower count needs exact validation copy and max-value warning.
- Score dimension naming remains unresolved: product docs mention reach, engagement, impressions, and voice-match, while current analyzer exposes one score plus prediction/checks.
- Mockups include responsive CSS for the workbench, but production specs should be verified at the app's actual shell breakpoints.

## Missing Components

| Component | Referenced In Screens | Exists In DS? | Notes |
|---|---|:---:|---|
| `PostCoachCard` | Detail Inspector, future compact preview | No | Logic exists as `PostCoachViewModel`; needs UI component. |
| `EngagementPredictionCard` | Detail Inspector, candidate prediction row | No | Logic exists as `EngagementPrediction`; needs UI component. |
| `CandidateCard` | Candidate Summary | Spec exists, implementation partial/not built | Existing Writer card is simpler. |
| `ScoreBar` | Candidate Summary, Post Coach | Spec exists, implementation not confirmed | Need implementation in client foundation or deterministic feature. |

## Spec To Mockup Mismatches

| Screen | Mismatch | Severity | Recommended Fix |
|---|---|---|---|
| Writer Route Deterministic Workbench | Mockup shows a composite route including detail inspector instead of all five states. | Low | Keep as ideal-state visual proof; build state variants during implementation or visual QA. |
| Manual Scoring Context Panel | Mockup shows Settings default action even though default schema is not decided. | Low | Treat as future/conditional row. |
| Candidate Deterministic Summary | Mockup uses one selected card only. | Low | Composite workbench mockup covers multi-card layout. |
| Deterministic Detail Inspector | Mockup uses static ready state. | Low | Error/empty/loading states are specified in markdown, not separately mocked. |

## Cross-Screen Visual Issues

No blocking inconsistencies found.

Visual conventions used consistently:

- Dense panel surfaces.
- 6-8px radius.
- Mono score/range values.
- Text labels for score, confidence, manual source, and status.
- No decorative hero/marketing layout.

## Consistency Issues

| Issue | Location | Severity | Recommended Fix |
|---|---|---|---|
| `Ship it`, `Good`, and `ScoreBar` band terms may diverge | Candidate Summary, Detail Inspector | Medium | Decide whether Post Coach badge labels drive score bands or whether `ScoreBar` uses separate design-system bands. |
| Static learning copy may overclaim personal data | Detail Inspector | High | Rewrite/gate before implementation. |
| Followers default of 1000 exists in analyzer | Backend behavior | High | UI must show default/manual source or pass explicit value. |

## Heuristic / Design QA Issues

| Issue | Location | Severity | Recommended Fix |
|---|---|---|---|
| Prediction can appear more precise than warranted | Engagement Prediction | High | Always include `Predicted, not measured.` and confidence/source labels. |
| Score-only optimization risk | Candidate Summary | Medium | Keep failed/warned checks visible near score. |
| Manual context may feel like setup tax | Manual Context Panel | Medium | Allow Post Coach without followers and make skip explicit. |
| Detail inspector can become too tall | Post Coach | Medium | Use collapsible sections and preserve keyboard access. |

## Handoff Readiness Gaps

1. Define shared deterministic analyze schemas.
2. Decide endpoint composition: scored `/ideas/generate` vs separate analyze endpoint.
3. Decide follower count persistence: route-local, Settings default, or both.
4. Rewrite/gate static "your data" learnings before UI ships.
5. Decide score dimensions for day one given the current analyzer output.

## Recommended Actions

1. Send this package to arch recon with the five handoff gaps above as required decisions.
2. In arch recon, design the shared schema and API boundary before component architecture.
3. In RGB TDD, start with tests around `AnalyzeResult` schema, missing followers, and score failure preservation.
4. Build Post Coach and Engagement Prediction as deterministic feature components using the reference images and design tokens.
5. Add E2E coverage for manual followers, score retry, detail inspector focus, and Codex-unavailable deterministic-only state.
