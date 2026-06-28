---
title: Use External X Signals
description: Add external X accounts as observe-only signal sources, review evidence-backed patterns, and keep them separate from your own post corpus.
---

## Use External X Signals

External X Signals lets you track public patterns from other X accounts without importing those accounts into your own writing history. You add a handle, browse X normally, and X Builder records matching evidence only when the browser has already loaded that account's profile or timeline responses.

The feature is local and observe-only. It does not fetch from X by itself, use X API credentials, auto-scroll, follow accounts, or mix external posts into your own captured-post corpus.

## Add an external source

1. Open X Builder in the overlay browser.
2. Click the settings button in the top-left corner.
3. Find **External X signals**.
4. Enter a handle in **External X handle**. You can type `@external_builder` or `external_builder`.
5. Click **Add**.

The row appears with source totals. A new source can show **Evidence 0**, **Patterns 0**, and **Last observed: Waiting**. That is expected until the current browser session has seen matching X traffic for that account.

Adding the same handle again does not create a second source. X Builder normalizes the handle and returns the existing source row.

## Capture evidence

After adding a source, browse X normally in the same overlay browser. When the page itself loads profile or timeline GraphQL responses for a registered source, X Builder can ingest those already-fetched responses as external evidence.

Good ways to create observable traffic are manual, user-driven actions such as opening the account profile, reloading that profile, or viewing a timeline that X has already decided to load. X Builder does not perform those actions for you.

## Refresh a source

Each source row has **Refresh**. Use it after you have browsed to the source account or otherwise caused X to load that account's timeline.

Refresh does three local things:

1. records a refresh attempt for that source;
2. checks the external ledger for evidence already observed for that source;
3. updates evidence-backed patterns when enough supporting examples exist.

Refresh does not make X requests. If no matching traffic has been observed yet, the source stays at zero evidence and **Last observed** remains **Waiting**. Browse to the account yourself, let X load the timeline, then refresh again.

The section-level **Refresh** button reloads the settings overview from local storage. It is useful when you want to update the displayed totals without recording a source-specific refresh attempt.

## Review patterns

When X Builder has enough observed examples, the **Evidence-backed patterns** area shows read-only pattern rows. Each row includes the pattern label, pattern type, statement, source count, evidence count, confidence, and a few supporting previews.

The first shipped pattern family is format-based. Patterns are evidence-backed snapshots derived by the engine. They do not automatically rewrite your drafts, change reach scoring, or tune a model.

## Remove a source

Click **Remove** on a source row to remove it from the active overview and future external observation matching.

Removal does not delete your own posts, because external evidence was never part of the own-post corpus. The external ledger keeps historical evidence for that removed source, but the normal settings overview hides removed sources.

## Privacy and limits

External X Signals keeps its data in the local SQLite store under the external ledger tables. It is separate from captured posts, archive imports, feedback actuals, cooldowns, and voice samples.

The feature can only learn from X responses the browser has already loaded. If a source has not been visited, X did not return usable timeline data, or the response cannot be tied to the registered handle, X Builder leaves the source in a waiting/no-observation state instead of guessing.

For the architecture-level boundary, see [External X Import + Signals](../features/external-x-import-signals/README.md).

<!-- Tickets: EXS-010 - last verified against codebase 2026-06-28 -->
