---
status: todo
---

# RTC-008: Fail Closed Context-Required LLM Actions

## Implementation Details

Wire the resolver and guard into existing generate, judge, and apply paths. Success response schemas stay unchanged. When a context-required path needs parent context and it was not observed, the engine returns or throws `reply_context_incomplete` with canonical diagnostics.

The overlay catches this structured failure from both HTTP-shaped route calls and in-process `window.__xbTransport` rejections, renders blocking diagnostics, and does not write generated or applied text.

## Data Models

`reply_context_incomplete` carrier:

```ts
{
  code: "reply_context_incomplete";
  scope: "reply-context";
  status: 409;
  retryable: true;
  message: "Required reply parent context was not observed.";
  details: {
    replyThreadContextDiagnostics: ReplyThreadContextDiagnostics;
  };
}
```

In-process bindings may reject with this schema-shaped object or an `Error` carrying `.apiError` with this object. Overlay handling must normalize both forms.

## Integration Point

User entry point: clicking existing generate, judge, or apply actions in reply mode.

Existing module consumers: `/ideas/generate`, `/drafts/judge`, `/drafts/apply-suggestions`, `createBoundEngineServices`, runner transport binding, `ComposeCockpit` action handlers.

Terminal outcome: context-required actions fail closed when parent context is missing, without changing normal post behavior or successful reply behavior.

## Scope Boundaries / Out of Scope

In scope:

- Resolver/guard call before prompt use for generate/judge/apply.
- `reply_context_incomplete` route and in-process error mapping.
- Overlay error normalization and blocking diagnostic rendering.
- Preventing generated/applied text writes after a blocked context error.

Out of scope:

- Generate/judge/apply success diagnostics fields.
- New endpoints.
- New transport bindings.
- Auto retry.
- Parent/thread browsing fallback.

## Test Strategy & Fixture Ownership

Coverage level: engine route tests, bound-service integration tests, overlay fake-transport tests.

Owning suites: engine server tests, runner bound-engine-services tests, overlay compose cockpit tests.

Fixture strategy: resolver fake returning blocked diagnostics; fake transport rejecting with schema-shaped object and with `Error.apiError`.

Dependency category: in-process and local fake transport.

Isolation boundary: no live X, no real LLM provider.

## Definition of Done

- Generate, judge, and apply success schemas remain unchanged.
- Missing required parent context maps to `reply_context_incomplete`.
- Overlay displays blocking diagnostics from both HTTP and in-process rejection forms.
- Blocked generate/apply does not write text into the composer.
- Normal post generation behavior remains unchanged.

## Acceptance Criteria

- Given: required parent context is missing / When: generate runs / Then: the action fails with `reply_context_incomplete` and `details.replyThreadContextDiagnostics`.
- Given: `window.__xbTransport` rejects with `Error.apiError.code = "reply_context_incomplete"` / When: overlay handles it / Then: the same blocking diagnostic is rendered.
- Given: generate is blocked by missing context / When: the action fails / Then: composer text is unchanged.
- Given: normal post generation succeeds / When: the action completes / Then: behavior matches current generation behavior.
- Given: judge/apply fail for provider reasons / When: the action fails / Then: those failures are not mislabeled as `reply_context_incomplete`.

## Edge Cases

- Existing analyze diagnostics are stale.
- Error object has only message and no details.
- Apply rewrites text but re-judge fails.
- User switches target while action is in flight.

## Pipeline Log
