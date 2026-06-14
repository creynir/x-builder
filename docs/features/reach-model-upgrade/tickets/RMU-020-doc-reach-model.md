---
status: done
---

# RMU-020: [DOC] Document reach regimes, advanced inputs, two-pass refine, account profile

## Target Pages

- `docs/how-to/estimate-post-reach.md` — **Diataxis: How-To.**
- `docs/how-to/set-account-profile.md` — **Diataxis: How-To.**
- A short **Reference** note in `docs/features/reach-model-upgrade/` linking the epic and the two how-tos.

(Sibling of the existing `docs/how-to/choose-judge-provider.md`; plain markdown, no site generator.)

## What to Document (plain language — what the user sees and does, not symbols/state)

**estimate-post-reach.md (How-To):**
- The optional inputs in "Advanced context": typical impressions (median of your last ~20 original posts — replaces the follower-based estimate), "posted something similar in the last 7 days?", planned posting hour (UTC), whether you'll attach media, and account age.
- What the four reach numbers mean: **escape likelihood** (chance the post breaks past its normal reach), **typical reach** (the stall range), **breakout range** (the fat tail if it escapes), and **expected replies**.
- That the post **score/verdict is a quality gate, not the reach driver** — a high score does not mean high reach.
- That **judging a draft refines the reach a second time** (the "Refined with judge signal" label), and that the pre- and post-judge numbers are on **different scales** and are not meant to be compared directly.

**set-account-profile.md (How-To):**
- Where the **account profile** free-text field is in Settings, and that it describes your audience/niche.
- That it powers the judge's **audience-match** read; when it's empty, the Studio shows "Needs account profile" with a shortcut to add it.

**Reference note:**
- That the post-format taxonomy was reworked (new formats like fill-in-the-blank, CTA, fantasy question, binary choice, milestone, etc.) — described in plain user terms, not internal enum names. No deprecated-label note is needed; the old `one_liner`/`goal_share` values are removed, not retained.

## Scope Boundaries / Out of Scope

User-facing behavior only. No internal architecture, symbol names, or state-management
details. Comes after RMU-017/018/019. No calibration internals (developer-only, not a
user-facing feature).

## Pipeline Log

- 2026-06-14 — **Done.** [DOC] pipeline (White only; no Red/Green/Blue). Three pages written (each by a White subagent, in user-facing language, no internal symbol/enum names): `docs/how-to/estimate-post-reach.md` (How-To — Advanced context inputs, the four reach numbers escape-likelihood/typical/breakout/expected-replies, score-is-a-quality-gate-not-reach-driver, and the two-pass "Refined with judge signal" on a different, non-comparable scale), `docs/how-to/set-account-profile.md` (How-To — the Settings account-profile field, audience-match, and the empty→"Needs account profile"→Settings recovery), and `docs/features/reach-model-upgrade/reach-model-reference.md` (Reference — overview + a plain-language format-family table noting the removed one_liner/goal_share labels + Related-pages links). All three match the sibling `docs/how-to/choose-judge-provider.md` style (frontmatter + `## Title` + steps/tables) and carry traceability comments. Verified: all cross-links resolve to real files; zero internal symbol/enum leakage in user-facing text; calibration noted as developer-only (not a UI feature). Plain markdown, no site generator → no build step. Documents only shipped behavior (all 20 tickets shipped; nothing escalated/skipped).
