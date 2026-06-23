---
title: How the X Overlay Browser works
description: The design thinking behind X Builder's overlay — its transport seam, observe-only capture, the X policy boundary, post provenance, the approval rule, and the metric explainer.
---

## How the X Overlay Browser works

X Builder runs as an overlay: a panel that appears beside X's own composer, inside a regular Chromium window pointed at x.com. From there it can read the posts the page has already loaded, score a draft as you write it, generate candidate posts, and suggest what to write next.

This page explains *why* the overlay is built the way it is — the boundaries it respects, the trust model it assumes, and the few core ideas that the rest of the behavior follows from. It is not a setup guide; for that, see [Run the X Overlay Browser](../../how-to/run-x-overlay-browser.md). It is also not a field-by-field reference. The goal here is to leave you understanding the reasoning, so the product's behavior feels predictable rather than surprising.

## The transport seam: named functions, not a network port

The overlay (running inside the x.com page) and the local engine (the analysis and generation logic running on your machine) need to talk to each other. In v1, they do this through a small set of **named functions** that the engine registers and the overlay calls.

Concretely, the engine exposes seventeen functions — get status, get and update settings, validate and import an archive, analyze posts, judge a draft, generate ideas, suggest a post, and a handful of supporting reads. The overlay calls them as if they were ordinary async functions; Playwright routes each call over the browser's own internal debugger channel. All data crosses the boundary as plain JSON.

The thing to notice is what is *absent*. There is no local web server, no network port the overlay connects to, no CORS headers to negotiate, and nothing for x.com's own network policy to see or block. The overlay is not making HTTP requests to a local service; it is calling functions that already exist in the page.

This is deliberately a seam, not a fixed coupling. Because every function is defined behind a single transport interface and speaks only JSON, a future version — a browser extension, say — can carry the *same* calls over a different channel (localhost HTTP, extension messaging) without changing any of the overlay's component code. Only the one place that wires up the transport would change. The architecture commits to the contract, not to the pipe.

### The trust assumption behind this seam

Because the overlay lives inside the logged-in x.com page, the functions the engine exposes are reachable from that page. This is intentional, and it is worth stating plainly for contributors: **X Builder's local engine trusts the authenticated browser session it runs in.** It is a local-first, single-user design — there is no server, no account, and no second party. The only code positioned to call those functions is code already running inside your own authenticated X session on your own machine.

So the seam is not a public API to be hardened against untrusted callers; it is an in-page bridge whose security boundary is the same as your browser session itself. That assumption is what lets v1 stay this simple. A networked transport later would need its own boundary — which is one more reason the transport is kept swappable.

## Observe-only capture: read what's there, never act

When you browse X, X's own page code fetches your recent posts to render them. X Builder watches those responses arrive and reads the post data out of them. That is the whole of its capture model.

It does not send requests of its own to X's servers, does not authenticate against any X API, and does not scroll or paginate the page to pull in more posts than X already loaded. It is a passive reader of content the page fetched anyway.

A browsing session typically surfaces around twenty of your posts. Those accumulate locally across sessions — each session adds to a growing local corpus — so over time the engine has more of your real writing to work from, which sharpens both its analysis and its suggestions. Nothing about this corpus leaves your machine.

## The X policy boundary

The single line X Builder draws is between **reading content the page already has** and **acting on X on your behalf**. Everything the overlay does sits on the reading side of that line.

| In scope | Out of scope (not built, not planned) |
| --- | --- |
| Reading posts already loaded on the page | Sending any request to X you didn't trigger by browsing |
| Scoring a draft you're writing | Posting, liking, or following automatically |
| Suggesting post ideas from your own history | Reading direct messages |
| Filling the composer after you click a button | Taking any action without an explicit gesture from you |

The overlay fills the composer only when you click to ask for it. It never posts. Pressing X's own post button is always your own action — X Builder is on the page, but the decision to publish never leaves your hands.

## Post provenance: generated versus user-written

The overlay keeps track of where the text in the composer came from, and it shows you which it thinks is true. This is the provenance model, and most of the composer's behavior follows from it.

A post is **generated** — shown with a green background — when the composer text exactly matches the last thing X Builder produced, whether from a generate button or from "Apply all suggestions." The moment you edit that text, even by a single character, the post flips to **user-written**: the green background clears, the judge's blue inline notes appear, and the "Apply all suggestions" button returns.

This flip is what prevents the system from looping on itself. X Builder never re-improves its own output. "Apply all suggestions" is offered only on user-written text; once X Builder generates something and you apply it, that button stays hidden until *you* change the text. The provenance state, not a separate flag, is what gates the difference — so the rule can't drift between what the overlay shows and how it behaves.

## The approval rule: 70 or above

The judge scores a post from 0 to 100. **A post that scores 70 or above is approved.** When a generated candidate clears that bar, the overlay marks it approved.

The important property is that this is *one* rule, applied everywhere — when X Builder pre-judges a candidate it generated, when it runs "Apply all suggestions," and when you trigger a judge check by hand. There is a single shared definition of "approved," so the overlay and the engine cannot end up applying different thresholds, and the approval mark you see always reflects the same standard the engine used internally.

## Blue inline annotations

When the judge finishes reviewing a user-written post, it returns more than a score: it returns specific phrases in your draft that it flagged. The overlay locates each phrase in the composer and draws a blue underline beneath it; hovering shows the judge's note for that phrase.

These underlines are not always present, and their absence is meaningful rather than a glitch. They are gone while a post is in the generated (green) state, before the judge has run at all, and for any flagged phrase you've since edited away. That last case is intentional: when you change the text, a note that no longer matches simply disappears rather than lingering or blocking you. The annotations follow your writing; they never stand in front of it.

## The metric explainer: scores you can actually read

The static-engine scores and the judge's thirteen dimensions each come with a "what it means / how to read it" popover. This is a deliberate part of the design, not a nicety. A number is only useful if you know what it measures and which direction is good — and the judge's dimensions don't share one convention. For some, lower is better (a "negative risk" score, for instance); for others, higher is better (such as how closely a draft matches your voice).

So each metric carries a plain-language explanation of what it measures, which direction is favorable, and a scale to read it against. The explanatory copy ships with the overlay, and the engine can update it without shipping a new UI — the wording can improve as the scores themselves are tuned, without a release in lockstep.

## Where to go next

- To install and run X Builder for the first time, see [Run the X Overlay Browser](../../how-to/run-x-overlay-browser.md).

<!-- Tickets: XOB-032 (+ XOB-015/016/018/019/021/022/023/030/033) — last verified 2026-06-23 -->
