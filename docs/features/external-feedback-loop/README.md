---
status: done
---

# External Feedback Loop

External Feedback Loop lets generation borrow abstract writing constraints from the delivered External X Signals ledger without importing another account into the user's own writing system.

It consumes persisted External X Signals pattern snapshots as sanitized generation guidance. Those patterns can shape a writer prompt as weak constraints, but they do not become the user's voice, history, feedback actuals, local post library, active context, scoring data, or remediation basis.

## What It Consumes

External X Signals remains the producer, source-management, and ledger feature. It owns external sources, evidence capture, refresh runs, and locally persisted derived pattern snapshots.

External Feedback Loop is only the generation consumer boundary. It reads eligible persisted pattern snapshots and turns them into sanitized prompt guidance. It does not read or render raw evidence text, preview text, handles, platform post IDs, source IDs, evidence IDs, metrics, raw external post bodies, or patterns supported only by removed sources.

EFL-005 fixed the removed-source case: generation-eligible patterns must have at least one active supporting source before they can be listed for guidance.

## Where It Appears

The user entry point is unchanged: the existing Generate rail calls `POST /ideas/generate`, which flows through `generateIdeas({ format })`.

The public generate request and response schemas are unchanged. There is no new request field for external guidance, and unknown external guidance fields are stripped during request parsing. There is also no new `EngineTransport` method, overlay UI, External Feedback Loop endpoint, or separate generation API surface.

External guidance is engine-private because external patterns are weak writing constraints. They are not user-authored voice samples, user history, or feedback outcomes, so exposing them as public generation inputs would make them look more authoritative than they are.

## How Guidance Is Built

The construction contract keeps the producer and consumer attached to the same local ledger. `ExternalXSignalsService` writes patterns to an `ExternalXSignalsRepository`. The default server and runner generation guidance provider/readers are constructed from that same repository source.

If a host injects an external signals service without a paired reader/provider, generation keeps external guidance disabled instead of creating an unrelated reader. That prevents a split-brain setup where the service writes to one ledger while generation reads from another.

At generation time, the flow is:

1. `ExternalPatternSnapshotReader` reads eligible persisted pattern snapshots.
2. `ExternalPatternGuidanceProvider` converts those snapshots into sanitized guidance items.
3. Generation guidance composes the external section with the requested format playbook and the user's own voice samples.
4. `GenerateIdeasService` appends the resulting guidance to the writer prompt.

The external section is bounded. Duplicate or high-volume patterns are capped, and provider or read failures do not fail generation. If external guidance cannot be read safely, generation continues without it.

## Contamination Boundaries

External Feedback Loop is intentionally narrow. Tests enforce that external patterns do not write to `PostLibraryRepository`, own posts, or local post history. External data is not rendered as voice samples. It is not recorded as feedback actuals and does not contaminate active context, scoring, cooldown, category ranking, archive import, live capture, judge prompts, or apply prompts.

Judge/apply in v1 may evaluate generated text after generation has used external constraints, but those services do not receive external pattern context directly. Passing external evidence into judge or apply would turn external observations into a scoring or remediation basis rather than keeping them as generation-only constraints.

## How It Differs From Related Features

My Feedback Loop learns from the user's own predictions and outcomes. It is grounded in the user's own posts, expectations, and actual performance. External Feedback Loop does not create user actuals and does not train on another account as if it were the user. It only borrows abstract pattern constraints from external accounts.

External X Signals collects, stores, refreshes, and derives the external ledger. External Feedback Loop starts after that ledger work is done. Its job is to render only sanitized eligible patterns into generation guidance, while preserving the boundary between external observations and the user's own writing system.

<!-- Tickets: EFL-001, EFL-002, EFL-003, EFL-004, EFL-005, EFL-006 — last verified against codebase 2026-06-29 -->
