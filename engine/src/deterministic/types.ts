import type { VoiceCheck } from "./voice-check.js";

export type PostFormat =
  | "genuine_question"
  | "hot_take"
  | "audience_question"
  | "story"
  | "insight_share"
  | "ab_choice"
  | "connect"
  | "other"
  | "fill_blank_tribal"
  | "cta_farm"
  | "fantasy_question"
  | "binary_choice"
  | "nuanced_question"
  | "recognition_roast"
  | "wisdom_one_liner"
  | "milestone";

export type ScoreLearning = {
  text: string;
  relevance: "matched" | "general";
};

export type EngagementReadiness = {
  engageable: boolean;
  reason: string;
};

export type DeterministicPostScore = {
  value: number;
  checks: VoiceCheck[];
  learnings: ScoreLearning[];
  engageability: EngagementReadiness;
};

export type PostCoachScore = DeterministicPostScore;

export type PostCoachBadge = {
  label: "Top tier" | "Ship it" | "Almost there" | "Rework";
  tone: "top" | "ship" | "almost" | "rework";
  tooltip: string;
};

export type PostCoachSection = {
  title: "Worth a look" | "Nudges" | "On point" | "Sample";
  items: VoiceCheck[];
};

export type PostCoachViewModel =
  | {
      state: "empty";
      title: "Post Coach";
      message: string;
    }
  | {
      state: "ready";
      title: "Post Coach";
      value: number;
      badge: PostCoachBadge;
      target: 60;
      engageability: EngagementReadiness;
      failed: VoiceCheck[];
      warned: VoiceCheck[];
      passed: VoiceCheck[];
      counts: {
        flagged: number;
        nudges: number;
        onPoint: number;
      };
      expanded: boolean;
      previewMode: boolean;
      sections: PostCoachSection[];
      learnings: ScoreLearning[];
      hiddenChecks: number;
      helperText: string;
      footerText: string;
    };

export type PredictionSignal = {
  signal_key: string;
  label: string;
  multiplier: number;
};

export type ReachRange = {
  low: number;
  high: number;
};

export type EngagementPrediction = {
  // Four-regime reach output (RMU-006).
  predictedMidImpressions: number;
  stallRange: ReachRange;
  escapeRange: ReachRange;
  escapeProbability: number;
  expectedReplies: number;
  baseImpressions: number;
  baseSource: "trailing_median" | "follower_estimate";
  qualityBasis: "static" | "judge";
  reachModelVersion: string;
  signals: PredictionSignal[];
};

export type RepeatHistoryEntry = {
  format: PostFormat;
  lastPostedAt: string;
  countLast7d: number;
};

export type AnalyzeOptions = {
  followers?: number;
  trailingMedianImpressions?: number;
  hasExternalLink?: boolean;
  repeatHistory?: RepeatHistoryEntry[];
  // Pass-2 judge signals (judged impressions/replies). When present they drive
  // the judged-quality reach branch instead of the static-quality path.
  judgeSignals?: { impressions: number; replies: number };
  enabled?: Partial<Record<string, boolean>>;
  varietyCheck?: VoiceCheck;
};

export type AnalyzeResult = {
  text: string;
  format: PostFormat;
  score: DeterministicPostScore;
  prediction: EngagementPrediction | null;
};

export type PostCoachCardInput = {
  score: PostCoachScore | null;
  hasText: boolean;
  previewMode?: boolean;
  expanded?: boolean;
};
