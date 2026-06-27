import type { DetectedPostFormat } from "@x-builder/shared";

export type GenerationGuidanceRequest = {
  format: DetectedPostFormat;
  idea?: string;
  voiceProfileId?: string;
  useKnownPostIds: string[];
};

export type FormatPlaybookMapping = Readonly<
  Record<
    DetectedPostFormat,
    {
      sectionIds: string[];
      priority: "primary" | "secondary";
      includeFallbackGeneral: boolean;
    }
  >
>;

export type PlaybookSlice = {
  format: DetectedPostFormat;
  sourcePath?: string;
  sections: Array<{
    id: string;
    heading: string;
    content: string;
    charCount: number;
  }>;
  content: string;
  charCount: number;
  truncated: boolean;
};

export type VoiceSamplePost = {
  id: string;
  platformPostId: string;
  text: string;
  createdAt: string;
  kind: "original";
  source: "known_post_id" | "profile_sample" | "recent_original";
};

export type GenerationContext = {
  request: GenerationGuidanceRequest;
  playbook: PlaybookSlice;
  voiceSamples: VoiceSamplePost[];
  renderedGuidance?: string;
};

export type GenerationGuidanceResolver = (
  request: GenerationGuidanceRequest,
) => Promise<string | undefined>;

type FounderStoryGuardrail = {
  preserveUserSuppliedStakes: true;
  forbidInventedEmotionalContent: true;
};

type FormatPlaybookMappingWithMetadata = FormatPlaybookMapping & {
  readonly founder_story: FormatPlaybookMapping["founder_story"] & {
    readonly founderStoryGuardrail: FounderStoryGuardrail;
  };
};

const baseFormatPlaybookMapping = {
  genuine_question: {
    sectionIds: ["format-taxonomy", "growth-loop", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  hot_take: {
    sectionIds: ["format-taxonomy", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  audience_question: {
    sectionIds: ["format-taxonomy", "growth-loop", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  story: {
    sectionIds: ["format-taxonomy", "core-finding", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  founder_story: {
    sectionIds: ["founder-story", "format-taxonomy", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  insight_share: {
    sectionIds: ["format-taxonomy", "core-finding", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  ab_choice: {
    sectionIds: ["format-taxonomy", "growth-loop"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  connect: {
    sectionIds: ["format-taxonomy", "growth-loop", "graph-quality"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  other: {
    sectionIds: ["general"],
    priority: "secondary",
    includeFallbackGeneral: true,
  },
  fill_blank_tribal: {
    sectionIds: ["format-taxonomy", "core-finding", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  cta_farm: {
    sectionIds: ["format-taxonomy", "growth-loop", "graph-quality"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  fantasy_question: {
    sectionIds: ["format-taxonomy", "growth-loop"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  binary_choice: {
    sectionIds: ["format-taxonomy", "growth-loop"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  nuanced_question: {
    sectionIds: ["format-taxonomy", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  recognition_roast: {
    sectionIds: ["format-taxonomy", "core-finding", "daily-playbook"],
    priority: "primary",
    includeFallbackGeneral: false,
  },
  wisdom_one_liner: {
    sectionIds: ["format-taxonomy", "status-gate"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
  milestone: {
    sectionIds: ["format-taxonomy", "growth-loop", "graph-quality"],
    priority: "secondary",
    includeFallbackGeneral: false,
  },
} as const satisfies FormatPlaybookMapping;

export const formatPlaybookMapping = {
  ...baseFormatPlaybookMapping,
  founder_story: {
    ...baseFormatPlaybookMapping.founder_story,
    founderStoryGuardrail: {
      preserveUserSuppliedStakes: true,
      forbidInventedEmotionalContent: true,
    },
  },
} as const satisfies FormatPlaybookMappingWithMetadata;
