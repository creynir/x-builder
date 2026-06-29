---
status: done
---

# EFL-005: [INT] Cover external pattern generation integration

## User Flows to Verify

- Given External X Signals has persisted eligible format patterns / When the existing Generate rail path calls `generateIdeas({ format })` through bound engine services / Then writer instructions include sanitized external constraints and generated candidates keep the existing response shape.
- Given no external patterns exist / When `generateIdeas({ format })` runs / Then generation continues with playbook and own voice guidance only.
- Given external patterns exist and the own corpus is empty / When `generateIdeas({ format })` runs / Then no voice samples are rendered and no own-post rows are written.
- Given raw external evidence rows include preview text / When generation runs / Then preview text is absent from writer instructions.

## Architectural Invariants

- `generateIdeaRequestSchema` has no external context field in its parsed/inferred public output shape.
- `EngineTransport` gets no new generate/external-feedback method.
- External guidance is built from persisted `ExternalXSignalPattern` snapshots only.
- `ExternalPatternSnapshotReader` and `ExternalXSignalsService` share the same `ExternalXSignalsRepository` instance in default server/runner construction.
- If `ExternalXSignalsService` is injected without a paired reader/provider, generation does not create a separate unrelated external reader.
- Judge/apply receive no direct external pattern context.
- Raw external evidence, handles, source ids, evidence ids, platform post ids, metrics, and evidence previews are not rendered into writer instructions.

## Modules Under Test

`SqliteExternalXSignalsRepository`, `ExternalPatternSnapshotReader`, `ExternalPatternGuidanceProvider`, `createGenerationGuidanceResolver`, `GenerateIdeasService`, `buildServer`, `createBoundEngineServices`, existing generate transport bindings, and existing shared generate schemas.

## Integration Point

User entry point: existing Generate rail / `generateIdeas({ format })`.

Existing module consumer: `GenerateIdeasService` through bound engine services.

Terminal outcome: the full storage-to-generation path proves external patterns can influence writing guidance without changing public contracts or own-corpus state.

## Scope Boundaries / Out of Scope

In scope: integration tests over storage, provider, resolver, generation service, and construction wiring.

Out of scope: no overlay visual E2E, no live X, no browser automation, no new transport method, no judge/apply direct context, no docs.

Zero-trace: do not add test-only production hooks that expose raw evidence or public external guidance fields.

## Test Strategy & Fixture Ownership

Coverage level: integration tests. Owning suites: engine and runner integration tests. Fixture strategy: temp SQLite DB, seeded external patterns, raw evidence rows with sentinel preview text, fake structured LLM prompt capture, fake judge response, and empty own-post repository. Dependency category: local-substitutable SQLite and in-process fakes. Isolation boundary: temp roots only; no developer-local settings DB, no live X, no network.

## Definition of Done

- Integration coverage proves persisted external patterns reach generation prompts.
- Public generate schemas and transport method counts remain unchanged.
- Same-repository construction invariant is covered for server and runner defaults.
- Raw evidence and own-corpus contamination invariants are covered.
- The tests fail against a facade implementation that hardcodes guidance without using persisted patterns.

## Acceptance Criteria

- Given persisted external patterns / When `generateIdeas({ format })` runs through the bound service path / Then writer instructions include sanitized external constraints.
- Given raw evidence rows with preview text / When generation runs / Then the preview text is absent from writer instructions.
- Given own corpus is empty / When generation runs / Then no voice samples are rendered and no own-post rows are written.
- Given generate transport bindings are counted / When tests run / Then the transport surface remains unchanged.
- Given default server and runner construction / When external services and generation resolver are created / Then the provider and `ExternalXSignalsService` use the same external repository source.

## Edge Cases

- Duplicate persisted patterns must not cause unbounded prompt growth.
- Provider read failure must not fail generation.
- Removed-source evidence may remain in the ledger but is not a prompt source.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon. Validator construction-contract fix included.
- 2026-06-29: Integration pipeline started after EFL-004 Yellow approval.
- 2026-06-29: Purple/Blue approved integration coverage in `47f92b6` plus removed-source-only fix in `3c6e01f`. Integration validation first exposed that persisted patterns tied only to removed sources could still render; `listGenerationPatterns` now requires at least one active supporting source while preserving active-source guidance.
