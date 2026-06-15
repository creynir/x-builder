---
status: todo
---

# Founder Story Reach

Add `founder_story` as a detected post format while keeping event/emotional
amplification as documented future work until account-history producers exist.

## Architecture Context

This epic is a scoped amendment to the reach model. It adds a concrete,
faceless `founder_story` format to the deterministic classifier and shared
contracts. It does not add runtime amplifier fields, manual emotional inputs,
or LLM-judge dimensions.

`founder_story` means a multiline first-person founder/product narrative with
all three ingredients: founder/business stakes, reversal language, and hard
proof or concrete outcome. It is different from generic `story`, which may be
first-person narrative without that full shape.

The updated research introduces an event/emotional amplifier concept for
founder stories. That concept is **future-only** in this epic. Runtime code must
not add `scoringContext.amplifier`, `eventContext`,
`prediction.amplifierType`, amplifier prediction signals, judge amplifier
dimensions, or UI controls. Amplification can only become runtime behavior
after a future account/history producer supplies beat identity and prior-use
count. Even then, it may widen the upper tail only, never the median.

The ethical boundary is load-bearing: the app may classify a draft as a founder
story when the content is already present, but it must not ask users to add
emotional content for reach.

## API Endpoints

- `POST /posts/analyze` — may return `detectedFormat: "founder_story"` on
  scored items. Request and prediction shapes otherwise stay unchanged.
- `POST /drafts/judge` — unchanged. The judge bridge remains
  `judgeSignals: { impressions, replies }`.

## Component Breakdown

- `detectedPostFormatSchema` — accepts `founder_story`.
- `PostFormat` — mirrors the shared enum.
- `classifyPostFormat` — produces `founder_story` before generic `story`.
- `formatReachTable` and `replyRateTable` — consume `founder_story`
  exhaustively with story-like `// CALIBRATE` values.
- `computeReachModel` — unchanged; consumes `founder_story` through the existing
  format path only.
- `DeterministicDetailInspector` — displays `Founder story` through the detected
  format label surface.

## Dependencies

- Existing deterministic-analysis shared schemas and engine classifier.
- Existing client deterministic details surface.
- Existing test suites in `shared`, `engine`, `client`, and `e2e-tests`.
- No external services, no X account connection, and no LLM provider changes.

## Sub-Tickets Overview

See `tickets/README.md` for the build order.
