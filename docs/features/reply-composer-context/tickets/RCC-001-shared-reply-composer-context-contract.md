---
status: todo
---

# RCC-001: [FND] Shared Reply Composer Context Contract

## Implementation Details

Add a shared `ReplyComposerContext` contract and thread it additively through existing request schemas:

```ts
type ReplyComposerContext = {
  source: "same_dialog_dom";
  targetAuthorHandle: string;
  targetDisplayName?: string;
  targetText: string;
  targetStatusId?: string;
  targetUrl?: string;
  leadingTargetHandle: {
    handle: string;
    state: "present" | "user_deleted";
  };
};
```

Add optional `replyContext` to:

- `GenerateIdeaRequest`
- `JudgeDraftRequest`
- `ApplyJudgeSuggestionsRequest`
- `AnalyzePostsRequest.items[]`

Preserve the existing `EngineTransport` method names and binding names. This ticket changes payload types only.

`GenerateIdeaRequest` must still require at least one of `idea` or `format`. A request containing only `replyContext` is invalid and must not create a new generation mode.

## Data Models

`ReplyComposerContext` fields:

- `source`: literal `"same_dialog_dom"`.
- `targetAuthorHandle`: X handle without `@`, one to fifteen handle characters.
- `targetDisplayName`: optional display name, bounded text.
- `targetText`: normalized visible target text, bounded text.
- `targetStatusId`: optional numeric X status id string.
- `targetUrl`: optional X status URL.
- `leadingTargetHandle.handle`: X handle without `@`.
- `leadingTargetHandle.state`: whether the structural handle is currently present or was explicitly deleted by the user.

Every optional `replyContext` field is additive. Existing request and response schemas must remain backward compatible.

## Integration Point

Producer: later overlay reply detection in `ComposeContextValue`.

Consumers: `ComposeCockpit`, shared schema tests, `EngineTransport` payload types, engine route parsing, `JudgeDraftService`, `GenerateIdeasService`, `ApplyJudgeSuggestionsService`, and `DeterministicAnalysisService`.

User entry point: the user opens the existing X composer; later tickets populate and consume this contract when the composer is a reply.

Terminal outcome: shared request contracts can carry reply metadata without changing current normal-post request behavior.

## Scope Boundaries / Out of Scope

In scope:

- Shared Zod schema and inferred type for reply composer context.
- Optional `replyContext` request fields on existing schemas.
- Exports needed by existing package conventions.
- Shared schema tests for valid/invalid reply context and backward compatibility.

Out of scope, with zero code:

- DOM detection.
- Compose cockpit behavior.
- Engine prompt behavior.
- Deterministic scoring behavior.
- HTTP route pass-through behavior beyond type/schema availability.
- Any new transport method or binding.
- Reply-context-only generation.

## Test Strategy & Fixture Ownership

Coverage level: shared schema unit tests.

Owning suite: shared schema tests.

Fixture strategy: compact shared-schema fixtures for a valid reply context, invalid handles, oversized target text/url, omitted optional fields, and generation requests with and without valid generation seeds.

Dependency category: in-process Zod parsing only.

Isolation boundary: no runtime engine, X DOM, filesystem state, local settings, network, or browser session.

## Definition of Done

- `ReplyComposerContext` schema and type are exported through the shared package convention.
- `GenerateIdeaRequest`, `JudgeDraftRequest`, `ApplyJudgeSuggestionsRequest`, and `AnalyzePostsRequest.items[]` accept optional `replyContext`.
- Existing normal post request shapes still parse.
- `{ format, replyContext }` parses.
- `{ replyContext }` for generation fails validation.
- Transport method names and binding names are unchanged.
- Shared package typecheck and targeted schema tests pass.

## Acceptance Criteria

- Given a valid reply context with `targetAuthorHandle`, `targetText`, and `leadingTargetHandle`, when the shared schema parses it, then all fields round-trip.
- Given a normal `GenerateIdeaRequest` with only `format`, when it parses, then the parsed output is unchanged except existing defaults.
- Given `GenerateIdeaRequest` with `format` and `replyContext`, when it parses, then the request succeeds and preserves the context.
- Given `GenerateIdeaRequest` with only `replyContext`, when it parses, then validation fails.
- Given `JudgeDraftRequest`, `ApplyJudgeSuggestionsRequest`, or an analyze item with `replyContext`, when it parses, then the context is preserved.
- Given invalid handle characters or an oversized target field, when the reply context parses, then validation fails.

## Visual AC

N/A.

## Edge Cases

- Missing optional status id and target URL.
- Empty or whitespace target text.
- Handle supplied with `@`.
- Invalid status id.
- `leadingTargetHandle.state: "user_deleted"`.
- Legacy requests with no `replyContext`.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
