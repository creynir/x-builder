---
status: done
---

# EFL-004: Enforce no-contamination boundaries

## Implementation Details

Add policy and contract tests proving external patterns influence only generation guidance and do not contaminate the user's own data or adjacent services.

Forbidden consumers:

- `PostLibraryRepository`
- `CanonicalOwnPost`
- voice sample selection
- archive import
- live capture
- feedback actuals
- active scoring context
- category ranking
- cooldown logic
- `JudgeDraftService` prompt/context inputs
- `ApplyJudgeSuggestionsService` prompt/context inputs

Tests may combine static import checks with focused runtime fakes where prompt capture or service baselines already exist.

## Data Models

No new data models.

The tests use existing `ExternalXSignalPattern`, `GenerateIdeaRequest`, and own-corpus models only as fixtures.

## Integration Point

Producer: architectural test suite.

Known consumers: future RGB/TDD validators and developers changing generation/judge/feedback wiring.

User entry point: existing Generate rail and feedback/settings flows remain unchanged.

Terminal outcome: accidental external-pattern imports or prompt/data leaks into forbidden modules fail tests before shipping.

## Scope Boundaries / Out of Scope

In scope: tests and any minimal production adjustments required if tests reveal accidental leakage.

Out of scope: no new feature behavior, no new external pattern consumers, no judge/apply support, no UI, no transport, no route.

Zero-trace: do not add placeholder policy APIs, feature flags, or documentation-only tests that do not fail against real leakage.

## Test Strategy & Fixture Ownership

Coverage level: static policy tests plus focused runtime contract tests. Owning suites: engine LLM/service tests, feedback/category tests where existing harnesses exist, shared schema/transport tests for public contract invariants. Fixture strategy: test-owned external pattern builder with unique sentinel statements and evidence previews; own-corpus baseline fixtures for comparison. Dependency category: in-process only, with temp DB only where required by existing harnesses. Isolation boundary: no developer-local storage, no browser, no live X, no network.

## Definition of Done

- Tests fail if forbidden modules import the external pattern provider/reader directly.
- Tests fail if external pattern statements or evidence previews appear in judge/apply prompts.
- Tests prove external patterns do not create own-post rows or voice samples.
- Tests prove generate public request schema has no external context field in its inferred/public output shape.
- Tests prove category/feedback behavior remains own-corpus-only.

## Acceptance Criteria

- Given external patterns exist and the own post repository is empty / When generation runs / Then the own repository remains empty and no voice samples are rendered.
- Given generated candidates are judged / When judge prompt/context is captured / Then external pattern statements and evidence previews are absent from judge inputs.
- Given apply suggestions runs / When apply prompt/context is captured / Then external pattern statements and evidence previews are absent from apply inputs.
- Given feedback summary and category ranking run with external patterns present / When compared to an own-corpus-only baseline / Then their outputs are unchanged.
- Given `generateIdeaRequestSchema` is inspected / When parsed with an extra external guidance field / Then that field is stripped from the parsed output and absent from the inferred public generation contract.

## Edge Cases

- Indirect barrel imports must be covered, not only direct relative imports.
- Sentinel strings must be unique enough to detect prompt leaks.
- Runtime fakes must exercise the real service boundaries, not only mocked functions.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
- 2026-06-29: RGB pipeline started.
- 2026-06-29: Red/Blue/Yellow approved guard-only implementation in `2097825`; existing source boundaries already held, and committed regression coverage now blocks direct external imports, named/namespace barrel imports, archive import contamination, active-context contamination, judge/apply prompt leaks, feedback/category changes, own-corpus writes, voice-sample rendering, and public request external fields.
