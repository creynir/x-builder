// @x-builder/overlay — useProvenanceAnchor (XOB-023)
//
// The green anchor store (L3, session-scoped). The anchor is the exact composer
// text captured when a generated candidate is applied (XOB-024) or when
// applyJudgeSuggestions returns (XOB-027). It is held in a `useRef`, NOT React
// state: setting it must NOT trigger a re-render (consumers re-derive L5 each
// frame off the live composer-text signal). `setAnchor`/`clearAnchor` are stable
// references across renders so consumers can pass them down without re-binding.
//
// Last-call-wins: no queue is maintained — a second `setAnchor` overwrites the
// first. `clearAnchor` resets to `null` (compose session end), so the next read
// is `"user_written"` until a fresh candidate is applied.

import { useCallback, useRef } from "react";

export interface ProvenanceAnchor {
  /** The current green anchor, or `null` when no candidate has been applied. */
  readonly anchor: string | null;
  /** Capture `text` as the green anchor (last-call-wins; no re-render). */
  setAnchor(text: string): void;
  /** Reset the anchor to `null` (compose session end). */
  clearAnchor(): void;
}

/** Ref-backed green anchor store with stable setter/clearer references. */
export function useProvenanceAnchor(): ProvenanceAnchor {
  const anchorRef = useRef<string | null>(null);

  const setAnchor = useCallback((text: string): void => {
    anchorRef.current = text;
  }, []);

  const clearAnchor = useCallback((): void => {
    anchorRef.current = null;
  }, []);

  return { anchor: anchorRef.current, setAnchor, clearAnchor };
}
