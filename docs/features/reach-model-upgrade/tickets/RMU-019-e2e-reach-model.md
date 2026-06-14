---
status: done
---

# RMU-019: [E2E] Reach-model scale separation + classifier corpus + studio flow

## User Flows to Verify

- Given the Studio / When the user pastes a draft, sets followers, expands Advanced context and sets a planned hour, waits for auto-score, clicks "Judge draft", and refine completes / Then they see: a four-regime prediction, 13 judge rows, and a "Refined with judge signal" prediction — all from one component tree.
- Given an empty account profile / When the user judges / Then `audienceMatch` shows "Needs account profile" with a working "Add account profile" path to Settings; after saving a profile and re-judging, it shows a number.
- Given each spec example string / When analyzed end-to-end through `/posts/analyze` / Then `detectedFormat` is the named member; "drop your startup link" → `cta_farm`; "Codex or Claude Code?" → `binary_choice`.

## Architectural Invariants

*Each must be falsifiable — a facade (file renames, copy-paste, router to separate implementations) must fail.*

- **Pre/post-judge scale separation:** pass-1 and pass-2 `predictedMidImpressions` are produced by different quality bases (`qualityBasis` differs), and the test asserts the two are **never numerically diffed or compared as the same scale** — a test that treats them as equal-scale (renders or computes a delta) must fail.
- The prediction card does not unmount/remount when `qualityBasis` switches `static → judge` — single component tree (a router-to-separate-implementations facade fails).
- `one_liner` and `goal_share` are fully removed from `PostFormat`/`detectedPostFormatSchema` and every map — a payload carrying either now FAILS to parse, and a regression re-adding the members fails.
- The final build has no `rangeLow`/`rangeHigh`/`midpoint`/`confidence` prediction fields and no derived legacy mirror anywhere (schema, engine type, estimator, client) — the card renders the four regimes directly; a facade that left a compat shim in fails.

## Modules Under Test

Engine `/posts/analyze` + `/drafts/judge` end-to-end (judge boundary mocked) through both
POSTs; `WriterPage` + `SettingsRoute` public drivers for the client flow. The corpus
accuracy targets are NOT exercised here (corpus absent — see RMU-016).

## Pipeline Log

- 2026-06-14 — **Done.** [E2E] pipeline (Purple + Blue; no Red/Green). Orchestrator placement decision: tested IN-PROCESS (Fastify `inject` + SSR public drivers + a source-scan static policy) per the ticket's "Modules Under Test" — the repo's Playwright `e2e-tests/` workspace stubs the engine and can't exercise the real classifier/scale-separation, so it was not used. Purple (`53e6366`) added 3 test files (one per package): `client/src/features/writer/tests/studio-reach-model-e2e.test.tsx` (flow 1 full studio render + flow 2 empty-profile→Settings→re-judge recovery + scale-separation-no-delta + single-tree skeleton proxy), `engine/src/server/tests/classifier-corpus-analyze-e2e.test.ts` (flow 3: 14 spec strings through the REAL `/posts/analyze` incl. `"drop your startup link"`→`cta_farm`, `"Codex or Claude Code?"`→`binary_choice`; + a route-boundary `one_liner`-rejection assertion), and `shared/src/schemas/tests/no-legacy-reach-mirror-policy.test.ts` (a standing static-policy source scan of 7 prediction-path files for `rangeLow`/`rangeHigh`/`midpoint`/`confidence`, comments stripped, self-falsifiability anchors — replaces RMU-011's one-off `rg`). Existing one_liner/goal_share removal + legacy-absence unit coverage CITED, not duplicated. Blue Validate Purple **APPROVE** — independently re-ran the static-policy matcher AND injected a `midpoint` shim into the stripped estimator source (matcher flagged it → policy would FAIL), then reverted (tree clean); confirmed all 4 invariants genuinely falsifiable, flow 3 hits the real classifier (non-vacuous), mock honesty good, flow 2 confirms RMU-014 zero-trace (`judge` body `{text}` only). Scoped suites all pass: shared **94** / engine **535** / client **257**; typecheck clean; gates clean.
- **Concern C6 (orchestrator/Yellow-style, non-blocking → epic-end triage):** the "prediction card does not unmount/remount when `qualityBasis` switches static→judge" invariant — a true React-runtime reconciliation property — was covered by an IN-PROCESS structural-skeleton proxy (the same `xb-reach-regime` card skeleton renders both states; a two-implementation facade fails). This satisfies the invariant's INTENT (single component tree, not a router to two implementations) but does not assert React's literal no-remount behavior, which would require a Playwright browser spec in the engine-stubbed `e2e-tests/` workspace. Architect to decide at triage whether an additional browser-level no-remount spec is wanted.
