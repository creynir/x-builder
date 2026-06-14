---
title: Estimate post reach
description: Read the Studio's reach estimate, sharpen it with optional Advanced context, and understand why the post score is a quality gate — not the reach driver.
---

## Estimate post reach

The Studio scores every draft you write and, alongside the quality verdict, predicts how far the post is likely to travel. This guide shows you how to read the reach numbers, feed the estimate optional context for a sharper read, and judge a draft to refine the prediction a second time.

Reach is driven mainly by the **format** of your post and the **size of your audience** — not by how clean the writing is. So the estimate works on its own, but you can make it more accurate by telling it a few things about your account and your posting habits.

## Read the four reach numbers

After a draft is scored, the prediction shows a headline expected-reach number plus four signals that describe the spread of likely outcomes. Reach has a long tail: most posts land in a normal range, and a few break out far beyond it. The four numbers describe both cases at once.

| Name | What it means |
| --- | --- |
| Escape likelihood | The chance the post breaks past its normal reach into broader distribution, shown as a percentage. Higher means a better shot at travelling beyond your usual audience. |
| Typical reach | The range to expect if the post performs normally — it gets seen, then stalls. This is the most likely outcome for most posts. |
| Breakout range | The fat tail: how far the post could go if it does escape. This range is much wider and much higher than typical reach, because breakouts are rare but large. |
| Expected replies | About how many replies the post is likely to draw. |

Typical reach and breakout range are deliberately separate. Do not read the breakout range as a promise — it is the upside if escape happens, and escape likelihood tells you how probable that is.

## The score is a quality gate, not the reach driver

The post score and verdict tell you whether the draft is **good** — clear, well-formed, worth posting. They do **not** predict how far it will spread.

A high score does **not** mean high reach. Reach is driven mainly by the post's format and your audience size, so a polished draft in a low-reach format will still show modest reach, and a rougher draft in a high-reach format can show strong reach. Use the score to decide whether the post is worth publishing, and use the reach numbers to set your expectations for how far it will go.

## Add Advanced context for a sharper estimate (optional)

In the Studio, open the **Advanced context (optional)** section — it is collapsed by default, below the main scoring controls. Every field here is optional; the prediction works without any of them. Fill in whatever you know.

1. **Typical impressions** — the median views of your last ~20 original posts. Exclude pinned posts and reposts; you can find this in X Analytics. When you set this, it **replaces** the follower-based estimate, so it is the single most useful field to fill in.
2. **Posted something similar in the last 7 days?** — a checkbox. Tick it if you have recently posted a similar take; an optional date field appears so you can say when. Reusing a format or angle too soon tends to dampen reach.
3. **Planned posting hour** — the hour you plan to post, as a number from 0 to 23 in **UTC**. Out-of-range values are rejected with an inline error and are not applied.
4. **Whether you'll attach media** — toggle on if the post will include an image or video.
5. **Account age** — how many years old your account is.

Changing any of these re-scores the draft automatically, so the reach numbers update as you fill them in.

For the audience-match angle of the estimate, see [Set your account profile](set-account-profile.md).

## Judge a draft to refine the reach

Judging a draft does double duty: it scores the draft against the quality rubric **and** refines the reach estimate using the judge's read of the post.

1. Write and score your draft as usual.
2. Click **Judge draft** (see [Choose a judge provider](choose-judge-provider.md) to pick and set up the judge).
3. While the refine runs, a **"Refining reach…"** indicator appears. The current reach numbers stay visible underneath.
4. When it finishes, the prediction updates and shows a **"Refined with judge signal"** label.

The pre-judge and post-judge reach numbers are on **different scales** and are **not meant to be compared directly** — they are produced two different ways. There is intentionally no before/after difference shown, so do not read the change as an improvement or a drop. Treat the refined numbers as the better estimate and ignore the earlier ones once the label appears.

If you edit the draft while a refine is in flight, the stale result is discarded so a changed draft never shows reach from the old text. If judging fails, the earlier estimate stays in place and the judge error is shown.

<!-- Tickets: RMU-005..013, RMU-019 — last verified against codebase 2026-06-14 -->
