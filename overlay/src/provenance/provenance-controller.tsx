// @x-builder/overlay — ProvenanceController (XOB-023)
//
// The orchestrator of the compose surface's provenance logic. It renders no DOM
// of its own: it derives the two-state model (L5) every render and hands the
// result to `props.children(ctx)` (render-prop), which the parent uses to gate
// `CompositionHighlightLayer`'s green wash / blue underlays and the verdict /
// Apply-all affordances.
//
// State levels (per the ticket):
//   • anchor       — L3, ref-backed (useProvenanceAnchor); set does NOT re-render.
//   • composerText — L4, debounced read (useComposerText); its update re-renders.
//   • provenanceState / showGreen / showBlue / approved — L5, derived each render,
//     NEVER stored in React state.
//
// Threshold ownership: `approved` is derived EXCLUSIVELY by `deriveApproved` from
// `@x-builder/shared` (which reads the verdict LABEL). The overlay writes no
// approval threshold of its own. `null` verdict ⇒ `approved === false`.
//
// Null-composer guard: when `composerEl === null` there is no active compose
// session, so the state is always `"user_written"` regardless of the anchor —
// this prevents an empty anchor (`""`) plus an empty composer read (`""`) from
// spuriously deriving `"generated"`.

import { useEffect, useRef, type ReactNode } from "react";
import {
  deriveApproved,
  type JudgeAnnotation,
  type JudgeVerdict,
} from "@x-builder/shared";

import { deriveProvenanceState, type ProvenanceState } from "./derive-provenance-state";
import { useProvenanceAnchor } from "./use-provenance-anchor";

export interface ProvenanceControllerProps {
  /** The contenteditable composer element; `null` ⇒ always `"user_written"`. */
  composerEl: HTMLElement | null;
  /**
   * The live composer text from the parent's MutationObserver-backed read
   * (AnchorLayer). It MUST come from there, not a self-contained `input`
   * listener: X's Draft.js does NOT fire `input` on a paste / programmatic
   * write, so a generated draft would never be observed and would stay stuck
   * "user_written" (blue) instead of flipping to "generated" (green).
   */
  composerText: string;
  /** Annotations from the latest judgeDraft verdict; `[]` when none. */
  annotations: JudgeAnnotation[];
  /** Latest verdict from the parent compose machine; nullish ⇒ `approved=false`. */
  latestVerdict?: JudgeVerdict | null;
  /** Optional callback fired when the derived provenance state changes. */
  onProvenanceChange?(state: ProvenanceState): void;
  /** Render-prop: receives the derived context; the controller renders no DOM. */
  children: (ctx: ProvenanceRenderContext) => ReactNode;
}

export interface ProvenanceRenderContext {
  /** The single active provenance state; never mixed. */
  provenanceState: ProvenanceState;
  /** Green wash visible — i.e. `provenanceState === "generated"`. */
  showGreen: boolean;
  /** Blue underlays visible — user-written AND there are annotations to paint. */
  showBlue: boolean;
  /** `deriveApproved(latestVerdict)`; only meaningful in `"generated"`. */
  approved: boolean;
  /** Capture confirmed-written composer text as the green anchor. */
  setAnchor(text: string): void;
}

/**
 * Derive the compose surface's provenance model and hand it to the render-prop.
 * Renders no DOM of its own.
 */
export function ProvenanceController(props: ProvenanceControllerProps): ReactNode {
  const { composerEl, composerText, annotations, latestVerdict, onProvenanceChange, children } =
    props;

  const { anchor, setAnchor } = useProvenanceAnchor();

  // L5: no active compose session (null composer) is always user_written, so an
  // empty anchor + empty composer read cannot spuriously derive "generated".
  const provenanceState: ProvenanceState =
    composerEl === null ? "user_written" : deriveProvenanceState(anchor, composerText);

  const showGreen = provenanceState === "generated";
  const showBlue = provenanceState === "user_written" && annotations.length > 0;
  const approved =
    latestVerdict !== null && latestVerdict !== undefined
      ? deriveApproved(latestVerdict)
      : false;

  // Notify the parent compose machine only on a real state transition.
  const previousState = useRef<ProvenanceState | null>(null);
  useEffect(() => {
    if (previousState.current !== provenanceState) {
      previousState.current = provenanceState;
      onProvenanceChange?.(provenanceState);
    }
  }, [provenanceState, onProvenanceChange]);

  return children({ provenanceState, showGreen, showBlue, approved, setAnchor });
}
