# LJ-002: [BE] Engine Judge Service And Route

## Goal

Turn a pasted draft into a structured verdict by calling the codex adapter, and
expose it at `POST /drafts/judge` with safe, structured failure handling.

## Context

- `StructuredLlmService` + `CodexCliProvider` exist but are not instantiated
  anywhere. This ticket wires them at startup and adds the first real consumer.
- The provider must be injectable so tests use a fake (no child process, no codex).

## In Scope

- `engine/src/llm/judge-draft-service.ts`: a `JudgeDraftService` that
  - builds `instructions` (judge system prompt) and `turns` (the draft as a user turn),
  - declares a `StructuredOutputContract` whose `schema` is a JSON Schema for the
    verdict and whose `parser` is `judgeVerdictSchema.parse`,
  - calls `structuredLlmService.generateStructured({ provider: "codex-cli", purpose: "candidate_judge", ... })`,
  - returns a `JudgeDraftResponse` on success or a mapped failure descriptor.
- Wire a `StructuredLlmService` with a `CodexCliProvider` (startup-resolved
  workspace root + `NodeProcessRunner`) in `buildServer`, injectable via options.
- Route `POST /drafts/judge` in `engine/src/server/server.ts`: validate request
  with `judgeDraftRequestSchema`; on success send the verdict; on failure throw a
  normalized `judge_failed` apiError. Validate the response with
  `judgeDraftResponseSchema` via the existing `parseResponseContract` helper.
- Map adapter failure codes to `judge_failed` with an appropriate `retryable`
  flag (timeout/unavailable retryable; structured_output_invalid/unsafe not).

## Out Of Scope

- Client work.
- Auto-run after generation.
- Feeding `aiRating` into the deterministic prediction.
- Streaming or partial output.

## Requirements

- Request validation failures propagate as `validation_failed` (400) via the
  global handler (parse outside the try, matching existing routes).
- The service must never throw for expected adapter failures; the route maps them
  to `judge_failed`.
- No draft text, prompt, raw stdout, or stderr may appear in the error response
  (the adapter already strips stdout/stderr; the route must not add them back).
- `model` in the response reflects the provider id/label (e.g. `codex-cli`).
- The judge provider/service is injectable through `buildServer` options for tests.

## Integration Point

- Producer: `POST /drafts/judge`.
- Consumer: client api client (LJ-003).
- User entry point: the route; reached from the writer "Judge draft" button later.
- Terminal outcome: a `judged` verdict (200) or `judge_failed` apiError (5xx).

## Acceptance Criteria

- Given a valid draft and a fake provider returning a valid verdict, the route
  returns 200 with a schema-valid `judged` response.
- Given a fake provider that fails (e.g. `provider_unavailable`), the route returns
  a `judge_failed` apiError with `retryable: true` and no draft/stderr leakage.
- Given a provider returning structured output that violates the verdict schema,
  the route returns `judge_failed` (non-retryable) — surfaced via the adapter's
  `structured_output_invalid`.
- Given an empty draft body, the route returns `validation_failed` (400).
- The `JudgeDraftService` resolves (never throws) for all expected failures.

## Test Strategy

- Suite: engine Vitest. Inject a fake `StructuredLlmService`/provider through
  `buildServer` options; assert route status codes, error codes, and no-leak.
- A unit test for `JudgeDraftService` covering success + each failure mapping.
- Dependency category: in-process fakes only; no child process, no codex.

## Dependencies

- LJ-001 (shared contract).
- Existing `StructuredLlmService`, `CodexCliProvider`, `NodeProcessRunner`,
  `resolveWorkspaceRoot`, and the route error-normalization helpers.
