---
status: done
---

# XOB-012: ApplyJudgeSuggestionsService + POST /drafts/apply-suggestions

Implement `ApplyJudgeSuggestionsService`, the `POST /drafts/apply-suggestions` HTTP route, and the `__xbuilder_applyJudgeSuggestions` `EngineTransport` binding. The service judges the original draft, rewrites it applying the judge's `annotations` and `improvements`, re-judges the rewrite, and enforces a never-worse guard: if the rewrite scores no better than the original it returns the original unchanged.

## Implementation Details

### `ApplyJudgeSuggestionsService` (new — `engine/src/llm/apply-judge-suggestions-service.ts`)

Constructor-injected per the DI pattern (mirror `JudgeDraftService`):

```ts
class ApplyJudgeSuggestionsService {
  constructor(
    private readonly judge: JudgeDraft,
    private readonly llm: StructuredLlmService,
    private readonly resolveProvider: JudgeProviderResolver,
    private readonly resolveJudgeAccountProfile: () => Promise<string | undefined>,
    private readonly chainTimeoutMs?: number, // default 3 × 60_000 = 180_000 ms
  ) {}

  async apply(request: ApplyJudgeSuggestionsRequest): Promise<ApplyJudgeSuggestionsResponse>
}
```

**Flow (3 LLM calls in series):**

**Step 1 — judge original:**
Call `this.judge.judge(request.text, await this.resolveJudgeAccountProfile())`.
- If result is `status: "failed"` → throw a typed error → route maps to `generation_failed`.
- If result is `status: "judged"` → capture `originalVerdict = result.response.verdict`, `originalOverall = originalVerdict.scores.overall`.

Timeout budget for step 1: `chainTimeoutMs / 3`.

**Step 2 — rewrite:**
Call `this.llm.generateStructured` with:
- `provider`: resolved via `this.resolveProvider()`
- `purpose: "writer_first_pass"` (existing enum value)
- `instructions`: a system prompt that:
  1. Lists each entry in `originalVerdict.annotations` as a specific span-level fix: `"Fix: [quote] — [recommendation]"` (up to 12)
  2. Lists each entry in `originalVerdict.improvements` as a structural improvement (up to 5)
  3. Instructs the model to preserve the author's voice, keep to the same general topic and length, and apply every fix
- `turns: [{ role: "user", content: request.text }]`
- `structuredOutput.schema`: `{ type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", minLength: 1, maxLength: 8000 } } }`
- `structuredOutput.parser`: extracts `output.text`
- `options.timeoutMs`: `chainTimeoutMs / 3`

If `generateStructured` returns `status: "failed"` → throw → route maps to `generation_failed`.

Capture `rewrittenText = result.output`.

**Step 3 — re-judge rewrite:**
Call `this.judge.judge(rewrittenText, await this.resolveJudgeAccountProfile())`.
- If result is `status: "failed"` → throw → route maps to `generation_failed`.
- Capture `rewriteVerdict = result.response.verdict`, `rewriteOverall = rewriteVerdict.scores.overall`.

**Never-worse guard (maintainer-mandated):**
```
if (rewriteOverall <= originalOverall) {
  return {
    text: request.text,          // ORIGINAL text
    verdict: originalVerdict,    // verdict of the original
    approved: deriveApproved(originalVerdict),
    improvedOverOriginal: false,
  };
}
return {
  text: rewrittenText,
  verdict: rewriteVerdict,
  approved: deriveApproved(rewriteVerdict),
  improvedOverOriginal: true,
};
```

The guard is strictly `<=`: a rewrite that scores identically to the original returns the original.

**Timeout / budget:** `chainTimeoutMs` (default 180 000 ms = 3 min) is distributed as `chainTimeoutMs / 3` per step. All three steps are sequential (each step depends on the prior). If any step times out, `StructuredLlmService` surfaces it as `request_timeout` → `status: "failed"` → throw → `generation_failed`.

### `applyJudgeSuggestionsRequestSchema` (in `@x-builder/shared` — authored by XOB-002)

Shape: `{ text: z.string().trim().min(1).max(8_000) }`. This ticket consumes it; does not author it.

### `applyJudgeSuggestionsResponseSchema` (in `@x-builder/shared` — authored by XOB-002)

Shape:
```
{
  text: z.string().min(1).max(8_000),
  verdict: judgeVerdictSchema,
  approved: z.boolean(),
  improvedOverOriginal: z.boolean(),
}
```
This ticket consumes it; does not author it.

### `POST /drafts/apply-suggestions` route (`engine/src/server/server.ts`)

Add after the existing `/drafts/judge` handler:

```ts
app.post("/drafts/apply-suggestions", async (request, reply) => {
  const input = applyJudgeSuggestionsRequestSchema.parse(request.body);
  try {
    const result = await applyJudgeSuggestionsService.apply(input);
    return reply.send(parseResponseContract(applyJudgeSuggestionsResponseSchema, result));
  } catch {
    throw new NormalizedApiError(generationError());
  }
});
```

`applyJudgeSuggestionsService` is constructed in `buildServer` following the same pattern as `judgeDraftService`:

```ts
const applyJudgeSuggestionsService =
  options.applyJudgeSuggestionsService ??
  new ApplyJudgeSuggestionsService(
    judgeDraftService,
    new StructuredLlmService({ providers }),
    resolveProvider,
    () => resolveJudgeAccountProfile(undefined),
  );
```

Add `applyJudgeSuggestionsService?: ApplyJudgeSuggestionsService` to `BuildServerOptions`.

### `__xbuilder_applyJudgeSuggestions` binding (XOB-016)

`ExposeFunctionTransport.bindAll` registers this binding pointing to `applyJudgeSuggestionsService.apply`. Binding name follows the `__xbuilder_<method>` convention from `EngineTransport` (method #17 in the 17-method interface). This ticket defines the service; XOB-016 registers the binding.

### `deriveApproved` (imported from `@x-builder/shared`, authored by XOB-002)

Used in the never-worse guard and the success path. Rule: `approved = verdict.scores.overall >= 70`.

## Data Models

`ApplyJudgeSuggestionsRequest`: `{ text: string 1..8000 }` (trimmed).

`ApplyJudgeSuggestionsResponse`:
```
{
  text: string 1..8000,           // rewrittenText OR original
  verdict: JudgeVerdict,          // verdict of RETURNED text
  approved: boolean,              // deriveApproved(verdict)
  improvedOverOriginal: boolean,  // true only if rewrite overall > original overall
}
```

## Integration Point

- `POST /drafts/apply-suggestions` — new route in `engine/src/server/server.ts`.
- `__xbuilder_applyJudgeSuggestions` — `EngineTransport` method #17; registered by XOB-016.
- `JudgeDraftService.judge` (XOB-010 with span-annotations) provides both the initial judge and the re-judge.
- `StructuredLlmService.generateStructured` (`purpose: "writer_first_pass"`) provides the rewrite.
- `createSettingsJudgeProviderResolver` resolves the provider per-call.
- `deriveApproved` from `@x-builder/shared` (XOB-002) computes `approved`.
- Overlay `JudgeStrip` (XOB-027) calls this binding on "Apply all suggestions" click; receives `{ text, verdict, approved, improvedOverOriginal }` and re-pins the provenance anchor if `improvedOverOriginal: true`.

## Scope Boundaries / Out of Scope

- No streaming; the route is request/response.
- No partial application (apply only selected annotations) — all annotations and all improvements are rewrite instructions in one pass.
- No automatic retry beyond `StructuredLlmService`'s built-in `attempts`.
- Edit-while-applying cancellation is a UI concern (XOB-027) — this service is stateless, no cancellation token needed at the service layer.
- Provenance anchor management (ProvenanceController) is overlay-side (XOB-023/027), not in this service.
- The rewrite LLM prompt authoring is internal to `ApplyJudgeSuggestionsService`; no shared prompt template needed.
- No new `llmPurpose` enum value — `writer_first_pass` is reused.

## Test Strategy & Fixture Ownership

**Framework:** Vitest (existing harness).

**Mock surface:**
- `JudgeDraft` fake (same interface as in `judge-draft-service.test.ts`): configurable per call — accepts a map of `callIndex → JudgeDraftOutcome` so step 1 and step 3 return different scores.
- `StructuredLlmService` fake: inject a stub that returns a controlled `{ status: "success", output: "rewritten text" }` or `{ status: "failed" }`.
- `buildServer().inject()` for route-level tests (mirror `engine/src/server/tests/drafts-judge.test.ts`).

**Test cases (own in `engine/src/llm/tests/apply-judge-suggestions-service.test.ts`):**

1. **Rewrite improves:** judge fake returns originalOverall 60 on step 1, rewriteOverall 75 on step 3; LLM fake returns rewritten text. Assert `result.text === rewrittenText`, `result.improvedOverOriginal === true`, `result.approved === true` (75 ≥ 70), `result.verdict === rewriteVerdict`.

2. **Rewrite equal — never-worse guard (equal score):** judge fake returns originalOverall 72 on step 1, rewriteOverall 72 on step 3. Assert `result.text === original`, `result.improvedOverOriginal === false`, `result.verdict === originalVerdict`.

3. **Rewrite worse — never-worse guard:** judge fake returns originalOverall 80 on step 1, rewriteOverall 65 on step 3. Assert `result.text === original`, `result.improvedOverOriginal === false`, `result.approved === true` (original overall 80 ≥ 70).

4. **Initial judge fails:** judge fake fails on step 1. Assert `apply()` throws; route returns `generation_failed`.

5. **Rewrite LLM fails:** step 1 judge succeeds; LLM fake returns `status: "failed"`. Assert `apply()` throws; route returns `generation_failed`.

6. **Re-judge fails (step 3):** step 1 and step 2 succeed; judge fake fails on step 3. Assert `apply()` throws; route returns `generation_failed`.

7. **Annotations fed into rewrite instructions:** capture the `instructions` string passed to `llm.generateStructured`. Assert it contains each `quote` and `recommendation` from the fake verdict's annotations.

**Route tests (own in `engine/src/server/tests/drafts-apply-suggestions.test.ts`):**

8. **HTTP 200, improved:** `buildServer({ applyJudgeSuggestionsService: fakeImproved })` → assert 200, `improvedOverOriginal: true`, `text !== original`.
9. **HTTP 200, never-worse guard:** `buildServer({ applyJudgeSuggestionsService: fakeNotImproved })` → assert 200, `improvedOverOriginal: false`, `text === original`.
10. **HTTP 500 generation_failed:** fake throws → assert 500, error code `generation_failed`.

**Dependency category:** unit (service) + integration (route via `buildServer().inject()`). No disk I/O; no real LLM; no child process.

**Isolation:** `ApplyJudgeSuggestionsService` is instantiated directly in tests with fakes; no real `JudgeDraftService` or `StructuredLlmService` is involved.

## Definition of Done

- `ApplyJudgeSuggestionsService` exists at `engine/src/llm/apply-judge-suggestions-service.ts`.
- Three-step flow (judge → rewrite → re-judge) implemented in series.
- Never-worse guard enforces `<=` comparison: rewrite overall must strictly exceed original to be accepted.
- Per-chain timeout budget stated (default 180 s, `chainTimeoutMs / 3` per step).
- `generation_failed` on any step failure.
- `POST /drafts/apply-suggestions` route registered in `buildServer`.
- `BuildServerOptions` accepts `applyJudgeSuggestionsService` override for tests.
- All new tests pass; existing drafts-judge tests unaffected.
- `pnpm typecheck` and `pnpm build` green.

## Acceptance Criteria

**Given** a draft where rewrite scores higher than original (e.g. original overall 55, rewrite overall 78):
**When** `POST /drafts/apply-suggestions` resolves:
**Then** `text` equals the rewritten text, `improvedOverOriginal` is `true`, `approved` is `true` (78 ≥ 70), `verdict` is the re-judge verdict of the rewritten text.

**Given** a draft where rewrite scores equal to original (both overall 70):
**When** `POST /drafts/apply-suggestions` resolves:
**Then** `text` equals the ORIGINAL text, `improvedOverOriginal` is `false`, `verdict` is the verdict of the original.

**Given** a draft where rewrite scores lower than original (original overall 80, rewrite overall 65):
**When** `POST /drafts/apply-suggestions` resolves:
**Then** `text` equals the ORIGINAL text, `improvedOverOriginal` is `false`, `approved` is `true` (original 80 ≥ 70).

**Given** the rewrite LLM call fails (`status: "failed"`):
**When** `POST /drafts/apply-suggestions` is called:
**Then** response is HTTP 500 with error code `generation_failed`.

**Given** the initial judge call fails:
**When** `POST /drafts/apply-suggestions` is called:
**Then** response is HTTP 500 with error code `generation_failed`.

## Edge Cases

- Original text has no `annotations` and no `improvements` in the verdict: the rewrite LLM receives empty instruction lists; it may still improve the draft using its own judgment. Never-worse guard still applies.
- `chainTimeoutMs / 3` rounding: use `Math.floor`; do not exceed `chainTimeoutMs` total.
- `resolveJudgeAccountProfile` throws in step 1 or step 3: catch internally, pass `undefined` to `judge.judge`, do not fail the whole chain.
- Rewrite produces text identical to original: `rewriteOverall <= originalOverall` is possible; guard returns original — both texts are the same so the response is semantically correct.
- `text` in request is at max length (8 000 chars): schema accepts it; LLM may truncate the rewrite; `structuredOutput` schema enforces `maxLength: 8000` on the output.
- `improvedOverOriginal: false` with `approved: false` (original overall < 70): valid combination — the service returns the best available text (original) and a correct `approved` derived from it.

## Pipeline Log

Lean Red-first lane. (One Blue dispatch returned a malformed/injected 0-tool-use response — disregarded as corrupted tool output, not acted on; Blue re-spawned and ran the real validation.)

- **Red** (`e4affb2`): `apply-judge-suggestions-service.test.ts` (8: improves/equal/worse never-worse cases, step1/2/3 failures, annotations→instructions spy, profile-resolver-throw edge) + `drafts-apply-suggestions.test.ts` (3 route: 200 improved, 200 never-worse, 500 generation_failed). Per-call judge fake (call-index keyed) + LLM spy reading `instructions`; verdicts via `verdictWithOverall(n)`. RED via missing module + 3×404; `rg "XOB-"` clean.
- **Gates** (post-Red, base `a8b1307`): `[scope]` + `[ticket-ids]` CLEAN.
- **Green** (`909cfa7`): `ApplyJudgeSuggestionsService` (judge→rewrite(`writer_first_pass`, `timeoutMs=chainTimeoutMs/3`)→re-judge; never-worse `<=` guard returns original on tie/worse; `rewriteInstructions` embeds `Fix: [quote] — [recommendation]` ×≤12 + `Improvement:` ×≤5; profile-safe; `deriveApproved` on returned verdict) + `POST /drafts/apply-suggestions` route (parses request before try; throw→`generation_failed`) + `BuildServerOptions.applyJudgeSuggestionsService?` + default construction sharing `judgeDraftService`/resolvers. 8/3/702 tests, typecheck+build green. 2 files.
- **Gates** (post-Green, base `e4affb2`): all CLEAN; no test files touched.
- **Blue (Validate Green)**: APPROVE — ran all commands (8/3/702, cache-bypassed `tsc` EXIT 0, forced clean build green); never-worse `<=` exact, request parsed before try (bad body → validation, not generation_failed), instructions embed annotations+improvements, profile-safe, typecheck honest.
- **Yellow (intent)**: APPROVE — real 3-step chain with the SAME judge instance as `/drafts/judge`, never-worse guard honest (`improvedOverOriginal` set only on `>`), method-#17 contract, loop-prevention boundary intact (stateless text-in/out; the "user-text-only" gate is correctly overlay-side), zero-trace.

### Concerns Ledger
- **Per-judge chain budget not enforced (consistent with XOB-011 ledger).** Only the rewrite step gets `chainTimeoutMs/3`; the two judge legs are best-effort, bounded by `JudgeDraftService`'s internal cap (no per-judge `timeoutMs` because `JudgeDraft.judge` takes no options and the scope forbids changing it). Same accepted pattern as XOB-011 — revisit jointly if chain-level cancellation is added (relates to the XOB-027 edit-while-applying-cancellation P2).
- **Doc note (no action):** ticket prose restates `deriveApproved` as `overall>=70`; the shared single-source is label-based (`post_now`/`slight_rework`) — equivalent; AC examples still hold. Consumed-only here (XOB-002-owned).
- Status → **done**.
