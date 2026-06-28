---
status: done
---

# EXS-009: [E2E] Verify overlay ExternalXSignals workflow

## User Flows to Verify

- Given the overlay is mounted over the local runner harness with ExternalXSignals transport available / When the user opens settings / Then the ExternalXSignals section appears between Feedback loop and X archive without overlapping or resizing the panel.
- Given the user adds `@external_builder` / When the add form submits / Then the section shows the source row and a waiting/no-observation state.
- Given mock X emits page-issued profile and timeline GraphQL responses for the registered source / When the user refreshes the source / Then the section shows evidence counts and server-derived pattern rows.
- Given a populated source row / When the user removes the source / Then active overview rows update and own captured-post summary remains unchanged.

## Architectural Invariants

- The full user path goes through overlay `useTransport`, runner transport assembly, bound engine services, and the local external ledger.
- E2E fixtures simulate page-issued GraphQL responses; the runner must not craft active X requests or navigate the page to fetch data.
- The UI renders patterns from `getExternalXSignalsOverview`, not from client-side scanning.
- External evidence is labelled as external source evidence and never as the user's captured posts.
- The own captured-post summary remains separate from external source counts.

## Modules Under Test

- `SettingsAffordance`
- `SettingsPanel`
- `ExternalXSignalsSettingsSection`
- `OverlayTransportProvider`
- runner transport harness
- `ExternalXSignalsCaptureObserver`
- external signals engine services over a temp database
- mock X GraphQL fixtures

## Pipeline Log

- 2026-06-28: Ticket authored from approved arch recon.
- 2026-06-28: Added Playwright coverage for settings add/refresh/remove, page-issued mock X GraphQL replay, external pattern rendering, and own captured-post summary isolation through the real runner transport.
- 2026-06-28: Updated the E2E runner harness to mirror production external-observer skip wiring for registered external sources.
- 2026-06-28: Verification: `./node_modules/.bin/tsc -p tsconfig.json --noEmit`; `./node_modules/.bin/playwright test tests/external-x-signals-settings.spec.ts tests/runner-capture-observe-only.spec.ts --config tests --workers=1 --timeout=45000` (4 passed).
