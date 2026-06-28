---
title: Use My Feedback Loop
description: Record deliberate reach predictions, connect them to captured X post metrics, and read the local predicted-vs-actual feedback summary.
---

## Use My Feedback Loop

My Feedback Loop compares what X Builder predicted before you posted with the actual metrics later captured for the post. It is local calibration: which formats beat the current baseline, which ones underperform, and which recorded drafts still need to be matched to a real X post.

The loop uses only deliberate prediction snapshots. Normal typing and debounced scoring are not stored automatically.

## What gets recorded

A feedback prediction is recorded in three cases:

1. You generate a draft and the overlay writes it into the composer.
2. You use **Apply all suggestions** and the overlay keeps the improved rewrite.
3. You click **Record posted draft** for the current scored text.

The recorded snapshot includes the exact text, detected format, static score, reach prediction, scoring context, and analyzer version from that moment. It does not record every typed draft, and it does not send analytics to a cloud service.

## Connect a prediction to actual performance

Actual performance comes from your local post library. X Builder learns actuals after the post is captured or imported into the local SQLite store.

A recorded prediction can link to a post three ways:

| State | Meaning | What to do |
| --- | --- | --- |
| **Auto-linked** | The recorded text matched exactly one captured post after normalization. | Nothing; the summary can compare prediction and actuals once impressions exist. |
| **Linked from captured post** | The prediction was recorded with a known X post id. | Nothing; wait for captured metrics if actuals are still partial. |
| **Linked manually** | You chose the correct X post id/status URL in settings. | Nothing; the row now follows that post's captured metrics. |
| **Needs link** | A manually recorded draft has no matching captured post yet. | Capture/import the post, or paste the numeric post id or `/status/<id>` URL in settings. |
| **Waiting for captured post** | A generated/apply snapshot is waiting for the matching post to appear in the local corpus. | Reload or scroll your X profile so live capture sees the post, or import archive data. |
| **Multiple possible posts found** | More than one captured post has the same normalized text. | Pick the correct candidate in settings, or paste the exact post id/status URL. |
| **Linked, waiting for impressions** | The prediction is linked, but the captured post does not have impression data yet. | Re-capture the post later; archive data may not include impressions. |

Automatic matching is intentionally fail-closed. If the same normalized text matches more than one captured post, X Builder will not guess.

## Read the settings summary

Open **X Builder settings** and use the **Feedback loop** section.

The summary shows totals for recorded predictions, linked rows, rows with actual metrics, pending rows, ambiguous matches, and partial actuals. Recent outcomes show the recorded text, detected format, link state, predicted midpoint, actual impressions when available, and the linked post id.

**Format learnings** group linked outcomes by detected format. When enough actuals exist, the section explains whether that format is beating, trailing, or staying near the current prediction baseline for your account.

## Manual linking

For a pending or ambiguous row:

1. Paste a numeric X post id or a full `/status/<id>` URL into the row's link field.
2. If candidate ids are shown, click the correct id to fill the field.
3. Click **Link**.
4. After the row refreshes to **Linked manually**, the summary uses that post's local captured metrics.

Manual linking only points a stored prediction at a local post-library record. It does not fetch from X by itself and does not publish or edit anything.

## Privacy and limits

All feedback data stays in the local SQLite store with the rest of the corpus. There is no hosted analytics account, external metric service, or cloud feedback database.

The summary is calibration, not a guarantee. It can only compare against actual metrics that exist locally. If a post has not been captured, if an archive record lacks impressions, or if two posts share the same text, the row will stay pending, partial, or ambiguous until you capture more data or link it manually.

For the prediction numbers themselves, see [Estimate post reach](estimate-post-reach.md).

<!-- Tickets: MFL-001..MFL-010 - last verified against codebase 2026-06-28 -->
