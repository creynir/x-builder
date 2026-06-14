---
title: Reach Model Reference
description: Quick reference for the reworked reach estimate, its post-format families, and where to read more.
---

## Reach Model Reference

The reach-model upgrade reworked how the app estimates a post's reach. The estimate is now driven by the post's format rather than its writing quality, and it is reported as two ranges: a typical reach range for an ordinary post and a separate breakout range for the rare post that takes off. Alongside those ranges, the Studio shows an escape likelihood (the chance the post breaks past its normal reach) and an expected reply count. Optional "Advanced context" inputs let you supply your own baseline and posting details to sharpen the estimate. After you judge a draft, the reach is refined a second time on a different scale (shown as "Refined with judge signal"), and the judge's rubric now includes audience-match, read against the account profile you set in Settings.

## Post-format families

The post-format taxonomy was reworked. Every draft is sorted into one of the families below, and the family is the main lever behind its reach estimate.

| Format family | What it is |
| --- | --- |
| Fill-in-the-blank / tribal prompt | Parallel lines that set up a pattern and invite readers to complete the last one. |
| Call-to-action | Asks readers to do something — drop a link, share their work, reply with an answer. |
| Fantasy / hypothetical question | A "what would you do if…" scenario with a concrete stake. |
| Binary choice | A short "X or Y?" with exactly two options. |
| A/B choice | The same X-or-Y idea offered as a short bulleted list. |
| Audience question | Addresses a named group ("Founders, …") with a quick, easy question. |
| Genuine question | A plain, single-clause question. |
| Nuanced question | A layered or conditional question, or one that invites an honest admission. |
| Recognition / roast | Observational humor about a recognizable person or type, with no advice. |
| Hot take | An opinion stated up front as a strong claim. |
| Milestone | A first-person achievement or goal stated with a number. |
| Story | A short multi-line first-person anecdote. |
| Wisdom one-liner | A single line of advice or a truth claim. |
| Insight share | A general observation that does not fit the other families. |
| Connection invite | A plain "let's connect" with no other ask. |

The older "one-liner" and "goal-share" labels are no longer used.

## Related pages

- [Reach-Model Upgrade epic](./README.md) — the feature overview.
- [How to estimate post reach](../../how-to/estimate-post-reach.md) — Advanced context inputs and what the four reach numbers mean.
- [How to set an account profile](../../how-to/set-account-profile.md) — the audience profile that powers the judge's audience-match read.
- [How to choose a judge provider](../../how-to/choose-judge-provider.md) — picking the LLM provider used to judge drafts.

Note: calibrating the model's underlying constants is a developer/maintainer task and is not exposed in the app — it is not something to look for in the UI.

<!-- Tickets: RMU-001..020 — last verified against codebase 2026-06-14 -->
