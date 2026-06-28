---
status: done
---

# EXS-010: [DOC] Document External X Import + Signals

## Implementation Details

Update the feature README and add user-facing docs for External X Import + Signals after implementation is complete. The docs must describe the settings-panel entry point, source management, observe-only refresh semantics, pending/no-observation states, external evidence patterns, and the hard separation from the user's own corpus.

Target pages:

- `docs/features/external-x-import-signals/README.md` - Explanation and architecture context.
- `docs/how-to/use-external-x-signals.md` - How-To guide for adding, refreshing, reviewing, and removing an external source.

Diataxis quadrant: README is Explanation; how-to page is How-To.

## Data Models

Document the user-visible contract names only where useful:

- Four transport methods: `getExternalXSignalsOverview`, `addExternalXSignalSource`, `removeExternalXSignalSource`, `refreshExternalXSignalSource`.
- Four routes: `GET /external-x/signals/overview`, `POST /external-x/signals/sources`, `DELETE /external-x/signals/sources/:sourceId`, `POST /external-x/signals/sources/:sourceId/refresh`.
- Migration 3 external ledger names at architecture level.

## Integration Point

Producer: feature docs and user guide.

Known consumers: users, maintainers, future arch-recon/RGB runs.

User entry point: docs explain the existing overlay settings launcher.

Terminal outcome: a reader understands how to use the feature and what it deliberately does not do.

## Scope Boundaries / Out of Scope

In scope: docs updates only after behavior ships.

Out of scope: no code, no tests beyond docs validation, no speculative future vector search/generation integration docs.

Zero-trace: do not document active navigation, X API credentials, cloud sync, model auto-tuning, or own-corpus mixing as available features.

## Test Strategy & Fixture Ownership

Coverage level: docs review and any existing docs/link checks. Owning suite: docs/manual review unless repo has a markdown link checker. Fixture strategy: compare docs against implemented method names, route names, UI labels, and source states. Dependency category: local markdown. Isolation boundary: no browser/network required.

## Definition of Done

- Feature README matches implemented architecture and status.
- How-to guide explains add, refresh, pending/no-observation, pattern review, and remove flows.
- Docs state observe-only behavior and no active X requests.
- Docs state external evidence never enters own-post corpus.
- Docs use canonical method/route names and avoid stale names.

## Acceptance Criteria

- Given the docs are read / When a user follows the guide / Then they can find the settings section and add an external source.
- Given no observed evidence exists / When the docs explain refresh / Then they describe waiting/no-observation honestly.
- Given a maintainer checks the architecture notes / When they read storage boundaries / Then migration 3 and external ledger separation are explicit.
- Given stale names from arch-recon drafts / When docs are searched / Then `registerExternalAccount`, `importExternalSignals`, `getExternalSignalsSummary`, and `getExternalSignalPatterns` do not appear as implemented APIs.

## Edge Cases

- Explain duplicate source behavior.
- Explain source removal as active-overview removal with evidence preserved unless implementation says otherwise.
- Explain that live x.com/network behavior is not required for local test fixtures.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Updated the feature README and added `docs/how-to/use-external-x-signals.md` with settings entry point, source management, observe-only refresh semantics, waiting/no-observation behavior, evidence-backed patterns, duplicate/remove semantics, canonical route/transport names, migration 3 ledger tables, and own-corpus isolation.
