---
status: in-progress
---

# XOB-011: GenerateIdeasService — By-Format LLM Generation + Generate→Judge Refine

Implement `GenerateIdeasService` to replace the stub `defaultGenerateCandidates` for the `format` path in `POST /ideas/generate`. When a `format` is present in the request: generate 3 candidates in that format via `StructuredLlmService.generateStructured` (purpose: `writer_variants`), judge each via `JudgeDraftService.judge`, and attach `verdict` + `approved` per candidate. The idea-only path stays the existing `defaultGenerateCandidates` stub, unchanged.

## Implementation Details

### `GenerateIdeasService` (new — `engine/src/llm/generate-ideas-service.ts`)

Constructor-injected per the DI pattern (mirror `JudgeDraftService`):

```ts
class GenerateIdeasService {
  constructor(
    private readonly llm: StructuredLlmService,
    private readonly judge: JudgeDraft,
    private readonly resolveProvider: JudgeProviderResolver,
    private readonly resolveJudgeAccountProfile: () => Promise<string | undefined>,
    private readonly chainTimeoutMs?: number,   // defaults to 4 × 60_000 = 240_000 ms
  ) {}

  async generate(input: GenerateIdeaRequest): Promise<GenerateIdeaResponse>
}
```

**Format path** (`input.format` present):

1. Call `StructuredLlmService.generateStructured` with:
   - `provider`: resolved via `this.resolveProvider()`
   - `purpose: "writer_variants"` (existing enum value — no change to `llmPurposeSchema`)
   - `instructions`: a prompt instructing the model to produce exactly 3 draft posts in the given `detectedPostFormat` format, each in a distinct angle, Twitter-length, authentic voice
   - `structuredOutput.schema`: JSON Schema for `{ candidates: [{ id, text }] }` (3-item array); `additionalProperties: false`
   - `options.timeoutMs`: budget allocation from `chainTimeoutMs` (generation slice, e.g. `chainTimeoutMs / 4`)

2. For each of the 3 generated candidates, call `this.judge.judge(candidate.text, await this.resolveJudgeAccountProfile())` **in parallel** (`Promise.allSettled` — not `Promise.all`, so one judge failure does not block the others).

3. For each candidate:
   - If judge returned `status: "judged"` → attach `verdict: outcome.response.verdict`, `approved: deriveApproved(outcome.response.verdict)` (imported from `@x-builder/shared`)
   - If judge failed → return candidate **without** `verdict` or `approved` fields (generation already succeeded; overlay must not dead-end)

4. Return `{ candidates: [...] }` with exactly 3 entries. `generateIdeaResponseSchema.candidates.length(3)` is preserved.

**Idea-only path** (`input.format` absent, `input.idea` present): delegate immediately to `defaultGenerateCandidates` (unchanged stub behavior). No judge pass, no new fields. `GenerateIdeasService.generate` accepts the existing `GenerateCandidates` stub as a fallback in its constructor or calls it directly for the no-format branch.

**Timeout / budget:** the full chain touches up to 4 LLM calls (1 generate + 3 judges). A `chainTimeoutMs` constructor parameter (default `240_000` ms = 4 min) sets the budget. The generate call gets `chainTimeoutMs / 4`; each judge call gets `chainTimeoutMs / 4`. Calls that exceed their budget surface as `structured_output_invalid` or `request_timeout` from the LLM layer → judge failure → candidate returned without `verdict` (guard path). If the generate call itself times out → throw → route maps to `generation_failed`.

**`generation_failed` surface:** when `StructuredLlmService.generateStructured` returns `status: "failed"` (or throws), `GenerateIdeasService.generate` throws a typed error. The `/ideas/generate` route handler catches it and responds with `generation_failed`. LLM failure in individual judge passes does NOT produce `generation_failed` — only the generate step does.

### `generatedIdeaCandidateSchema` (additive extension — `shared/src/schemas/shell.ts`, owned by XOB-002)

XOB-002 adds:
```ts
verdict: judgeVerdictSchema.optional(),
approved: z.boolean().optional(),
```
This ticket only consumes those fields; it does not author the schema change.

### `generateIdeaRequestSchema` (additive extension — `shared/src/schemas/shell.ts`, owned by XOB-002)

XOB-002 adds:
```ts
idea: z.string().trim().min(1).max(4_000).optional(),
format: detectedPostFormatSchema.optional(),
```
plus `.refine(d => d.idea !== undefined || d.format !== undefined, ...)`. This ticket consumes the extended schema; does not author it.

### Wiring in `buildServer` (`engine/src/server/server.ts`)

Replace `defaultGenerateCandidates` injection with a `GenerateIdeasService` instance when `options.generateCandidates` is not overridden:

```ts
const generateCandidates: GenerateCandidates = options.generateCandidates
  ?? new GenerateIdeasService(
      new StructuredLlmService({ providers }),
      judgeDraftService,
      resolveProvider,
      () => resolveJudgeAccountProfile(undefined),
    ).generate.bind(generateIdeasService);
```

The `GenerateIdeasService.generate` method signature matches `GenerateCandidates` (accepts `GenerateIdeaRequest`, returns `Promise<GenerateIdeaResponse>`). The idea-only branch inside `generate` forwards to the inline stub.

### `deriveApproved` (in `@x-builder/shared` — authored by XOB-002)

Import `deriveApproved` from `@x-builder/shared`. Rule: `approved = verdict.scores.overall >= 70`. This ticket consumes it; does not define it.

## Data Models

`GenerateIdeaRequest` (XOB-002 extension): `{ idea?: string 1..4000, format?: detectedPostFormat }` with refinement requiring at least one.

`GenerateIdeaResponse` (unchanged shape, extended candidate):
```
candidates: Array<{
  id: string,
  format: "one-liner"|"mini-framework"|"debate-question",
  text: string,
  verdict?: JudgeVerdict,   // present when judge succeeded
  approved?: boolean,       // present when judge succeeded
}>.length(3)
```

## Integration Point

- `POST /ideas/generate` (path and method unchanged). Route handler in `engine/src/server/server.ts` at `app.post("/ideas/generate", ...)` — no route change, only the `generateCandidates` function changes.
- `__xbuilder_generateIdeas` binding (XOB-016) passes `GenerateIdeaRequest` and receives `GenerateIdeaResponse`; structured-clone-safe.
- `JudgeDraftService.judge` from XOB-010 (with span-annotations) provides the judge pass — same service, same `JudgeDraft` interface.
- `createSettingsJudgeProviderResolver` from `engine/src/llm/judge-provider-resolver.ts` resolves the provider per-call.
- `resolveJudgeAccountProfile` from `engine/src/server/server.ts` (existing internal helper) resolves the account profile.

## Scope Boundaries / Out of Scope

- Idea-only path (`idea` present, `format` absent) stays the `defaultGenerateCandidates` stub — no LLM call, no judge pass.
- The `generatedIdeaCandidateSchema.format` field (`one-liner|mini-framework|debate-question`) describes output rendering format, distinct from the input `detectedPostFormat`. The generation prompt maps `detectedPostFormat` to a content style; the candidate still carries its rendering format.
- No new `llmPurpose` enum value — `writer_variants` is reused.
- No changes to `GET /generate/categories` (XOB-006).
- No UI provenance pinning (XOB-023).
- `GenerateCategoryService` (XOB-006) is not in scope.
- Retry logic beyond `StructuredLlmService`'s built-in `attempts` is out of scope.

## Test Strategy & Fixture Ownership

**Framework:** Vitest (existing harness).

**Mock surface:**
- `StructuredLlmService` fake: inject a stub implementing `generateStructured` that returns a controlled `{ status: "success", output: { candidates: [...] } }` or `{ status: "failed" }`.
- `JudgeDraft` fake (same pattern as `judge-draft-service.test.ts`): returns controlled `JudgeDraftOutcome` per call, including selectable failure on specific candidate index.
- `buildServer().inject()` for route-level tests (mirror `engine/src/server/tests/posts-analyze.test.ts`).

**Test cases (own in `engine/src/llm/tests/generate-ideas-service.test.ts`):**

1. **Format path — all judges succeed:** fake LLM returns 3 candidates; all 3 judge fakes succeed. Assert response has 3 candidates each with `verdict` and `approved` present; `approved` equals `deriveApproved(verdict)`.
2. **Format path — one judge fails:** fake LLM returns 3 candidates; judge fake fails on candidate index 1. Assert response still has exactly 3 candidates; candidate 1 has no `verdict` and no `approved`; candidates 0 and 2 have both.
3. **Format path — generate fails:** fake LLM returns `status: "failed"`. Assert `generate()` throws; route returns `generation_failed` (route test below).
4. **Idea-only path:** input has `idea` but no `format`. Assert `StructuredLlmService.generateStructured` is NOT called; response matches `defaultGenerateCandidates` stub output.

**Route tests (own in `engine/src/server/tests/ideas-generate.test.ts`):**

5. **HTTP 200, format path:** `buildServer({ generateCandidates: fakeGenerateIdeasService })` → `inject POST /ideas/generate` with `{ format: "hot_take" }` → assert 200, `candidates.length === 3`.
6. **HTTP 500 generation_failed:** fake throws → assert response code 500 and error code `generation_failed`.

**Dependency category:** unit (service) + integration (route via `buildServer().inject()`). No disk I/O; no real LLM.

## Definition of Done

- `GenerateIdeasService` exists at `engine/src/llm/generate-ideas-service.ts`.
- Format path generates 3 candidates, judges each in parallel via `Promise.allSettled`, attaches `verdict`+`approved` or omits gracefully.
- Idea-only path delegates to the inline stub without any LLM call.
- Per-chain timeout/budget is defined (constructor param, default 240 s), generation gets `chainTimeoutMs/4`, each judge call gets `chainTimeoutMs/4`.
- `generation_failed` surfaces on generate-step failure; judge-step failures are silently graceful.
- `buildServer` wires `GenerateIdeasService` as the default `generateCandidates`.
- All new tests pass; existing `generate-candidates`-related tests pass.
- `pnpm typecheck` and `pnpm build` green.

## Acceptance Criteria

**Given** `generateIdeas({ format: "hot_take" })` with a working LLM fake and working judge fake:
**When** the service resolves:
**Then** response has exactly 3 candidates, each with `verdict` (non-null `JudgeVerdict`) and `approved` (boolean); `approved === (verdict.scores.overall >= 70)`.

**Given** `generateIdeas({ format: "founder_story" })` with judge failing on candidate index 1:
**When** the service resolves:
**Then** response has exactly 3 candidates; candidates[0] and candidates[2] have `verdict` and `approved`; candidates[1] has neither `verdict` nor `approved`.

**Given** `generateIdeas({ idea: "Why the best code is invisible" })` (no `format`):
**When** the service resolves:
**Then** `StructuredLlmService.generateStructured` is never called; response shape matches the stub; candidates have no `verdict` or `approved`.

**Given** the generate LLM call returns `status: "failed"`:
**When** `POST /ideas/generate` is called with `{ format: "hot_take" }`:
**Then** response is HTTP 500 with error code `generation_failed`.

## Edge Cases

- All 3 judge calls fail: response has 3 candidates, none with `verdict`/`approved`. Buttons remain active (never dead-end).
- LLM returns fewer than 3 candidates in the generation step: `structured_output_invalid` → treat as generate failure → `generation_failed`.
- `format` present AND `idea` present: format path takes precedence (the generate prompt may incorporate the idea as a seed topic).
- `resolveJudgeAccountProfile` throws: catch → pass `undefined` to judge (profile-less), do not fail the candidate.
- Per-chain timeout reached mid-judge: outstanding `Promise.allSettled` legs return rejected; affected candidates drop `verdict`/`approved`. Generation already succeeded.
- `deriveApproved` agreement: verify the computed `approved` on each candidate is consistent with the candidate's `verdict.verdict` band (`post_now`/`slight_rework` → true; others → false).
