---
status: todo
---

# RTC-007: Analyze Response Reply Thread Diagnostics

## Implementation Details

Wire `ReplyThreadContextResolver` into the existing analyze path. Add optional `replyThreadContext` and `replyThreadContextDiagnostics` to analyzed items. The overlay should read diagnostics from the latest analyze result and render them in the compose cockpit static pin.

## Data Models

Analyze item additions:

```ts
{
  replyThreadContext?: ReplyThreadContext;
  replyThreadContextDiagnostics?: ReplyThreadContextDiagnostics;
}
```

Success diagnostics are analyze-only.

## Integration Point

User entry point: typing in an active reply composer and the existing static analyze flow.

Existing module consumers: engine analyze service/routes, shared analyze response schema, runner binding parser, `ComposeCockpit`, static pin layout.

Terminal outcome: reply-mode users see complete/partial/blocking thread diagnostics without a new transport call.

## Scope Boundaries / Out of Scope

In scope:

- Analyze path resolver invocation.
- Analyze response schema additions.
- Compose cockpit diagnostics rendering from analyze result.
- Local incomplete-target diagnostics in reply mode where applicable.

Out of scope:

- Generate/judge/apply success response changes.
- New transport binding.
- Standalone thread panel.
- Fetch button or navigation fallback.

## Test Strategy & Fixture Ownership

Coverage level: engine route/unit tests and overlay component/browser tests.

Owning suites: engine analyze tests, shared schema tests, runner binding tests if needed, overlay compose cockpit tests.

Fixture strategy: fake transport responses with `replyThreadContextDiagnostics`, engine resolver fakes, existing compose fixtures.

Dependency category: in-process and fake transport.

Isolation boundary: no live X, no local runtime database.

## Definition of Done

- Analyze item diagnostics survive schema parse and runner binding parse.
- Compose cockpit renders diagnostics in reply mode.
- Post mode renders no reply thread diagnostics.
- Generate/judge/apply success response schemas remain unchanged.

## Acceptance Criteria

- Given: missing parent context / When: analyze completes / Then: the analyzed item includes `replyThreadContextDiagnostics`.
- Given: analyze returns `thread_ready` / When: compose cockpit renders / Then: the static pin can show a compact complete status.
- Given: analyze returns `blocked_missing_required_parent` / When: compose cockpit renders / Then: the static pin shows a blocking diagnostic.
- Given: a normal post composer / When: analyze completes / Then: no reply thread diagnostics are rendered.

## Visual AC

- Use existing v2 primitives only.
- Render diagnostics above `StaticEngineColumn` in the existing static pin.
- Warning diagnostics use existing warning alert styling.
- Blocking diagnostics use existing danger/error alert styling.
- Details use native `details/summary` plus existing key/value and badge primitives.
- No modal, drawer, oversized card, or standalone thread browser.

## Edge Cases

- Stale diagnostics when target changes.
- Analyze failure unrelated to context.
- Local incomplete-target diagnostics without engine-bound reply context.
- Very long target/root text preview.

## Pipeline Log
