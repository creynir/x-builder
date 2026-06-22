// @x-builder/overlay — MetricExplainer type contract (reconciled MetricKey)
//
// `MetricKey` is the RECONCILED set the overlay actually surfaces, NOT the
// drifted list in the XOB-021 ticket body. The judge (`shared/src/schemas/
// judge.ts` `judgeScoresSchema`) emits exactly 13 dims; the overlay also shows
// two deterministic Post Coach checks and three real reach fields. The explainer
// explains the metrics the user SEES — the friendly framing lives in the COPY
// prose (`copy.ts`), never in invented keys.

/** A metric direction legend: which way is favourable. */
export type GoodDirection = "higher" | "lower" | "poled";

/**
 * Every metric the overlay can explain.
 *
 *  - 13 real judge dimensions (`judgeScoresSchema`)
 *  - 2 deterministic Post Coach checks (`repetition`, `postCoach`)
 *  - 3 real reach fields (`stallRange`, `escapeRange`, `escapeProbability`)
 */
export type MetricKey =
  // 13 real judge dimensions
  | "overall"
  | "replies"
  | "profileClicks"
  | "impressions"
  | "bookmarkValue"
  | "dwellProxy"
  | "voiceMatch"
  | "negativeRisk"
  | "answerEffort"
  | "strangerAnswerability"
  | "statusDependency"
  | "replyVsQuoteOrientation"
  | "audienceMatch"
  // deterministic Post Coach checks
  | "repetition"
  | "postCoach"
  // real reach fields
  | "stallRange"
  | "escapeRange"
  | "escapeProbability";

/** The two-pole scale labels shown beneath a metric explanation. */
export interface ExplainerScale {
  lowLabel: string;
  highLabel: string;
}

/** User-facing copy for a single metric. */
export interface ExplainerEntry {
  label: string;
  whatItMeans: string;
  howToRead: string;
  scale?: ExplainerScale;
  goodDirection: GoodDirection;
}

/** A full copy map — one entry per `MetricKey` (compile-time enforced). */
export type ExplainerSource = Record<MetricKey, ExplainerEntry>;
