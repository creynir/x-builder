# Reach-Model Upgrade — Build Order

Tickets build top to bottom. The `[FND]` ticket produces every shared contract and is
followed by an architectural checkpoint. After the foundation, the **engine track**
(RMU-004…009, 015, 016) and the **client track** (RMU-003, 010…014) can proceed in
parallel, except RMU-013 (client two-pass) which is gated on RMU-008 (engine bridge).
Test tickets come after all implementation; the doc ticket is last.

| ID | Prefix | Title | Track | Depends on |
|---|---|---|---|---|
| RMU-001 | [FND] | Extend shared Zod contracts | shared | — |
| RMU-002 | [RFR] | Remove dead format-history, aiRating, and dormant relaxation paths | engine | RMU-001 |
| RMU-003 | [RFR] | Extract `Switch` foundation component | client | — |
| RMU-004 | — | Format classifier: new members + corrected cascade | engine | RMU-001 |
| RMU-005 | — | Reach-model weights, external-link detection, repeat/status/quality multipliers | engine | RMU-001 |
| RMU-006 | — | Two-regime reach output + expectedReplies + base override + disabled-guard fix | engine | RMU-004, RMU-005 |
| RMU-007 | — | Reach signals: remove tension, split trending/tribe lexicons, answer-effort → pEscape/replies | engine | RMU-006 |
| RMU-008 | — | Judge rubric +5 dims, accountProfile input, judge→reach two-pass bridge | engine | RMU-006, RMU-001 |
| RMU-009 | — | Persist `accountProfile` in engine settings | engine | RMU-001 |
| RMU-010 | — | Advanced Phase-0 context inputs + client model (advancedContext + refinement) | client | RMU-001 |
| RMU-011 | — | Four-regime prediction render (`ReachRegimeBlock`) | client | RMU-001, RMU-006 |
| RMU-012 | — | Five new judge dimensions + null `audienceMatch` recovery state | client | RMU-001, RMU-008 |
| RMU-013 | — | Two-pass judge→refine orchestration | client | RMU-008, RMU-010, RMU-011 |
| RMU-014 | — | `accountProfile` settings field | client | RMU-009, RMU-003 |
| RMU-015 | [CHORE] | Add `@x-builder/calibration` workspace | tools | RMU-001 |
| RMU-016 | — | Calibration scaffold: normalizer, predictor-runner, per-format fit, leave-one-account-out validator | tools | RMU-015, RMU-006 |
| RMU-017 | [INT] | Engine two-pass analyze + judge bridge integration | engine | RMU-006…009 |
| RMU-018 | [INT] | Client writer two-pass + settings→judge wiring | client | RMU-010…014 |
| RMU-019 | [E2E] | Reach-model scale separation + classifier corpus + studio flow | both | RMU-017, RMU-018 |
| RMU-020 | [DOC] | Document reach regimes, advanced inputs, two-pass refine, account profile | docs | RMU-019 |
| RMU-021 | — | _(triage follow-up, C4)_ Compact candidate summary should use the chip, not the full `ReachRegimeBlock` | client | RMU-011 |
| RMU-022 | — | _(triage follow-up, C9b)_ Weight advanced inputs (plannedHourUtc/willAttachMedia/accountAgeYears) in the reach model | engine | RMU-010, RMU-016 |
