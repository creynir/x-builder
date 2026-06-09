import type { VoiceCheck } from "./voice-check.js";

export type PostFormat =
  | "one_liner"
  | "genuine_question"
  | "hot_take"
  | "audience_question"
  | "story"
  | "insight_share"
  | "goal_share"
  | "ab_choice"
  | "connect"
  | "other";

export type PostHistoryEntry = {
  format: string;
  at: string;
  kind?: string;
};

export type RecordPostHistoryEntryInput = {
  format: PostFormat;
  kind?: string;
};

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

export type EngagementPrediction = {
  rangeLow: number;
  rangeHigh: number;
  midpoint: number;
  confidence: "low" | "medium" | "high";
  signals: PredictionSignal[];
};

export type AnalyzeOptions = {
  followers?: number;
  aiRating?: number;
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
