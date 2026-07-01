---
status: done
---

# RVA-004: Reply Variant Generation Routes And Service

## Implementation Details

Implement the engine-side reply variant generation and generated reply record routes.

Required surfaces:

- `POST /replies/variants/generate`
- `POST /generated-replies/record`
- `ReplyVariantGenerationService`
- `GeneratedReplyLedgerService`
- default service bundle wiring

`/replies/variants/generate` must enrich `replyContext` through the observed-only reply thread resolver before generation. Missing required observed context maps to `reply_context_incomplete`. Generation must use the reply context and optional `currentAuthoredBody` as draft context only, never as posted/corpus evidence.

`ReplyVariantGenerationService` must call structured LLM generation for reply variants but must not call `GenerateIdeasService`, `JudgeDraftService`, post candidate judging, reach model, Post Coach, or apply suggestions.

`/generated-replies/record` records the chosen generated body through the ledger service. Ledger failures map to a reply-assistant storage error and are retryable from the client, but the later UI must treat them as non-blocking after composer write.

## Data Models

Consumes shared contracts from RVA-002 and generated reply repository from RVA-003.

Structured LLM output must match `GenerateReplyVariantsResponse` exactly.

## Integration Point

User entry point: reply assistant generate and choose/record actions.

Existing module consumer: engine Fastify routes, default service bundle, runner transport binding in the next ticket, and overlay UI in later tickets.

Terminal outcome: engine can generate 3-4 unscored reply variants from observed reply context and record selected generated bodies.

## Scope Boundaries / Out of Scope

In scope: engine service, route handlers, route tests, error mapping, default service wiring.

Out of scope: runner expose-function transport handlers, overlay UI, voice evidence exclusion, generated-content promotion, LLM judge, apply-all, reach scoring, and post category generation changes.

Zero trace: no route or service may expose reply scoring fields.

## Test Strategy & Fixture Ownership

Coverage level: engine service unit tests and Fastify route tests.

Fixture ownership: service tests own fake structured LLM responses; route tests reuse existing buildServer/test server patterns with fake reply thread resolver and ledger repository where needed.

Isolation boundary: fake LLM, in-memory database, no CLI model providers, no live X.

## Definition of Done

- Route validates request/response contracts.
- `currentAuthoredBody` is passed through to service logic.
- `reply_context_incomplete` is preserved for observed-context failures.
- Service returns 3-4 distinct unscored variants and strips/forbids structural target-handle duplication at the service boundary where possible.
- Service tests prove no judge/reach/Post Coach/apply path is called.

## Acceptance Criteria

- Given: a valid reply context and optional current authored body / When: `/replies/variants/generate` is called / Then: response contains 3-4 body-only unscored variants.
- Given: a request with incomplete required observed context / When: the route enriches context / Then: it returns `reply_context_incomplete`.
- Given: generated variants include forbidden fields / When: response parsing runs / Then: the route fails the contract.
- Given: `recordGeneratedReply` receives a chosen body / When: route is called / Then: the generated reply ledger records the normalized hash.
- Given: service dependencies are instrumented / When: reply variants are generated / Then: no candidate judge, reach model, Post Coach, or apply suggestions dependency is invoked.

## Visual AC

No UI changes.

## Edge Cases

- LLM returns two or five variants.
- LLM returns body with a structural `@target` prefix.
- Ledger duplicate record by hash/client event.
- Optional root/ancestor context is missing but target context is present.

## Pipeline Log

- 2026-07-01: Implemented reply-only variant generation service and HTTP routes; route and service tests passed.
