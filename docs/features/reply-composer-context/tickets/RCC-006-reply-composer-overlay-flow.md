---
status: in_progress
---

# RCC-006: [E2E] Reply Composer Overlay Flow

## User Flows to Verify

- Given a mock X reply dialog with target article, target author, target text, status URL, and composer prefix `@alice `, when the overlay loads and the user clicks a generation category, then the composer text becomes `@alice <generated body>` with exactly one prefix while transport receives body text plus `replyContext`.
- Given the same reply dialog and the user types a body, when the user runs judge and apply-all, then the cockpit sends body text plus `replyContext`, writes prefix plus returned body, and preserves generated provenance.
- Given a normal compose dialog whose text starts `@alice body`, when the user uses generation/judge/analyze/apply flows, then it behaves as a normal post and does not strip the mention.
- Given a reply-looking dialog missing reliable target article/text/author evidence, when the overlay loads, then reply-aware context is withheld and reply-aware writes do not run.

## Architectural Invariants

- The flow uses the existing overlay compose cockpit, not a separate reply route, panel, or product surface.
- No new transport method exists for reply mode; existing `EngineTransport` methods carry optional context.
- Prefix merge is visible only at the composer-write boundary.
- Missing target evidence fails closed: ordinary compose remains normal, and partial reply evidence does not create invented target context.
- No test clicks X's Post button or performs a real X account action.

## Modules Under Test

- Runner/overlay E2E harness.
- Overlay runtime injection.
- `AnchorLayer` compose detection.
- `ComposeCockpit` generation, judge, analyze, and apply paths.
- Fake/schema-shaped transport used by the E2E harness.

## Integration Point

User entry point: an X-shaped mock page with an existing reply composer and the overlay active.

Terminal outcome: the user-visible X composer contains the correct reply text, and captured transport calls prove the engine boundary received authored body plus reply context.

## Scope Boundaries / Out of Scope

In scope:

- E2E mock page or fixture for reply composer DOM.
- Fake transport capture and assertions.
- Normal compose regression flow.
- No-post safety assertion.

Out of scope, with zero code:

- Live x.com.
- Real logged-in session.
- Real LLM provider.
- Real posting, liking, following, reposting, DMs, or crafted X requests.
- New feature implementation beyond test/harness fixes needed to run the E2E.

## Test Strategy & Fixture Ownership

Coverage level: E2E.

Owning suite: `@x-builder/e2e-tests` or the current runner/overlay E2E harness, using behavior-named specs and fixtures.

Fixture strategy: mock X DOM page containing a reply target article and composer; fake transport with schema-shaped generate/judge/apply/analyze responses and captured request log.

Dependency category: local/in-process harness and route/transport fakes. No true external dependency.

Isolation boundary: explicit test page/server root; no inference from developer-local X sessions, runtime state, open ports, or customer-authored files.

## Definition of Done

- Reply generate flow passes through the overlay harness and preserves exactly one visible target prefix.
- Reply judge/apply flow sends body text plus context and writes merged full composer text.
- Normal compose leading mention regression passes.
- Missing-target fail-closed regression passes.
- E2E command or strongest available targeted E2E command passes.

## Acceptance Criteria

- Given reply composer prefix `@alice ` and generated body `agree with this`, when generation completes, then composer text is `@alice agree with this`.
- Given generated body `@alice agree with this`, when generation completes with a present structural prefix, then composer text still contains only one `@alice ` prefix.
- Given reply body `good point`, when judge/apply runs, then captured transport requests include `replyContext` and text `good point`.
- Given normal compose text `@alice good point`, when flows run, then captured transport requests do not include `replyContext` and text remains `@alice good point`.
- Given missing reliable reply target evidence, when the overlay loads, then no reply context is produced and no reply-aware write occurs.
- Given any tested flow, when the test completes, then X's Post button was not clicked.

## Visual AC

- Cockpit remains anchored around the existing composer.
- No new reply-specific card or panel appears.
- Confirmation sheet stand-down behavior is not regressed.
- Generated provenance remains visible according to the existing cockpit behavior after apply/generate.

## Edge Cases

- SPA dialog churn while the overlay is mounted.
- Prefix deletion before generate.
- Duplicate prefix returned by the fake generator.
- Transport failure.
- Empty authored body.
- Mock page viewport narrow enough for stacked cockpit mode.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
