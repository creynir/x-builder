---
status: todo
---

# RTC-009: [INT] Existing Transport Boundary Contract

## User Flows to Verify

- Given: a reply composer sends `replyContext.replyThreadDomEvidence` through analyze / When: the request crosses shared schema, runner binding, and engine service layers / Then: diagnostics return on `replyThreadContextDiagnostics` without adding a new binding.
- Given: a context-required generate request lacks required parent context / When: the request crosses HTTP and in-process transport paths / Then: the failure shape is `reply_context_incomplete`.
- Given: a normal post compose request / When: analyze/generate/judge/apply run / Then: no reply thread context or diagnostics are attached.

## Architectural Invariants

- `ENGINE_TRANSPORT_BINDINGS` remains at the current method count.
- No `resolveReplyThreadContext` binding exists.
- `replyThreadContextDiagnostics` is the only success diagnostics field.
- Generate/judge/apply success schemas are not widened with diagnostics.
- The same `reply_context_incomplete` contract is usable from route and in-process transport failures.
- Thread context travels only through existing `replyContext` request fields.

## Modules Under Test

- Shared engine transport and request/response schemas.
- Runner expose-function transport parser.
- Runner bound engine services.
- Engine analyze/generate/judge/apply route wiring.
- Overlay fake transport consumption of analyze diagnostics and action errors.

## Pipeline Log
