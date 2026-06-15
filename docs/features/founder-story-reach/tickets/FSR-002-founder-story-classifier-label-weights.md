---
status: todo
---

# FSR-002: Founder-story classifier, label, and weights

## Implementation Details

Teach the deterministic engine to emit `founder_story` and consume it through the
existing reach model.

Classifier ordering:

1. Keep existing question, choice, CTA, recognition, and other high-priority
   cascade branches ahead of founder-story detection.
2. Place `founder_story` before `milestone` and generic `story`.
3. Fall back to generic `story` when a first-person multiline narrative is
   missing any required founder-story ingredient.

Classifier predicate:

```ts
visibleLines.length >= 3
hasFirstPerson === true
founderStakePattern.test(text)
reversalPattern.test(text)
hardProofPattern.test(text)
```

Suggested predicate seeds:

```ts
const founderStakePattern =
  /\b(founder|startup|company|product|customer|users|revenue|mrr|arr|runway|investor|funding|sales|signups|launched|shipped|hired|quit|failed|lost|burned)\b/i;

const reversalPattern =
  /\b(but|then|until|after|instead|turned out|ended up|now|finally)\b/i;

const hardProofPattern =
  /(\$[\d,]+|\b\d+(\.\d+)?\s?(k|m|million|billion|%|percent)?\b|\b(first|paid|launched|shipped|closed|signed)\s+(customer|user|deal|sale|contract)\b)/i;
```

Add exhaustive reach-table entries:

```ts
formatReachTable.founder_story = {
  p50Multiplier: 0.8, // CALIBRATE
  escapeProbability: 0.04, // CALIBRATE
}

replyRateTable.founder_story = 0.005 // CALIBRATE
```

`computeReachModel` stays unchanged. `founder_story` must not widen
`escapeRange`, add prediction signals, or change the judge bridge.

## Data Models

No new data models beyond the `founder_story` enum member from FSR-001.

## Integration Point

The user pastes or writes a draft in Studio. The existing `/posts/analyze` path
calls `classifyPostFormat`, then `computeReachModel`, and the client renders the
detected format in deterministic details.

## Scope Boundaries / Out of Scope

- IN: classifier predicate, positive/negative fixtures, exhaustive reach/reply
  table entries, detected-format label rendering.
- OUT: event/emotional amplifier runtime, beat identity, prior-use count,
  account-history import, judge dimensions, UI prompt/copy for emotional content.
- Zero-trace: no amplifier prediction signal keys or placeholder future fields.

## Test Strategy & Fixture Ownership

Unit tests. Owning suites: engine classifier tests, reach-table exhaustiveness
tests, prediction-estimator tests, and client deterministic component tests.
Fixtures should include concrete positive and negative strings.

Positive fixture example:

```text
I almost shut the product down last winter.
We had two customers, no runway, and every investor said no.
Then we shipped the workflow rewrite and signed our first paid customer.
```

Negative fixture examples:

```text
I spent the weekend rewriting the settings page.
It took longer than expected.
Now it finally feels simpler.
```

```text
We hit 1,000 users today.
Huge milestone for the product.
Thank you to everyone who tried it.
```

```text
I failed a lot before this worked.
But now it finally does.
```

## Definition of Done

- `classifyPostFormat` returns `founder_story` for the positive fixture.
- Negative fixtures classify as `story`, `milestone`, or another existing format
  according to the cascade, but not `founder_story`.
- `formatReachTable` and `replyRateTable` are exhaustive for the new format.
- `computeReachModel` output shape is unchanged for `founder_story`.
- `pnpm typecheck` and `pnpm test` pass.

## Acceptance Criteria

- Given a multiline first-person founder narrative with stakes, reversal, and
  hard proof / When `classifyPostFormat` runs / Then it returns
  `founder_story`.
- Given a multiline first-person anecdote without founder/business stakes / When
  `classifyPostFormat` runs / Then it does not return `founder_story`.
- Given a milestone-style numeric achievement without the full narrative shape /
  When `classifyPostFormat` runs / Then it does not return `founder_story`.
- Given `founder_story` reaches `computeReachModel` / When prediction is computed
  / Then story-like `// CALIBRATE` weights are used and no tail, signal, or
  amplifier field changes output.
- Given deterministic details render the analyzed result / When
  `detectedFormat` is `founder_story` / Then the visible label is
  `Founder story`.

## Edge Cases

Single-line launch claims are not founder stories. Abstract personal reflections
without hard proof are generic stories. Private named examples from research
context must not appear in tests or fixtures.

## Pipeline Log
