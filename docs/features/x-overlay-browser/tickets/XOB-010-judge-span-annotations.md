---
status: todo
---

# XOB-010: Judge Span-Annotations

Extend `JudgeDraftService` to emit span-level `annotations` alongside the existing aggregate scores, headline, strengths, and improvements. The overlay uses these to render blue highlights over exact quoted substrings in the composer (`CompositionHighlightLayer`). The `ApplyJudgeSuggestionsService` (XOB-012) reads the same annotations as rewrite instructions.

## Implementation Details

### `judgeAnnotationSchema` (already defined in `@x-builder/shared` by XOB-002)

Located in `shared/src/schemas/judge.ts`. Shape: `{ quote: z.string().min(1).max(280), severity: z.enum(["suggestion","warning"]), recommendation: z.string().min(1).max(240) }`. XOB-002 is the schema owner; this ticket consumes it.

### `judgeVerdictSchema` (additive extension — `shared/src/schemas/judge.ts`)

Add `annotations: z.array(judgeAnnotationSchema).max(12).default([])` to the existing `judgeVerdictSchema` object. The `.default([])` means every existing call site that parses a verdict without annotations gets `[]` automatically — zero breakage.

### `judgeInstructions` (prompt string — `engine/src/llm/judge-draft-service.ts`)

The constant `judgeInstructions` is a joined string array ending with `"Return only JSON matching the output schema."`. Append one additional instruction sentence before the final `"Return only JSON matching the output schema."`:

> Also emit an `annotations` array (up to 12 items) of `{ quote, severity, recommendation }` where `quote` is an **exact substring** of the draft (copy the words verbatim), `severity` is `suggestion` or `warning`, and `recommendation` is a one-line fix. Omit `annotations` entirely if you have none.

The `quote` must be a verbatim substring — no offsets, no character positions. The overlay locates the match via string search; unreliable LLM offsets are intentionally excluded.

### `verdictOutputSchema` (JSON Schema object — `engine/src/llm/judge-draft-service.ts`)

The `verdictOutputSchema` constant has `additionalProperties: false` and a `required` array. Add `annotations` as an **optional** (not in `required`) property:

```json
"annotations": {
  "type": "array",
  "maxItems": 12,
  "items": {
    "type": "object",
    "additionalProperties": false,
    "required": ["quote", "severity", "recommendation"],
    "properties": {
      "quote":          { "type": "string", "minLength": 1, "maxLength": 280 },
      "severity":       { "type": "string", "enum": ["suggestion", "warning"] },
      "recommendation": { "type": "string", "minLength": 1, "maxLength": 240 }
    }
  }
}
```

The property is optional at the model layer so a model that omits the field entirely still parses. `toVerdict` handles the default.

### `judgeModelOutputSchema` (`engine/src/llm/judge-draft-service.ts`)

`judgeModelOutputSchema` is defined as `judgeVerdictSchema.omit({ verdict: true })`. Because `judgeVerdictSchema` now carries `annotations` with `.default([])`, the omitted schema also gains `annotations` automatically. No change needed.

### `toVerdict` (`engine/src/llm/judge-draft-service.ts`)

`toVerdict` calls `judgeModelOutputSchema.parse(value)` then spreads the result plus the derived `verdict`. After the XOB-002 `judgeVerdictSchema` extension adds `.default([])`, `judgeModelOutputSchema.parse` already fills `annotations: []` when the model omits it. The spread into the return value carries it through. No additional code change required beyond verifying the spread is complete.

## Data Models

`judgeAnnotationSchema` — in `shared/src/schemas/judge.ts` (defined by XOB-002, consumed here):
```
{ quote: string 1..280, severity: "suggestion"|"warning", recommendation: string 1..240 }
```

`judgeVerdictSchema` — additive extension (this ticket):
```
annotations: judgeAnnotation[] max 12, default []
```

`JudgeVerdict` type is re-exported from `judgeVerdictSchema`; no separate type alias needed.

## Integration Point

- `POST /drafts/judge` — route in `engine/src/server/server.ts` unchanged. The response's `verdict` object now includes `annotations` when the model emits any. Existing callers receive `annotations: []` by default (additive, zero-trace).
- `__xbuilder_judgeDraft` binding (XOB-016) round-trips `JudgeDraftResponse`; structured-clone-safe (plain arrays/objects/strings).
- `ApplyJudgeSuggestionsService` (XOB-012) reads `verdict.annotations` as rewrite instructions alongside `verdict.improvements`.
- `CompositionHighlightLayer` (XOB-022 overlay) locates each `quote` via `String.prototype.indexOf` and renders a blue highlight (`hsl(205 96% 62%)`).

## Scope Boundaries / Out of Scope

- No character offsets or byte positions. The LLM emits only the verbatim quoted substring; the overlay does the search.
- No changes to `JudgeDraftService.judge` signature or the `JudgeDraft` interface.
- No changes to any route path, request schema, or HTTP status code.
- No changes to the `candidate_judge` `llmPurpose` value.
- No `verdictOutputSchema` property promotion to `required` — optional at model layer, defaulted at Zod layer.
- Overlay highlight rendering is out of scope (XOB-022/027).
- `ApplyJudgeSuggestionsService` rewrite logic is out of scope (XOB-012).

## Test Strategy & Fixture Ownership

**Framework:** Vitest (existing harness in `engine/src/llm/tests/`).

**Mock surface:** `JudgeLlmGateway` fake — the existing `judge-draft-service.test.ts` pattern. Construct a `JudgeDraftService` with an injected `JudgeLlmGateway` stub; no `ProcessRunner`, no child process.

**Test cases (own these in `engine/src/llm/tests/judge-draft-service.test.ts`):**

1. **LLM emits annotations** — fake returns a valid model output including `annotations: [{ quote: "exact phrase", severity: "warning", recommendation: "be more specific" }]`. Assert `verdict.annotations` has length 1; `annotations[0].quote` equals `"exact phrase"`; `annotations[0].severity` equals `"warning"`; `annotations[0].recommendation` is present.
2. **LLM omits annotations** — fake returns a model output with no `annotations` key. Assert `verdict.annotations` is `[]` (default applied by Zod).
3. **Aggregate scores unaffected** — assert `verdict.scores.overall`, `verdict.verdict`, `verdict.headline` are unchanged whether annotations are present or absent. Run a before/after comparison with the same score payload.
4. **Schema round-trip** — parse a `judgeVerdictSchema` object containing annotations → verify it round-trips; parse one without → `annotations` coerces to `[]`.

**Route tests (existing `engine/src/server/tests/drafts-judge.test.ts`):** add one case verifying the HTTP response body carries `verdict.annotations: []` when the injected `JudgeDraftService` fake returns a verdict with an empty annotations array.

**Dependency category:** unit (engine/llm layer); isolated to `judge-draft-service.ts` and `shared/src/schemas/judge.ts`. No disk I/O.

## Definition of Done

- `judgeVerdictSchema` has `annotations: z.array(judgeAnnotationSchema).max(12).default([])`.
- `verdictOutputSchema` carries the `annotations` property definition (optional, not in `required`).
- `judgeInstructions` string instructs the model to emit exact-substring `annotations`.
- `toVerdict` correctly propagates the defaulted `annotations` field.
- All existing `judge-draft-service.test.ts` cases pass unchanged.
- New annotation test cases pass.
- `pnpm typecheck` and `pnpm build` green.

## Acceptance Criteria

**Given** a draft containing the phrase "guaranteed results":
**When** the injected LLM fake returns `annotations: [{ quote: "guaranteed results", severity: "warning", recommendation: "remove the unsupported absolute" }]`:
**Then** `verdict.annotations[0].quote` equals `"guaranteed results"`, `.severity` equals `"warning"`, `.recommendation` is non-empty.

**Given** a fake LLM that returns a model output with no `annotations` field:
**When** `JudgeDraftService.judge(text)` resolves:
**Then** `verdict.annotations` is `[]` (not undefined, not null).

**Given** a verdict with annotations present:
**When** inspecting `verdict.scores.overall` and `verdict.verdict`:
**Then** both are identical to what they would be on an equivalent run with annotations absent — annotations do not affect aggregate scoring.

**Given** an existing test fixture that parses a `judgeVerdictSchema` value without an `annotations` key:
**When** parsed:
**Then** `annotations` coerces to `[]` and the parse succeeds (additive, not breaking).

## Edge Cases

- Model emits `annotations: null` — `judgeModelOutputSchema.parse` with `.default([])` coerces null to `[]`.
- Model emits more than 12 annotations — `verdictOutputSchema` `maxItems:12` and `z.array(...).max(12)` both reject/truncate; treat as `structured_output_invalid`, `toVerdict` never sees it.
- `quote` is longer than 280 chars — rejected at schema level in `verdictOutputSchema`; `structured_output_invalid` failure path.
- `quote` is an exact substring appearing multiple times in the draft — overlay rule (XOB-027): highlight the first match. Engine does not deduplicate.
- Same quote appears in multiple annotation entries — overlay consumes them left-to-right. Engine emits them as the model provided; no deduplication here.
- `accountProfile` present alongside annotations — orthogonal; the `accountProfileInstruction` suffix is appended after `judgeInstructions` as before; annotations instruction is part of the base `judgeInstructions` and always applies.
