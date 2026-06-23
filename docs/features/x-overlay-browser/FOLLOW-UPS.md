# X Overlay Browser v1 — Follow-up Backlog

Post-epic concerns triaged at merge (2026-06-23). The v1 epic (XOB-001..033) merged to `main`; these are the accepted residual-risk items, none of which blocked merge. Promote any to a `tickets/XOB-034+` file to run it through the pipeline.

| ID | Type | Source | Item | Disposition |
|----|------|--------|------|-------------|
| F1 | security/design | Crimson M1 + carried P2(a) | **LLM chain-budget + binding rate-limit.** No per-chain wall-clock budget (judge fan-out ignores `chainTimeoutMs`; each judge runs to the 180s cap) and no rate-limit/concurrency cap on the 17 bindings — which are reachable by any x.com page script. MEDIUM under the accepted v1 local-trust posture. | Follow-up: enforce a per-chain budget across the apply (3-call) and generate-refine (4-call) chains; consider a simple call-rate guard on the LLM-spawning bindings. |
| F2 | `[RFR]` | Amber §5b | **Decompose `engine/src/server/server.ts`** (1111 L, 20 routes + 23 inline service constructions + `DefaultReadinessService` + `attachCooldownSignals`). Also **hoist `attachCooldownSignals`** to a shared helper (now duplicated verbatim in `server.ts` and `runner/src/bound-engine-services.ts`). | Follow-up `[RFR]` (pinning-tested), behavior-preserving. |
| F3 | `[RFR]` | Amber §5b | **Decompose `overlay/src/compose/compose-cockpit.tsx`** (634 L, 26 hooks) — split the orchestration machine (AnchorLayer pins, ComposeContext, analyzeState, provenance, rAF snapshot) from the presentational assembly. | Follow-up `[RFR]`. |
| F4 | enhancement | carried D1 (rule-of-three) | **v2 `Button` `block`/`fullWidth` + `borderColor`/edge-token prop** — three+ consumers (XOB-024/026/027/028) worked around the missing props. | Small primitive ticket; retire the wrapper-span workarounds. |
| F5 | feature | re-validation | **Suggest home/profile route-gate.** `SuggestController` currently gates on `!compose.isActive` (no URL/route detector was built). Tighten to the intended home/profile route per XOB-028's Integration Point. | Follow-up. |
| F6 | `[CHORE]` | Crimson L2 | **Bump `esbuild`** transitive dev-dep (GHSA-g7r4-m6w7-qqqr, ≥0.28.1). Dev-only, client build path, Windows dev-server only. | Follow-up chore. |
| F7 | UX P2 | carried P2(b)/(c) | **Edit-while-applying cancellation** (the apply chain should cancel if the user edits mid-apply — XOB-027) and **rect-thrash visual budget** during rapid typing (XOB-022). | Follow-up. |
| F8 | bug (NOT XOB) | Final Blue / Purple | **`/voice` studio placeholder copy** (`e2e-tests/tests/shell-recovery-smoke.spec.ts:70`) + **`:5173` e2e env flakiness**. Pre-existing on `main` (CAD-* lineage), not caused by this epic; confirmed unrelated. | Separate ticket — track in the `/writer` studio area, not under XOB. |
| F9 | `[CHORE]` (optional) | Yellow XOB-030 / Blue | **Drop unused type-only barrel re-exports** in `engine/src/index.ts` (`ArchiveImportServiceOptions`, `ArchiveDerivedContextServiceOptions`) — type-erased, zero runtime, lint doesn't flag. | Accept (deliberate package surface) or trivial cleanup. |

**Resolved at merge (no follow-up needed):**
- Crimson L1 (inbound trust boundary) — documented in `explanation.md`.
- Amber `deriveApproved` label-vs-overall phrasing — `explanation.md` kept the accurate "70 or above" wording.
- Final Blue / recurring ticket-IDs in test comments — stripped (`chore(XOB)` `f132d84`).
