---
status: done
---

# RMU-017: [INT] Engine two-pass analyze + judge bridge integration

## User Flows to Verify

- Given followers + a draft / When `POST /posts/analyze` without `judgeSignals` / Then 200 with `qualityBasis="static"`, all four-regime fields present (`predictedMidImpressions`, `stallRange`, `escapeRange`, `escapeProbability`, `expectedReplies`, `signals`), both ranges ordered, and NO `rangeLow`/`rangeHigh`/`midpoint`/`confidence`.
- Given a judged draft / When `POST /posts/analyze` with `scoringContext.judgeSignals = { impressions, replies }` / Then 200 with `qualityBasis="judge"` and a reach that differs from pass-1.
- Given `accountProfile` in persisted settings / When `POST /drafts/judge` WITHOUT it in the body / Then the judge receives the settings value and `audienceMatch` is non-null.
- Given only `trailingMedianImpressions` (no `followers`) / When `POST /posts/analyze` / Then 200 `available` with `baseSource="trailing_median"` (NOT `disabled/missing_followers`).

## Architectural Invariants

- An `available` prediction carries the four-regime fields (`predictedMidImpressions`, `stallRange`, `escapeRange`, `escapeProbability`, `expectedReplies`, `signals`, `qualityBasis`) and both ranges are ordered (`low ≤ high`) — a facade that drops a regime field fails.
- The response contains NO `rangeLow`/`rangeHigh`/`midpoint`/`confidence` — a facade that left the transitional legacy shim in place fails.
- `score` and `postCoach` are byte-identical between pass-1 and pass-2 for the same draft — the quality gate/verdict is untouched by the judge bridge (a facade that lets the judge leak into the score fails).
- The deleted `aiRating`/`format-history` paths are not reachable (a facade that re-introduces the 0-10 path fails).

## Modules Under Test

`/posts/analyze` route → `DeterministicAnalysisService.analyzePosts` → `computeReachModel`;
`/drafts/judge` route → `JudgeDraftService.judge` (in-process `JudgeLlmGateway` fake — no real
CLI); settings → judge `accountProfile` fallback. Fastify `inject`; in-process; the judge LLM
is a true-external boundary stubbed by the in-process fake.

## Pipeline Log

- 2026-06-14 — **Done.** [INT] pipeline (Purple + Blue; no Red/Green). Purple (`e769c8c`) added `engine/src/server/tests/two-pass-analyze-judge-bridge-integration.test.ts` (8 tests: 4 user flows + 4 architectural invariants) via Fastify `inject` over the real `/posts/analyze`→`analyzePosts`→`computeReachModel` and `/drafts/judge`→`JudgeDraftService` paths; only the judge LLM + a temp-root settings repo stubbed. **Blue Validate Purple REJECT (cycle 1)** — invariants B (no `rangeLow`/`rangeHigh`/`midpoint`/`confidence`) and D (no `aiRating`/format-history) asserted absence against the Zod-**stripped** parsed object, so they tested "Zod strips unknown keys," not the implementation — vacuous against a facade that re-emits the legacy shim. **Purple fix (`1fdbae3`)** — identified the genuinely falsifiable seam is the response CONTRACT (the route's `parseResponseContract` guard strips before serialization, so even a normal raw-wire read is vacuous): B/D now inject a service fake that re-attaches the deleted fields (distinctive sentinels) onto a real contract-valid `DeterministicAnalysisService` base and assert absence on the RAW `JSON.parse(response.body)` wire + sentinel-not-on-wire, with anti-vacuous `status` guards. **Blue re-validate APPROVE** — independently re-ran the empirical `.passthrough()` probe (B/D FAIL when the contract re-admits the fields; 6 others stay green) then reverted (tree clean); mock honesty confirmed (fakes wrap the real service, isolated to B/D); A/C + the 4 flows unchanged. All 8 pass; engine suite **516/516**; typecheck clean; gates clean. **No concerns.** Confirmed in source: the judge bridge threads `judgeSignals` only into `computeReachModel`'s quality slot — `score`/`postCoach`/verdict never see it (invariant C); no `aiRating`/format-history strings in non-test source (invariant D).
