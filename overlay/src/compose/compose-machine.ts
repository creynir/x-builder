// @x-builder/overlay — ComposeMachineState reducer (XOB-029)
//
// The compose orchestration machine owned by `ComposeCockpit`. It is a plain
// reducer over the §H phase union plus a separate `applyState` (the Apply-all
// affordance lifecycle). The cockpit dispatches actions from its transport
// effects (analyze / judge / generate / apply) and from composer edits; the
// reducer holds no transport logic of its own — it is the single source of
// truth the cockpit maps onto its child props.
//
// The phases mirror the ticket exactly:
//   idle → typing → static_ready → judging → judged
//                                 ↘ judge_failed
//   (generate)  generating → judged | typing
//   (apply)     applyState: idle → applying → {applied} | {failed}
//
// A composer edit aborts whatever is in flight (the cockpit guards stale
// resolutions with a monotonic request token); the reducer just resets to the
// re-analyze entry phase and clears `applyState`.

import type { JudgeVerdict } from "@x-builder/shared";

import type { ScoredPostItem } from "./types";

/** The §H compose phase union, owned by `ComposeCockpit`. */
export type ComposeMachineState =
  | { phase: "idle" }
  | { phase: "typing" }
  | { phase: "static_ready"; analyzeResult: ScoredPostItem; followers?: number }
  // `analyzeResult` is optional on `judging`: a generated verdict-less draft is
  // judged directly on the written text without a static analyze of its own.
  | { phase: "judging"; analyzeResult?: ScoredPostItem }
  // `analyzeResult` is optional on `judged`: a generated/applied draft reaches
  // `judged` from a candidate/apply verdict WITHOUT a static analyze of its own.
  | { phase: "judged"; analyzeResult?: ScoredPostItem; verdict: JudgeVerdict }
  | { phase: "judge_failed"; analyzeResult?: ScoredPostItem; error: string }
  // The deterministic analyze itself failed (distinct from a judge failure): the
  // static column shows its retryable `failed` state. No fake scored result.
  | { phase: "static_failed"; error: string }
  | { phase: "generating"; categoryId: string }
  | {
      phase: "apply_failed";
      analyzeResult?: ScoredPostItem;
      verdict?: JudgeVerdict;
      error: string;
    };

/** The Apply-all affordance lifecycle (L4), separate from the phase. */
export type ApplyState =
  | "idle"
  | "applying"
  | { status: "applied"; improvedOverOriginal: boolean }
  | { status: "failed"; error: string };

/** The full machine value the cockpit threads through its render. */
export interface ComposeState {
  phase: ComposeMachineState;
  applyState: ApplyState;
}

/** The initial machine value: nothing typed, nothing applying. */
export const initialComposeState: ComposeState = {
  phase: { phase: "idle" },
  applyState: "idle",
};

/** Every action the cockpit dispatches into the machine. */
export type ComposeAction =
  | { type: "reset_idle" }
  | { type: "typing" }
  | { type: "analyze_succeeded"; analyzeResult: ScoredPostItem; followers?: number }
  | { type: "analyze_failed"; error: string }
  | { type: "judge_started"; analyzeResult?: ScoredPostItem }
  | { type: "judge_succeeded"; analyzeResult?: ScoredPostItem; verdict: JudgeVerdict }
  | { type: "judge_failed"; analyzeResult?: ScoredPostItem; error: string }
  | { type: "judge_unavailable"; analyzeResult: ScoredPostItem }
  | { type: "generate_started"; categoryId: string }
  | { type: "generated_judged"; verdict: JudgeVerdict }
  | { type: "generated_pending_judge" }
  | { type: "apply_started" }
  | { type: "apply_applied"; verdict: JudgeVerdict; improvedOverOriginal: boolean }
  | { type: "apply_failed"; error: string };

/** Return the carried analyze result for phases that have one, else undefined. */
function carriedAnalyze(phase: ComposeMachineState): ScoredPostItem | undefined {
  switch (phase.phase) {
    case "static_ready":
    case "judging":
    case "judged":
    case "judge_failed":
      return phase.analyzeResult;
    case "apply_failed":
      return phase.analyzeResult;
    default:
      return undefined;
  }
}

/** The pure compose reducer. */
export function composeReducer(state: ComposeState, action: ComposeAction): ComposeState {
  switch (action.type) {
    case "reset_idle":
      return { phase: { phase: "idle" }, applyState: "idle" };

    case "typing":
      // A fresh edit re-enters analyze and clears any apply affordance.
      return { phase: { phase: "typing" }, applyState: "idle" };

    case "analyze_succeeded":
      return {
        ...state,
        phase: {
          phase: "static_ready",
          analyzeResult: action.analyzeResult,
          followers: action.followers,
        },
      };

    case "analyze_failed":
      return { ...state, phase: { phase: "static_failed", error: action.error } };

    case "judge_started":
      return { ...state, phase: { phase: "judging", analyzeResult: action.analyzeResult } };

    case "judge_succeeded":
      return {
        ...state,
        phase: {
          phase: "judged",
          analyzeResult: action.analyzeResult,
          verdict: action.verdict,
        },
      };

    case "judge_failed":
      return {
        ...state,
        phase: {
          phase: "judge_failed",
          analyzeResult: action.analyzeResult,
          error: action.error,
        },
      };

    case "judge_unavailable":
      // Static landed but the judge is gated off: hold at static_ready so the
      // JudgeStrip shows its `unavailable` hint (derived in the cockpit).
      return {
        ...state,
        phase: { phase: "static_ready", analyzeResult: action.analyzeResult },
      };

    case "generate_started":
      return { phase: { phase: "generating", categoryId: action.categoryId }, applyState: "idle" };

    case "generated_judged":
      // The chosen candidate carried a verdict: jump straight to judged with no
      // analyzeResult (generated text is not statically re-scored here).
      return {
        phase: { phase: "judged", verdict: action.verdict },
        applyState: "idle",
      };

    case "generated_pending_judge":
      // The chosen candidate carried no verdict: fall to typing so the normal
      // debounced analyze→judge flow runs over the written text.
      return { phase: { phase: "typing" }, applyState: "idle" };

    case "apply_started":
      return { ...state, applyState: "applying" };

    case "apply_applied":
      return {
        phase: {
          phase: "judged",
          analyzeResult: carriedAnalyze(state.phase),
          verdict: action.verdict,
        },
        applyState: { status: "applied", improvedOverOriginal: action.improvedOverOriginal },
      };

    case "apply_failed":
      return { ...state, applyState: { status: "failed", error: action.error } };

    default:
      return state;
  }
}
