# LLM Judge Tickets

These are local ticket specs for the LLM-as-judge MVP. They are not Linear issues.
Scope decisions are locked in [../spec/llm-judge-mvp.md](../spec/llm-judge-mvp.md):
single pasted draft · standalone verdict panel · on-demand button.

## Build Order

1. [LJ-001 - Shared Judge Contract](./LJ-001-shared-judge-contract.md)
2. [LJ-002 - Engine Judge Service And Route](./LJ-002-engine-judge-service-and-route.md)
3. [LJ-003 - Client Judge Panel](./LJ-003-client-judge-panel.md)
4. [LJ-004 - Judge Validation And E2E](./LJ-004-judge-validation-and-e2e.md)

## Notes

- This feature is the first real consumer of the codex adapter's
  `StructuredLlmService.generateStructured({ purpose: "candidate_judge" })`.
  The adapter (CAD-001..006) is complete but currently unused.
- MVP judges the single draft pasted in the Studio textarea. Ranking generated
  candidates is out of scope.
- The verdict renders in a standalone panel. It does NOT feed the deterministic
  engagement prediction in this MVP (the `aiRating` hook stays unused).
- The judge runs on-demand via a button. Auto-run after generation (the existing
  `runCodexJudgeAfterGeneration` setting) stays inert this slice.
- Provider failures surface as the `judge_failed` apiError code (scope `judge`).
  The client gates the button on `status.codex.state === "ready"` so an
  unavailable judge is communicated before any call.
