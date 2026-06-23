// @x-builder/overlay — StaticEngineColumn `AnalyzeState` fixtures (test-only)
//
// `StaticEngineColumn` is purely presentational
// over an injected `AnalyzeState`, so its tests drive it entirely from the
// variants below. The `ready` result is a FULL, schema-valid
// `Extract<AnalyzedPostItem, { status: "scored" }>` — its construction is copied
// (and adapted) from the known-valid `scoredResponse` in
// `engine/src/server/tests/posts-analyze.test.ts`, which round-trips through the
// real `analyzePostsResponseSchema` over the HTTP boundary. We import the REAL
// shared types (no re-derived Zod, no invented fields); a dedicated
// fixture-validity test (`analyze-state-fixtures.test.ts`) re-parses these
// against `analyzedPostItemSchema` / `engagementPredictionSchema` so the
// fixtures can never silently drift from the schema.
//
// `AnalyzeState` is the overlay-local UI-state wrapper the parent ComposeCockpit
// owns; `StaticEngineColumn` only ever consumes it. It is declared
// here against the real `ScoredPostItem` alias so the column and its tests share
// one definition.

import type { AnalyzedPostItem, EngagementPrediction } from "@x-builder/shared";

/** The `status: "scored"` variant of the real analyzed-post-item union. */
export type ScoredPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;

/** Overlay-local analyze UI state (owned by ComposeCockpit, consumed here). */
export type AnalyzeState =
  | { status: "idle" }
  | { status: "scoring" }
  | { status: "ready"; result: ScoredPostItem }
  | { status: "failed"; error: string };

/** Idle: nothing requested yet. */
export const idleState: AnalyzeState = { status: "idle" };

/** Scoring: a request is in flight. */
export const scoringState: AnalyzeState = { status: "scoring" };

/** Failed: the static engine call failed; `error` is the retry-able reason. */
export const failedState: AnalyzeState = { status: "failed", error: "analyze_failed" };

/**
 * A complete, schema-valid scored item. Adapted from the verified `scoredResponse`
 * construction in `posts-analyze.test.ts`:
 *  - `score.value = 72` (headline static metric)
 *  - `postCoach` in the `ready` state with one `failed` + one `warned` + one
 *    `passed` VoiceCheck (object form, NOT string arrays)
 *  - `prediction` `available` with `stallRange`/`escapeRange` as `{ low, high }`
 *    objects (NOT tuples), `escapeProbability`, `predictedMidImpressions`, etc.
 *  - `cooldown` in the `warming` state.
 */
export const readyResult: ScoredPostItem = {
  status: "scored",
  id: "candidate-1",
  text: "genuine question: why do agent handoffs fail when context is hidden from the next step?",
  sourceFormat: "debate-question",
  detectedFormat: "genuine_question",
  score: {
    value: 72,
    checks: [
      { id: "specificity", label: "Specific proof", status: "pass" },
      { id: "hook", label: "Strong hook", status: "warn" },
      { id: "length", label: "Too long for the format", status: "fail" },
    ],
    learnings: [
      {
        text: "Static rule evidence: specific details make posts easier to evaluate.",
        relevance: "general",
      },
    ],
    engageability: {
      engageable: true,
      reason: "Ends with a concrete question.",
    },
  },
  postCoach: {
    state: "ready",
    title: "Post Coach",
    value: 72,
    badge: {
      label: "Ship it",
      tone: "ship",
      tooltip: "Solid post. Ship it; higher scores are a bonus.",
    },
    target: 60,
    engageability: {
      engageable: true,
      reason: "Ends with a concrete question.",
    },
    failed: [{ id: "length", label: "Too long for the format", status: "fail" }],
    warned: [{ id: "hook", label: "Strong hook", status: "warn" }],
    passed: [{ id: "specificity", label: "Specific proof", status: "pass" }],
    counts: { flagged: 1, nudges: 1, onPoint: 1 },
    expanded: false,
    previewMode: true,
    sections: [
      {
        title: "Worth a look",
        items: [{ id: "length", label: "Too long for the format", status: "fail" }],
      },
      {
        title: "Nudges",
        items: [{ id: "hook", label: "Strong hook", status: "warn" }],
      },
      {
        title: "On point",
        items: [{ id: "specificity", label: "Specific proof", status: "pass" }],
      },
    ],
    learnings: [],
    learningCaveat: "Static rule check. Imported performance data is not connected yet.",
    hiddenChecks: 0,
    helperText: "Signals, not verdicts.",
    footerText: "Static heuristic checks only.",
  },
  prediction: {
    status: "available",
    signals: [{ signal_key: "quality_voice", label: "Static score 72", multiplier: 0.8 }],
    predictedMidImpressions: 230,
    stallRange: { low: 120, high: 276 },
    escapeRange: { low: 570, high: 2280 },
    escapeProbability: 0.1,
    expectedReplies: 3,
    baseImpressions: 190,
    baseSource: "follower_estimate",
    qualityBasis: "static",
    reachModelVersion: "reach-v1",
  },
  heuristicLabel: "Heuristic rank, not prediction.",
  analyzedAt: "2026-06-07T12:00:00.000Z",
  analyzerVersion: "deterministic-v1",
  cooldown: {
    format: "genuine_question",
    countInWindow: 2,
    windowDays: 7,
    status: "warming",
    message: "Posted this format twice this week.",
  },
};

/** Ready: the static engine returned a full scored item. */
export const readyState: AnalyzeState = { status: "ready", result: readyResult };

/**
 * The `disabled` / `missing_followers` reach variant. Spread from `readyResult`
 * so everything else stays identical and only `prediction` changes — exactly the
 * shape the "no follower data" reach-block test exercises. The `message` field
 * is REQUIRED by `disabledEngagementPredictionSchema`.
 */
export const missingFollowersPrediction: EngagementPrediction = {
  status: "disabled",
  reason: "missing_followers",
  message: "Add your follower count to see a reach prediction.",
};

/** A scored item whose prediction is disabled for missing followers. */
export const missingFollowersResult: ScoredPostItem = {
  ...readyResult,
  prediction: missingFollowersPrediction,
};

/** Ready state whose result has a disabled (missing-followers) prediction. */
export const missingFollowersState: AnalyzeState = {
  status: "ready",
  result: missingFollowersResult,
};
