---
status: done
---

# RVA-002: [FND] Reply Assistant Shared Contracts And Transport Surface

## Implementation Details

Add reply-specific shared schemas and transport names without implementing service behavior.

Required contracts:

- `GenerateReplyVariantsRequest` is strict, requires `replyContext`, and accepts optional `currentAuthoredBody` capped at 1,000 characters. The field name must be `currentAuthoredBody`, not `currentBody`.
- `GenerateReplyVariantsResponse` returns `variants` with 3-4 unscored body-only reply variants.
- `ReplyVariant` includes `id`, `body`, `replyMove`, `groundingNotes`, and `warnings`.
- `RecordGeneratedReplyRequest` is strict and records the chosen generated body plus the written text after selection.
- `RecordGeneratedReplyResponse` returns a record plus `duplicate`.
- `EngineTransport` gains `generateReplyVariants` and `recordGeneratedReply`; the pinned transport surface count moves from 24 to 26.

Reply variant responses must not contain `verdict`, `approved`, reach score, Post Coach, judge annotations, post format/category, or apply-all fields.

## Data Models

Shared TypeScript/Zod contracts:

- `generateReplyVariantsRequestSchema`
- `replyVariantSchema`
- `generateReplyVariantsResponseSchema`
- `recordGeneratedReplyRequestSchema`
- `generatedReplyRecordSchema`
- `recordGeneratedReplyResponseSchema`

`replyContext` uses the existing reply composer context schema.

## Integration Point

User entry point: the future reply assistant generate and choose controls.

Existing module consumer: overlay transport, runner expose-function transport, and engine routes will consume these schemas in later tickets.

Terminal outcome: compile-time and runtime schema surfaces exist for reply generation and generated reply recording, with no service side effects yet.

## Scope Boundaries / Out of Scope

In scope: shared schemas, exports, transport interface/binding names, fake transport type updates, contract tests.

Out of scope: Fastify route handlers, runner binding handlers, engine services, SQLite migrations, overlay UI behavior, and any use of these methods in product UI.

Zero trace: no placeholder service implementation that silently returns fake variants.

## Test Strategy & Fixture Ownership

Coverage level: shared schema unit tests and transport surface contract tests.

Fixture ownership: shared schema tests own schema-shaped payload fixtures; runner/overlay fake transport tests own transport method presence expectations.

Isolation boundary: no engine server, no LLM, no database.

## Definition of Done

- Shared exports are available from the package public index.
- Transport binding registry and interface include exactly the two new methods.
- Tests prove the schema accepts 3 and 4 variants, rejects 2 and 5 variants, accepts `currentAuthoredBody`, and rejects stale `currentBody`.
- Tests prove judged/scored fields are rejected or have no schema surface.

## Acceptance Criteria

- Given: a request with `replyContext` and `currentAuthoredBody` / When: parsed / Then: the request is accepted.
- Given: a request with `currentBody` instead of `currentAuthoredBody` / When: parsed strictly / Then: it fails.
- Given: a response with 3 or 4 variants / When: parsed / Then: it succeeds.
- Given: a variant with `verdict`, `approved`, reach score, Post Coach, post format/category, or apply suggestions / When: parsed by the strict schema / Then: it fails.
- Given: transport binding tests / When: method names are enumerated / Then: the count is 26 and includes `generateReplyVariants` and `recordGeneratedReply`.

## Visual AC

No UI changes.

## Edge Cases

- Empty `currentAuthoredBody` should be accepted as omitted/empty draft context only, not evidence.
- Long variant bodies over bounds fail schema validation.

## Pipeline Log

- 2026-07-01: Implemented strict reply schemas and 26-method transport surface; shared and runner contract tests passed.
