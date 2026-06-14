---
title: Set your account profile
description: Describe your audience and niche once in Settings so the Draft Judge can score how well each draft fits the people who follow you.
---

## Set your account profile

The Draft Judge scores how well a draft fits **your** audience — but only if it knows who that audience is. You tell it once by filling in the **account profile** on the Settings page. This guide shows you where the field is, what to write, how to save it, and what changes in the judge verdict once it is set.

You set this **once**, not per draft. After you save it, the judge reads it automatically on every judge run.

## Write your account profile

1. Open the **Settings** page.
2. Find the **account profile** field. It sits just after the **Judge provider** select, grouped with the judge settings.
3. In the multi-line text box, describe your **audience and niche** in plain language. Cover who follows you, the topics you post about, and your tone. The field's helper text says: "Describe your audience and niche. The judge uses this to score audience match."
4. Click **Save**.

Your profile persists. When you reopen Settings, the field shows what you saved. To clear it, empty the box and Save, or use **Use defaults** to reset it.

### Example

> 30–40s founders, SaaS/AI/devtools, mostly non-US. Practical, no-hype, occasionally dry humor.

There is no required format — write whatever best describes the people you want each draft to land with.

## What your profile powers

When you judge a draft, the verdict includes an **audience-match** dimension: a 0–100 score for how well that draft fits the audience you described. It is one of the judge's behavioral dimensions, shown alongside the others in the verdict.

You do **not** enter the profile per draft. Set it once here, and the judge uses the saved value on every judge run — see [Choose a judge provider](choose-judge-provider.md) for how judging works and which agent does the scoring.

## Recover from the empty state

If you judge a draft before setting a profile, the verdict cannot score audience match. In that case the audience-match row reads:

> Needs account profile

with an **Add account profile** shortcut that takes you to Settings.

To fix it:

1. Click **Add account profile** (or open **Settings** directly).
2. Fill in the account profile field and click **Save**.
3. Go back and judge the draft again.

After you save a profile and judge again, the audience-match row shows a number instead of the recovery prompt.

## How it fits the reach picture

Audience match is one of the judge dimensions that feed the post-judge reach estimate. For how the judge verdict refines a draft's reach, see [Estimate post reach](estimate-post-reach.md).

| What you do | Where | Result |
| --- | --- | --- |
| Write your audience and niche | Settings, after the Judge provider select | Profile saved |
| Judge a draft | Studio, **Judge draft** | Audience-match score in the verdict |
| Judge with no profile set | Studio verdict | "Needs account profile" + an **Add account profile** shortcut |

<!-- Tickets: RMU-008, RMU-009, RMU-012, RMU-014 — last verified against codebase 2026-06-14 -->
