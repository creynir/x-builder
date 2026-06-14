---
status: done
---

# RMU-010: Advanced Phase-0 context inputs + client model

## Implementation Details

Add the optional Phase-0 inputs to the writer studio without touching the existing
`followers` field, and establish the client model fields the two-pass flow (RMU-013) builds on.

1. **`WriterPageModel` additions** (`writer-workflow.ts`): `advancedContext: AdvancedContext`
   and `refinement: RefinementState`. `createInitialModel()` sets `advancedContext: {}` and
   `refinement: { status: "idle" }`. (The `refinement` runner itself is RMU-013; this ticket
   only declares the field + idle default so the model shape is stable.)
   ```ts
   type AdvancedContext = {
     trailingMedianImpressions?: number;
     repeatHistory?: { similarInLast7Days: boolean; date?: string };
     plannedHourUtc?: number;
     willAttachMedia?: boolean;
     accountAgeYears?: number;
   };
   type RefinementState =
     | { status: "idle" } | { status: "running"; requestId: number }
     | { status: "refined"; requestId: number } | { status: "skipped" };
   ```
2. **`applyAdvancedContextChange(model, patch)`** — pure reducer: merge patch, call
   `markAnalysisStale` (so the existing 500ms debounce re-scores), reset `refinement → idle`.
3. **`candidateAnalysisRequest`** — spread validated `advancedContext` values into
   `scoringContext` (omit empty/undefined fields). The existing `followers` argument is
   unchanged. Map the fallback `repeatHistory` UI value to the schema shape: when
   `similarInLast7Days` is true, emit one `repeatHistory` entry for the draft's detected
   format with `countLast7d: 1` and `lastPostedAt` = the chosen date (or now); when false,
   omit `repeatHistory`.
4. **`AdvancedContextPanel`** — a collapsed-by-default `<details>` section mounted in
   `WriterPageView` immediately after `ManualScoringContextPanel`. Fields: `trailingMedianImpressions`
   (number `Input`, helper "Median views of your last 20 original posts — exclude pinned and
   RTs. Find in X Analytics."), `RepeatHistoryControl`, `plannedHourUtc` (number `Input`,
   helper "0–23 UTC", validates int 0–23; out-of-range → inline field error, value not
   committed), `willAttachMedia` (`Switch` from RMU-003), `accountAgeYears` (number `Input`).
   Disclosure open/closed is local `useState`.
5. **`RepeatHistoryControl`** — checkbox "I posted something similar in the last 7 days" +
   an optional `type="date"` input revealed only when checked. Unchecking clears the date.
6. Wire `onAdvancedContextChange` through `WriterPage` and `createWriterPagePublicDriver`.

## Data Models

`AdvancedContext`, `RefinementState`. CONSUMES the extended `scoringContext` (RMU-001):
`trailingMedianImpressions`, `repeatHistory`, `plannedHourUtc`, `willAttachMedia`,
`accountAgeYears`. Producer: RMU-001.

## Integration Point

Mounted by `WriterPageView` after `ManualScoringContextPanel`. User entry: expand "Advanced
context (optional)" in the Studio. Terminal outcome: the optional fields flow into
`/posts/analyze` via the debounce and shift the reach estimate.

## Scope Boundaries / Out of Scope

Writer model + the two new panels only. `followers` UI/logic unchanged. Zero-trace: no
regime rendering (RMU-011), no two-pass runner (RMU-013 — only the idle `refinement` field
is declared here), no auto-compute of repeat history (engine concern; no client stub).

## Test Strategy & Fixture Ownership

Component + reducer unit. Owning suite: `client/src/features/writer/tests` + a workflow unit
suite. Fixture: extend the mock `WriterApiClient`; a `buildAnalyzeResponse()` builder
(test-owned, shared with RMU-011/013). Engine API = remote-owned (schema-shaped mock).
In-process SSR via `createWriterPagePublicDriver`.

## Definition of Done

Panel renders collapsed; fields commit to `advancedContext`; analyze request carries the new
`scoringContext` keys; `followers` unaffected; `pnpm test` + `pnpm typecheck` + `pnpm lint` green.

## Acceptance Criteria

- Given a draft, When the user expands "Advanced context" and enters `plannedHourUtc=20`, Then the next `analyzePosts` request has `scoringContext.plannedHourUtc === 20`.
- Given `plannedHourUtc=25`, When entered, Then an inline field error shows and the value is not sent.
- Given followers is set, When advanced fields change, Then `followers` stays in the request unchanged and analysis is marked stale (re-scores).
- Given "posted something similar" is checked then unchecked, When committed, Then `repeatHistory` is omitted from the request.
- Given all advanced fields empty, Then `scoringContext` omits them.

## Visual AC

`<details>` collapsed by default, `--type-label` summary "Advanced context (optional)";
fields use foundation `Input` + `Switch`; exact helper copy for trailing-median; stale
affordance reuses `ManualScoringContextPanel`'s "Prediction needs refresh."; focus ring via
`--focus-ring-*`; `<details>`/`<summary>` keyboard-operable.

## Edge Cases

Trailing-median present + followers empty must still yield an available prediction (engine
guard fixed in RMU-006); the panel must not gate the prediction on advanced fields.
Whitespace-only date ignored.

## Pipeline Log

- 2026-06-14 — **Done.** Standard pipeline: Red (`4988527`) model fields + reducer + panel/control + analyze-wiring tests + shared `buildAnalyzeResponse()` builder (C2 honored — no settings label class asserted on the panel Switch) → Blue Validate Red APPROVE → Green (`5db700f`) `AdvancedContext`/`RefinementState` + `applyAdvancedContextChange` (+ exported `markAnalysisStale`) + `AdvancedContextPanel`/`RepeatHistoryControl` mounted after `ManualScoringContextPanel` + `candidateAnalysisRequest` per-field `scoringContextSchema.shape[key]` validation (out-of-range dropped) + repeatHistory mapping + `updateAdvancedContext` driver wiring → Blue (Validate Green) + Yellow both APPROVE. Client 202 / engine 508 green, typecheck 5/5, lint + ui-tokens clean.
- **Concern C2 RESOLVED here:** added optional `labelClassName?` to foundation `Switch` (defaults to `xb-settings-route__switch-label` → RMU-003 settings pins byte-stable; the advanced panel passes writer-scoped classes). The RMU-003 forward-note is closed.
- `refinement` is idle-only (the two-pass runner is RMU-013); `followers` UI/logic unchanged; re-score reached via the existing debounce-on-stale effect.
- **Concern C9 (epic-close triage, Amber):** RMU-010's Integration Point prose says the advanced fields "shift the reach estimate," but `plannedHourUtc`/`willAttachMedia`/`accountAgeYears` are collected + sent yet have no engine consumer today (only `trailingMedianImpressions` + `repeatHistory` move the estimate) — a documented "optional-until-producer" deferral. The user-facing how-to (`estimate-post-reach.md`) was corrected (C9a) to label those three "recorded but do not change today's estimate"; adding the engine producers is tracked as follow-up **RMU-022** (C9b).
