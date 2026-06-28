---
status: done
---

# EXS-006: Add observe-only ExternalXSignalsCaptureObserver and runner wiring

## Implementation Details

Add `ExternalXSignalsCaptureObserver` and runner wiring for already-fetched external X timeline/profile responses. The observer produces `ExternalXObservedTimelineBatch` values and passes them to `ExternalXSignalsService.ingestObservedTimeline` only for registered active sources.

This observer is observe-only. It must never call `page.goto`, craft GraphQL requests, construct auth headers, add X API credentials, auto-scroll, auto-follow, or synthesize network traffic. It reads only responses already fetched by the page.

Validator concern folded into this ticket: tests must exercise the existing own-post `GraphQlCaptureObserver`/`LiveCaptureService` path and the new external observer path together, proving registered external-source observations do not call or write the own-post repository.

## Data Models

Use shared EXS-001 schemas and define `ExternalXObservedTimelineBatch` with source identity and normalized evidence suitable for `ExternalXSignalsService.ingestObservedTimeline`.

The batch must carry enough source identity to gate against registered sources before persistence. Missing or unmatched source identity results in no external write and no own-post write.

## Integration Point

Producer: runner `ExternalXSignalsCaptureObserver` and external X normalizer.

Known consumers: `ExternalXSignalsService.ingestObservedTimeline` and integration tests.

User entry point: user adds a source in settings, then x.com page traffic for that source is observed by the runner.

Terminal outcome: observed external timeline evidence lands in the external ledger only, while own-post capture behavior remains unchanged for the user's own timeline/corpus.

## Scope Boundaries / Out of Scope

In scope: external observer, source-gated normalization, runner attach/wiring, service handoff, observe-only tests, and dual-path no-leak tests against existing own capture.

Out of scope: no settings UI, no route changes, no transport method changes, no active navigation, no X API credentials, no `LiveCaptureService` rewrite unless needed to prevent external leakage through the runner wiring.

Zero-trace: no fallback that sends external evidence to `LiveCaptureService`, no generic observed batch without source identity, no active-fetch helper.

## Test Strategy & Fixture Ownership

Coverage level: runner observer/normalizer unit tests and focused runner integration tests. Owning suite: runner capture tests and transport-engine integration tests. Fixture strategy: checked-in GraphQL profile/timeline fixtures for a registered external source, an unregistered source, malformed JSON, and own-capture control data. Dependency category: in-process runner fakes and fake services. Isolation boundary: no real browser navigation, live x.com, network, user profile, or customer database.

## Definition of Done

- `ExternalXSignalsCaptureObserver` attaches without blocking the existing observer.
- Registered external source responses produce external observed batches.
- Unregistered responses are ignored fail-closed.
- Malformed responses never throw to Playwright listener chains.
- Tests prove the new observer does not issue active browser/network commands.
- Tests prove registered external observations do not call/write the own-post repository through the existing live-capture path.

## Acceptance Criteria

- Given a registered external source and a page-issued `UserByScreenName`/`UserTweets` response / When the observer handles it / Then `ExternalXSignalsService.ingestObservedTimeline` receives one source-gated batch.
- Given an unregistered external account response / When the observer handles it / Then no external evidence is persisted.
- Given a malformed GraphQL response / When `response.json()` or normalization fails / Then the observer logs/tolerates and never throws.
- Given the existing own-post capture observer and new external observer are both attached / When registered external-source fixture responses are emitted / Then the own-post repository is not called or written for that external evidence.
- Given normal own-capture fixture responses / When the existing observer handles them / Then own-post capture behavior remains intact.

## Edge Cases

- Profile response arrives before tweets.
- Tweets arrive before profile.
- Source is removed between observation and ingest.
- Duplicate observed batches dedupe through the service/repository.

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon. Validator concern added: dual observer tests must prove external observations cannot leak into own-post capture.
- 2026-06-28: Implemented observe-only `ExternalXSignalsCaptureObserver`, runner default wiring, source-gated profile/timeline identity handling, pending tweets flush after profile identity, and own-capture skip coordination. Verification: `./node_modules/.bin/vitest run src/external-x-signals-capture-observer.test.ts src/graphql-capture-observer.test.ts src/transport-engine-bindings.integration.test.ts src/runner-app.test.ts src/runner-app-sqlite-host-swap.test.ts`; `./node_modules/.bin/tsc -p tsconfig.json --noEmit`; RGB gates from `2482f60`.
