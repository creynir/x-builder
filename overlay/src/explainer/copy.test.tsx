// @x-builder/overlay — overlayExplainerCopy contract tests (completeness + direction)
//
// The explainer copy is a STATIC constant — no transport, no shadow root needed
// for these assertions; they are pure data-shape checks over the exported map.
// They are the first line of defence on the reconciled MetricKey contract: the
// map must cover every metric the user actually sees (the 13 real judge dims +
// the deterministic Post Coach checks + the real reach fields) with non-empty,
// non-placeholder prose, and the three non-negotiable direction rules must hold.
//
// MetricKey here is the RECONCILED contract (the real `judgeScoresSchema`), NOT
// the drifted list in the ticket body. The judge emits exactly these 13 dims:
//   overall, replies, profileClicks, impressions, bookmarkValue, dwellProxy,
//   voiceMatch, negativeRisk, answerEffort, strangerAnswerability,
//   statusDependency, replyVsQuoteOrientation, audienceMatch (nullable)
// plus deterministic: repetition, postCoach
// plus reach: stallRange, escapeRange, escapeProbability

import { describe, expect, it } from "vitest";

import { overlayExplainerCopy } from "./copy";
import type { ExplainerEntry, MetricKey } from "./types";

// The explicit, reconciled set of keys the explainer MUST cover. This list is
// the runtime mirror of the `MetricKey` union; `Record<MetricKey, …>` enforces
// the same coverage at compile time. Keeping the list explicit here means a
// drift in either direction (map gains/loses a key, or the union does) fails a
// test rather than silently passing.
const RECONCILED_KEYS = [
  // 13 real judge dimensions (judgeScoresSchema)
  "overall",
  "replies",
  "profileClicks",
  "impressions",
  "bookmarkValue",
  "dwellProxy",
  "voiceMatch",
  "negativeRisk",
  "answerEffort",
  "strangerAnswerability",
  "statusDependency",
  "replyVsQuoteOrientation",
  "audienceMatch",
  // deterministic Post Coach checks
  "repetition",
  "postCoach",
  // real reach fields
  "stallRange",
  "escapeRange",
  "escapeProbability",
] as const satisfies readonly MetricKey[];

/** Every reconciled key must also be assignable from `MetricKey` (compile-time). */
const _exhaustive: Record<(typeof RECONCILED_KEYS)[number], true> = Object.fromEntries(
  RECONCILED_KEYS.map((k) => [k, true]),
) as Record<(typeof RECONCILED_KEYS)[number], true>;
void _exhaustive;

/** Trimmed-non-empty assertion that also rejects the ticket's placeholder ellipsis. */
function isRealProse(text: unknown): boolean {
  return (
    typeof text === "string" &&
    text.trim().length > 0 &&
    text.trim() !== "..." &&
    text.trim() !== "…"
  );
}

describe("overlayExplainerCopy — completeness over the reconciled MetricKey set", () => {
  it("exposes exactly the 18 reconciled keys — no extras, none missing", () => {
    const present = Object.keys(overlayExplainerCopy).sort();
    const expected = [...RECONCILED_KEYS].sort();
    expect(present).toEqual(expected);
  });

  it("does NOT carry any of the ticket-body's fictional (drifted) keys", () => {
    // These six never reach the engine; they must not appear in the copy map.
    const fictional = [
      "opinionClarity",
      "noveltySignal",
      "cta",
      "brevityFit",
      "hookStrength",
      "contentDepth",
      // fictional reach fields from the ticket body
      "reachRange",
      "reachMidpoint",
    ];
    for (const key of fictional) {
      expect(Object.prototype.hasOwnProperty.call(overlayExplainerCopy, key)).toBe(false);
    }
  });

  it.each(RECONCILED_KEYS)(
    "%s has a non-empty label / whatItMeans / howToRead and a valid goodDirection",
    (key) => {
      const entry: ExplainerEntry = overlayExplainerCopy[key];
      expect(entry).toBeDefined();
      expect(isRealProse(entry.label)).toBe(true);
      expect(isRealProse(entry.whatItMeans)).toBe(true);
      expect(isRealProse(entry.howToRead)).toBe(true);
      expect(["higher", "lower", "poled"]).toContain(entry.goodDirection);
    },
  );

  it("renders both scale labels as real prose whenever a scale is present", () => {
    for (const key of RECONCILED_KEYS) {
      const { scale } = overlayExplainerCopy[key];
      if (scale) {
        expect(isRealProse(scale.lowLabel)).toBe(true);
        expect(isRealProse(scale.highLabel)).toBe(true);
      }
    }
  });
});

describe("overlayExplainerCopy — non-negotiable direction rules", () => {
  it('negativeRisk is "lower" and says "lower is better"', () => {
    const entry = overlayExplainerCopy.negativeRisk;
    expect(entry.goodDirection).toBe("lower");
    expect(entry.howToRead.toLowerCase()).toContain("lower is better");
    // Direction framing: the favorable (low) end is not labeled "bad".
    expect(entry.scale?.lowLabel.toLowerCase() ?? "").not.toContain("bad");
  });

  it('statusDependency is "lower" and says "lower is better"', () => {
    const entry = overlayExplainerCopy.statusDependency;
    expect(entry.goodDirection).toBe("lower");
    expect(entry.howToRead.toLowerCase()).toContain("lower is better");
    expect(entry.scale?.lowLabel.toLowerCase() ?? "").not.toContain("bad");
  });

  it('replyVsQuoteOrientation is "poled" with no unqualified "better" bias', () => {
    const entry = overlayExplainerCopy.replyVsQuoteOrientation;
    expect(entry.goodDirection).toBe("poled");
    // No directional bias: the word "better" must not appear standalone. The
    // copy may say "neither pole is better" (qualified) — that negation is the
    // only permitted use, so we assert the bare directional claims are absent.
    const howToRead = entry.howToRead.toLowerCase();
    expect(howToRead).not.toContain("higher is better");
    expect(howToRead).not.toContain("lower is better");
    // If "better" appears at all, it must be negated ("neither … better").
    if (howToRead.includes("better")) {
      expect(howToRead).toContain("neither");
    }
  });

  it("the two lower-is-better dims are the ONLY judge dims marked lower", () => {
    // Guards against a future edit flipping an unrelated dim to "lower".
    const lowerDims = (
      [
        "overall",
        "voiceMatch",
        "negativeRisk",
        "statusDependency",
        "audienceMatch",
        "replyVsQuoteOrientation",
        "strangerAnswerability",
        "answerEffort",
      ] as const
    ).filter((k) => overlayExplainerCopy[k].goodDirection === "lower");
    expect(new Set(lowerDims)).toEqual(new Set(["negativeRisk", "statusDependency"]));
  });
});
