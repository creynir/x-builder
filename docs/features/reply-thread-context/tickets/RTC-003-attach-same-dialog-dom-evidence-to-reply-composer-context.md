---
status: todo
---

# RTC-003: [FND] Attach Same-Dialog DOM Evidence To ReplyComposerContext

## Implementation Details

Extend the existing `AnchorLayer` reply context creation path so a valid same-dialog `replyContext` also carries `replyThreadDomEvidence`. The existing `replyContext` fields and split/merge behavior must remain unchanged.

Incomplete same-dialog target evidence may be exposed as local compose diagnostics, but it must not create or send a fake `replyContext`.

## Data Models

Producer output:

```ts
replyContext.replyThreadDomEvidence?: ReplyThreadDomEvidence
```

`replyThreadDomEvidence.currentTarget` is derived from the same DOM facts that already produce `targetAuthorHandle`, `targetDisplayName`, `targetText`, `targetStatusId`, and `targetUrl`.

## Integration Point

User entry point: opening an X reply composer with a same-dialog target.

Existing module consumers: `AnchorLayer`, `ComposeContextValue`, `ComposeCockpit`, and existing engine request payloads carrying `replyContext`.

Terminal outcome: existing compose actions send current-target DOM evidence to the engine through existing request fields.

## Scope Boundaries / Out of Scope

In scope:

- Attach `replyThreadDomEvidence` to valid same-dialog `replyContext`.
- Keep incomplete target evidence local and diagnostic-only.
- Preserve current reply mode detection and normal post behavior.

Out of scope:

- Resolver logic.
- GraphQL evidence.
- Storage.
- Prompt changes.
- New transport methods.
- Browsing or navigation fallback.

## Test Strategy & Fixture Ownership

Coverage level: overlay component/integration tests.

Owning suite: existing `AnchorLayer` reply context tests and compose cockpit tests.

Fixture strategy: reuse X-shaped compose dialog fixtures, including valid reply target, missing status URL, outside-dialog target, and nested quote.

Dependency category: in-process DOM fixtures.

Isolation boundary: jsdom/browser-mode overlay harness.

## Definition of Done

- Valid same-dialog `replyContext` includes `replyThreadDomEvidence`.
- Incomplete same-dialog target evidence does not produce `replyContext`.
- Existing `replyContext` fields are unchanged.
- Existing draft split/merge behavior is unchanged.

## Acceptance Criteria

- Given: a valid same-dialog reply target / When: `AnchorLayer` builds `replyContext` / Then: it includes existing target fields plus `replyThreadDomEvidence.currentTarget.role = "current_target"`.
- Given: a same-dialog target lacking a status URL / When: compose context is computed / Then: `replyContext` is undefined and no engine-bound `replyThreadDomEvidence` is sent.
- Given: a normal post composer / When: compose context is computed / Then: no reply evidence is produced.
- Given: a nested quote inside the reply target / When: evidence is collected / Then: nested quote text is not promoted into the current target evidence.

## Edge Cases

- Target display name missing.
- Status id present but URL missing.
- User deletes leading structural handle.
- Composer target changes between reconciles.

## Pipeline Log
