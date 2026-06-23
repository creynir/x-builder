// @x-builder/overlay — deriveProvenanceState (XOB-023)
//
// The pure core of the two-state provenance model. A draft is "generated" only
// while the live composer text is byte-for-byte identical to the green anchor
// captured at the moment a candidate was applied (§16.5). The first character
// that diverges — or the absence of an anchor — makes it "user_written".
//
// Byte-for-byte `===` is the ONLY comparison: no trimming, no whitespace
// normalization, no case folding. Callers (XOB-024/027) must capture the anchor
// from the composer's post-write `textContent` so the raw whitespace matches.

/** The two — and only two — provenance states; never mixed, never derived async. */
export type ProvenanceState = "generated" | "user_written";

/**
 * Derive the provenance state from the green anchor and the live composer text.
 *
 * `"generated"` iff an anchor has been set (`anchor !== null`) AND the composer
 * text equals it byte-for-byte; otherwise `"user_written"`. A `null` anchor (no
 * candidate applied) is always `"user_written"`. Note that an empty anchor `""`
 * with empty composer text is `"generated"` — anchor is non-null and equal — so
 * callers guard `setAnchor("")` and the controller short-circuits a null
 * composer to `"user_written"` (no active compose session).
 */
export function deriveProvenanceState(
  anchor: string | null,
  composerText: string,
): ProvenanceState {
  return anchor !== null && composerText === anchor ? "generated" : "user_written";
}
