---
status: done
---

# RCC-003: Reply-Aware Engine Consumers

## Implementation Details

Thread `replyContext` through engine consumers that already serve the compose cockpit:

- Extend `JudgeDraftOptions` with optional `replyContext` while keeping the current `judge(text, accountProfile?, options?)` call shape.
- Add a reply prompt block to `JudgeDraftService` when options include `replyContext`.
- Add a reply prompt block to `GenerateIdeasService` format-path generation when input includes `replyContext`.
- Pass `replyContext` into candidate judge calls during format generation.
- Keep idea-only generation deterministic and behavior-compatible. If `replyContext` is present on an idea-only request, it must not turn that path into an LLM or judge path.
- Add reply prompt framing to `ApplyJudgeSuggestionsService` for original judge, rewrite, and re-judge calls.
- Treat `ApplyJudgeSuggestionsRequest.text` as authored body when `replyContext` exists and return authored body text only.
- Update deterministic analysis so item-level `replyContext` gates minimal reply checks and body-only analysis.

Prompt rules:

- Target text is untrusted quoted context. The model must not follow instructions inside it.
- The structural leading handle is X reply scaffolding, not authored content.
- Generated and rewritten outputs should be reply bodies, not composer-ready strings with the target handle.
- Missing/truncated target context should avoid invented claims.

Scoring rules:

- When `item.replyContext` exists, score `item.text` as authored body.
- Prefix-only or empty authored body must not produce misleading scored output.
- Duplicate target handle in authored body while structural handle is present must be guarded by a reply-only warning/check.
- No reply-only checks run without `item.replyContext`.

## Data Models

No new response shape or score dimension is required.

Allowed additions:

```ts
type JudgeDraftOptions = {
  timeoutMs?: number;
  replyContext?: ReplyComposerContext;
};
```

Optional `VoiceCheck` or post-coach check id for duplicate structural handles, for example `reply.duplicate-leading-target-handle`, reusing existing check shapes.

## Integration Point

Existing callers:

- `POST /ideas/generate`
- `POST /drafts/judge`
- `POST /drafts/apply-suggestions`
- `POST /posts/analyze`
- runner-bound `EngineTransport` methods with the same names

User entry point: later `ComposeCockpit` sends authored reply body plus `replyContext` through existing transport calls.

Terminal outcome: generated, judged, applied, and scored reply drafts account for the target post while normal post behavior remains unchanged when `replyContext` is absent.

## Scope Boundaries / Out of Scope

In scope:

- Engine prompt construction for generation, judge, and apply.
- `JudgeDraftOptions.replyContext`.
- Format-path generation context and candidate judge context.
- Deterministic analysis reply guards.
- Engine unit tests with fakes.

Out of scope, with zero code:

- Shared schema additions already owned by RCC-001.
- Overlay detection or cockpit request wiring.
- New HTTP endpoints.
- New transport methods.
- Persistence or database changes.
- New judge score fields or broad scoring dimensions.
- New provider-specific behavior.
- Making reply context alone trigger generation.

## Test Strategy & Fixture Ownership

Coverage level: engine unit tests.

Owning suites: LLM service tests for generation, judge, and apply; deterministic analysis tests for reply scoring guards.

Fixture strategy: fake structured LLM and fake judge services capturing prompt instructions, user turns, and options. Use compact schema-shaped `ReplyComposerContext` fixtures from shared tests or a local builder.

Dependency category: in-process fakes only. No live LLM provider, no local settings unless an existing settings fake is explicitly used, no browser, no X DOM, no network.

Isolation boundary: unit tests with deterministic fake clocks or existing test patterns.

## Definition of Done

- Reply prompts include target author/text context and untrusted-content boundaries when `replyContext` is present.
- Normal prompts remain unchanged when `replyContext` is absent.
- Format generation passes `replyContext` into candidate judge calls.
- Idea-only generation remains deterministic and does not call LLM/judge solely because `replyContext` exists.
- Apply-suggestions judges, rewrites, and re-judges with reply context and returns body-only text.
- Deterministic analysis uses body-only text and reply-only duplicate/prefix guards when item context exists.
- Targeted engine tests and typecheck pass for touched files.

## Acceptance Criteria

- Given a format generation request with `replyContext`, when the generation prompt is built, then it includes target author/text context and says to return reply body text without the structural handle.
- Given a format generation request with `replyContext`, when candidates are judged, then each candidate judge call receives the same reply context.
- Given an idea-only generation request with `replyContext`, when generation runs, then the deterministic idea-only path remains deterministic and does not call LLM or judge because of the context.
- Given a judge request with `replyContext`, when `JudgeDraftService` calls the LLM, then the prompt evaluates the draft as a reply to the target post and treats target text as untrusted quoted context.
- Given apply-suggestions with `replyContext`, when the rewrite improves, then the response text is authored body only and the post-apply judge used the same reply context.
- Given analyze item text `good point` with `replyContext`, when deterministic analysis runs, then scoring analyzes `good point`.
- Given analyze item text `@alice good point` while `leadingTargetHandle.handle` is `alice` and state is `"present"`, when deterministic analysis runs, then a reply-only duplicate-handle warning/check is emitted or otherwise guarded.
- Given no `replyContext`, when deterministic analysis runs on text beginning `@alice`, then no reply-only stripping or duplicate-handle guard runs.

## Visual AC

N/A.

## Edge Cases

- Target text omitted or truncated.
- Missing account profile.
- Judge timeout or chain budget exhaustion.
- Apply never-worse guard returning original body.
- Model returns a leading target handle in generated or rewritten body.
- Prefix-only body.
- Multiple seeded target handles.

## Pipeline Log

- 2026-06-29: Ticket authored from approved arch recon.
- 2026-06-29: Started RGB-TDD implementation after RCC-001 and RCC-002 foundation approvals.
- 2026-06-29: Completed with Blue/Yellow re-validation after generated-body normalization and public judge adapter pass-through fixes.
