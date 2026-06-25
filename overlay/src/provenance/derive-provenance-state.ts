// @x-builder/overlay — deriveProvenanceState (XOB-023)
//
// The pure core of the two-state provenance model. A draft is "generated" while
// the live composer content matches the green anchor captured when a candidate
// was applied; the first CONTENT change — or the absence of an anchor — makes it
// "user_written".
//
// Comparison is WHITESPACE-INSENSITIVE (XOB fix): the anchor is the generated
// text WITH paragraph breaks ("\n\n"), while the composer's `textContent`
// concatenates Draft.js blocks with NO separator — so a byte-for-byte `===`
// never matched a multi-paragraph generated draft, leaving it wrongly
// "user_written" (blue) instead of "generated" (green). Stripping whitespace
// makes the two representations comparable; a whitespace-only edit keeps the
// draft "generated" (the content is unchanged), while any word change flips it.

/** The two — and only two — provenance states; never mixed, never derived async. */
export type ProvenanceState = "generated" | "user_written";

/** Content key for comparison: all whitespace removed (paragraph-break agnostic). */
const contentKey = (text: string): string => text.replace(/\s+/g, "");

/**
 * Derive the provenance state from the green anchor and the live composer text.
 *
 * `"generated"` iff an anchor has been set (`anchor !== null`) AND the composer
 * content matches it ignoring whitespace; otherwise `"user_written"`. A `null`
 * anchor (no candidate applied) is always `"user_written"`. The controller
 * short-circuits a null composer to `"user_written"` (no active compose session).
 */
export function deriveProvenanceState(
  anchor: string | null,
  composerText: string,
): ProvenanceState {
  return anchor !== null && contentKey(composerText) === contentKey(anchor)
    ? "generated"
    : "user_written";
}
