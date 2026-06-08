import { runTextEnrichmentChecks } from "./text-enrichment-checks.js";
import type { VoiceCheck } from "./voice-check.js";

export type { CheckStatus, VoiceCheck } from "./voice-check.js";

export type Format =
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

export type PostHistoryItem = {
  format: string;
  at: string;
  kind?: string;
};

export type RecordPostHistoryInput = {
  format: Format;
  kind?: string;
};

export type Learning = {
  text: string;
  relevance: "matched" | "general";
};

export type Engageability = {
  engageable: boolean;
  reason: string;
};

export type PostScore = {
  value: number;
  checks: VoiceCheck[];
  learnings: Learning[];
  engageability: Engageability;
};

export type PostCoachScore = PostScore;

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
      engageability: Engageability;
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
      learnings: Learning[];
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
  format: Format;
  score: PostScore;
  prediction: EngagementPrediction | null;
};

export type PostCoachCardInput = {
  score: PostCoachScore | null;
  hasText: boolean;
  previewMode?: boolean;
  expanded?: boolean;
};

const buzzwords = [
  "leverage",
  "synergy",
  "circle back",
  "low-hanging fruit",
  "move the needle",
  "paradigm shift",
  "best-in-class",
  "next-level",
  "game-changer",
];

const aiTells = [
  "delve",
  "in today's fast-paced",
  "it's no secret",
  "elevate your",
  "unlock the power",
  "navigate the complexities",
  "embark on",
  "tapestry",
  "realm of",
];

const hedges = [
  "just",
  "really",
  "basically",
  "actually",
  "literally",
];

const allowedAllCaps = [
  "API",
  "MRR",
  "ARR",
  "SaaS",
  "VC",
  "UX",
  "UI",
  "CTA",
  "SEO",
  "CRM",
  "LLM",
  "SDK",
];

const weakOpeners = [
  { pattern: /^just\b/i, phrase: "just" },
  { pattern: /^honestly,?\b/i, phrase: "honestly" },
  { pattern: /^actually,?\b/i, phrase: "actually" },
  { pattern: /^basically,?\b/i, phrase: "basically" },
  { pattern: /^so,?\b/i, phrase: "so" },
  { pattern: /^hey,?\b/i, phrase: "hey" },
  { pattern: /^hi,?\b/i, phrase: "hi" },
  { pattern: /^okay,?\b/i, phrase: "okay" },
  { pattern: /^guys,?\b/i, phrase: "guys" },
  { pattern: /^everyone,?\b/i, phrase: "everyone" },
  { pattern: /^i think\b/i, phrase: "I think" },
  { pattern: /^i feel\b/i, phrase: "I feel" },
  { pattern: /^i just\b/i, phrase: "I just" },
  { pattern: /^i want to share\b/i, phrase: "I want to share" },
  { pattern: /^maybe\b/i, phrase: "maybe" },
  { pattern: /^perhaps\b/i, phrase: "perhaps" },
  { pattern: /^quick (question|thought)\b/i, phrase: "quick thought" },
  { pattern: /^random thought\b/i, phrase: "random thought" },
  { pattern: /^just wondering\b/i, phrase: "just wondering" },
];

const formatMultipliers: Record<Format, number> = {
  one_liner: 0.84,
  genuine_question: 1.05,
  hot_take: 1.16,
  audience_question: 0.99,
  story: 1.18,
  insight_share: 0.95,
  goal_share: 0.99,
  ab_choice: 1.03,
  connect: 1.27,
  other: 1,
};

const formatLabels: Record<Format, string> = {
  one_liner: "One-liner",
  genuine_question: "Question",
  hot_take: "Hot take",
  audience_question: "Audience-Q",
  story: "Story",
  insight_share: "Insight",
  goal_share: "Goal",
  ab_choice: "A/B",
  connect: "Connect",
  other: "Other",
};

const varietyFormatLabels: Record<Format, string> = {
  one_liner: "one-liner",
  genuine_question: "genuine question",
  hot_take: "hot take",
  insight_share: "insight share",
  goal_share: "goal share",
  story: "story",
  ab_choice: "A/B choice",
  audience_question: "audience question",
  connect: "connect invite",
  other: "post",
};

const trendingTerms = [
  "ai",
  "agi",
  "gpt",
  "claude",
  "agent",
  "agents",
  "founder",
  "founders",
  "indie",
  "solo",
  "distribution",
  "audience",
  "growth",
  "shipping",
  "shipped",
  "launch",
  "launched",
];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function nonEmptyLines(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

export function recordPostHistory(
  history: readonly PostHistoryItem[],
  input: RecordPostHistoryInput,
  at: Date = new Date(),
): PostHistoryItem[] {
  return [
    {
      ...input,
      at: at.toISOString(),
    },
    ...history,
  ].slice(0, 10);
}

export function streakForFormat(
  history: readonly PostHistoryItem[],
  format: Format,
  limit = 3,
): number {
  if (format === "other") {
    return 0;
  }

  const recent = history.slice(0, limit);
  let streak = 0;

  for (const item of recent) {
    if (item.format === format) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export function createVarietyCheck(
  text: string,
  history: readonly PostHistoryItem[] = [],
): VoiceCheck | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const format = detectFormat(trimmed);

  if (format === "other") {
    return {
      id: "variety",
      label: "Format mix",
      status: "pass",
    };
  }

  const rowCount = streakForFormat(history, format, 3) + 1;
  const label = varietyFormatLabels[format];

  return {
    id: "variety",
    label:
      rowCount === 1
        ? `Format mix (${label})`
        : rowCount === 2
          ? `2nd ${label} in a row - consider mixing it up`
          : `${rowCount} ${label}s in a row - mix it up`,
    status:
      rowCount >= 3
        ? "fail"
        : rowCount === 2
          ? "warn"
          : "pass",
  };
}

export function detectFormat(text: string): Format {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) {
    return "other";
  }

  if (
    lower.startsWith("hot take:") ||
    lower.startsWith("unpopular opinion:") ||
    lower.startsWith("popular opinion:") ||
    lower.startsWith("real talk:")
  ) {
    return "hot_take";
  }

  if (lower.startsWith("genuine question:")) {
    return "genuine_question";
  }

  if (/^(founders|builders|creators|solo founders|indie hackers|makers),/i.test(trimmed)) {
    return "audience_question";
  }

  const lines = nonEmptyLines(trimmed);

  if (lines.length >= 3 && /\b(i|my|we)\b/i.test(trimmed)) {
    return "story";
  }

  if (/^[-*]\s+/m.test(trimmed) && lines.length <= 5) {
    return "ab_choice";
  }

  if (/(drop your handle|comment what you|let'?s connect|reply with)/i.test(trimmed)) {
    return "connect";
  }

  if (trimmed.endsWith("?") && lines.length <= 3) {
    return "genuine_question";
  }

  if (/(my goal|aiming to|by end of|i'?m going to)/i.test(trimmed) && /\d/.test(trimmed)) {
    return "goal_share";
  }

  if (lines.length === 1 && wordCount(trimmed) <= 15) {
    return "one_liner";
  }

  return "insight_share";
}

function runQualityChecks(input: {
  trimmed: string;
  lower: string;
  lines: string[];
  wordCount: number;
}): VoiceCheck[] {
  const { trimmed, lower, lines, wordCount } = input;
  const hasPrefix =
    /^(hot take|genuine question|popular opinion|unpopular opinion|real talk|fun fact|reminder):/i.test(trimmed);
  const hasAudienceOpener =
    /^(founders|builders|creators|solo founders|indie hackers|makers|operators|marketers),/i.test(trimmed);
  const digitLed = /^\d+\b/.test(trimmed);
  const questionOpener =
    /^(are you|name a|name one|why does|what does|what's the|who else|how many)\b/i.test(trimmed);
  const endsQuestion = trimmed.endsWith("?");
  const hasHook =
    hasPrefix ||
    hasAudienceOpener ||
    digitLed ||
    questionOpener ||
    endsQuestion;
  const hasContrast =
    /\b(but|yet|never|actually|instead|however|rather|despite|even if|until)\b/i.test(trimmed);
  const hasComparison =
    /\b(over|than|vs\.?|versus|beats|outperforms?)\b/i.test(trimmed);
  const hasExpectation =
    /\b(supposed to|used to|thought)\b/i.test(lower);
  const multiLineTurn = lines.length >= 2 && (hasContrast || hasComparison);
  const hasTension =
    hasContrast ||
    hasExpectation ||
    multiLineTurn;
  const hasProperNoun =
    /\b[A-Z][a-z]{2,}\b/.test(trimmed.replace(/^[A-Z]/, ""));
  const hasNumber = /\d/.test(trimmed);
  const hasSpecificTerm = [
    "mrr",
    "arr",
    "launch",
    "ship",
    "shipped",
    "shipping",
    "feature",
    "churn",
    "pricing",
    "oauth",
    "api",
    "saas",
    "vc",
    "seed",
    "angel",
    "pmf",
    "cohort",
    "engagement",
    "retention",
    "cac",
    "ltv",
    "arpu",
  ].some((term) => new RegExp(`\\b${term}\\b`, "i").test(trimmed));
  const hasConcrete =
    hasProperNoun ||
    hasNumber ||
    hasSpecificTerm;
  const oneLineQuotable =
    lines.length === 1 &&
    wordCount <= 12;
  const lastLine = lines[lines.length - 1] ?? "";
  const lastLineWords = lastLine.split(/\s+/).filter(Boolean).length;
  const punchlineEnding =
    lines.length >= 2 &&
    lastLineWords <= 8 &&
    /\b(wins?|loses?|kills?|earns?|compounds?|matters?|works?|fails?|breaks?|builds?|ships?|stops?|begins?)\b/i.test(lastLine);
  const hasQuotable =
    oneLineQuotable ||
    punchlineEnding;
  const hasInsight = [
    /\bi\s+(learned|noticed|realized|figured out|stopped|started)\b/i,
    /\b(most|everyone|nobody|no one)\s+(thinks?|says?|believes?|gets?)\b/i,
    /\bthe\s+(trick|secret|truth|reason|catch|move)\s+is\b/i,
    /\bwhat\s+(nobody|no one|most people)\s+(tells?|knows?|sees?)\b/i,
    /\bturns? out\b/i,
  ].some((rx) => rx.test(trimmed));
  const hasValue = [
    /\bhere'?s\s+(how|why|what|the)\b/i,
    /\b(steps?|tips?|ways?|reasons?|things?|rules?|lessons?)\b/i,
    /^\d+\s+(steps?|tips?|ways?|reasons?|things?|rules?|lessons?|mistakes?)\b/i,
    /\b(do\s+this|try\s+this|stop|start)\b/i,
  ].some((rx) => rx.test(trimmed));
  const hasHumor = [
    /\b(me:|also me:|narrator:)\b/i,
    /\b(somehow|apparently|allegedly|but ok|fine)\b/i,
    /[!]{1,}/,
    /\b(literally|legit|fr|tbh)\b/i,
    /\b(my brain|my dumb|my idiot|future me|past me)\b/i,
  ].some((rx) => rx.test(trimmed));
  const hasProof = [
    /\bfrom\s+\d+.{0,10}to\s+\d+/i,
    /\d+\s*(%|x|usd|\$|followers?|mrr|arr|replies|impressions?)/i,
    /\bin\s+(\d+|a|one|two|three)\s+(days?|weeks?|months?|years?)\b/i,
    /\blast\s+(week|month|year|quarter)\b/i,
  ].some((rx) => rx.test(trimmed));
  const valueParts: string[] = [];

  if (hasInsight) {
    valueParts.push("insight");
  }

  if (hasValue) {
    valueParts.push("value");
  }

  if (hasHumor) {
    valueParts.push("humor");
  }

  if (hasProof) {
    valueParts.push("proof");
  }

  const hasValueAdd = valueParts.length > 0;
  const nonEmptyLineCount = trimmed
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  const hasBlankLine = /\n\s*\n/.test(trimmed);
  const breathingFail = nonEmptyLineCount >= 2 && !hasBlankLine;

  return [
    {
      id: "quality_hook",
      kind: "quality",
      label: hasHook
        ? "Strong hook opener"
        : "Hook opener missing (try a lowercase prefix, audience-name, or question)",
      status: hasHook ? "pass" : "fail",
    },
    {
      id: "quality_tension",
      kind: "quality",
      label: hasTension
        ? "Has tension or contrast"
        : "No tension - add a contradiction, reversal, or comparison",
      status: hasTension ? "pass" : "fail",
    },
    {
      id: "quality_concrete",
      kind: "quality",
      label: hasConcrete
        ? "Concrete specifics"
        : "Too abstract - add a number, name, or specific term",
      status: hasConcrete ? "pass" : "fail",
    },
    {
      id: "quality_quotable",
      kind: "quality",
      label: hasQuotable
        ? "Quotable structure"
        : "Not yet quotable - tighten to <=12 words or end on a punchline",
      status: hasQuotable ? "pass" : "fail",
    },
    {
      id: "quality_value",
      kind: "quality",
      label: hasValueAdd
        ? `Carries ${valueParts.join(" + ")}`
        : "No clear value-add yet (insight, value, humor, or proof)",
      status: hasValueAdd ? "pass" : "fail",
    },
    {
      id: "quality_breathing",
      kind: "quality",
      label: breathingFail
        ? "Add a blank line between thoughts (breathing room)"
        : nonEmptyLineCount >= 2
          ? "Breathing room between thoughts"
          : "One-liner (breathing room n/a)",
      status: breathingFail ? "fail" : "pass",
    },
    {
      id: "quality_question",
      kind: "quality",
      label: endsQuestion
        ? "Ends on a question (drives replies)"
        : "No question to bait replies",
      status: endsQuestion ? "pass" : "fail",
    },
    ...runTextEnrichmentChecks({
      trimmed,
      lines,
      wordCount,
    }),
  ];
}

function analyzeEngageability(trimmed: string, lines: string[]): Engageability {
  if (trimmed.length === 0) {
    return {
      engageable: false,
      reason: "Start typing to see how engageable this is.",
    };
  }

  const prefixMatch =
    /^(hot take|genuine question|popular opinion|unpopular opinion|real talk|fun fact|reminder):\s*/i.exec(trimmed);

  if (prefixMatch) {
    const prefix = prefixMatch[1]?.toLowerCase() ?? "";
    const rest = trimmed.slice(prefixMatch[0].length).trim();

    if (rest.length === 0) {
      return {
        engageable: false,
        reason: `"${prefix}:" prefix used, but the post has no content after the prefix - drop the prefix or change the content to match.`,
      };
    }

    if (prefix === "genuine question") {
      const hasQuestionMark = rest.includes("?");
      const readsLikeQuestion =
        /\b(why|how|what|when|where|who|which|does|do|did|is|are|was|were|can|should|would|will)\b/i.test(rest);

      if (!hasQuestionMark) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post isn't actually a question (no '?') - drop the prefix or change the content to match.`,
        };
      }

      if (!readsLikeQuestion) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post doesn't read as a real question - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    if (
      prefix === "hot take" ||
      prefix === "unpopular opinion" ||
      prefix === "popular opinion" ||
      prefix === "real talk"
    ) {
      const readsLikeTake =
        /\b(but|not|never|always|every|no one|nobody|everyone|most|actually|instead|over|than|vs\.?|beats|outperforms?|will|won't|stop|skip|forget|kill|nail|crush)\b/i.test(rest);

      if (!readsLikeTake) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post reads as a neutral statement, not an actual take - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    if (prefix === "fun fact") {
      const hasFact = /\d/.test(rest) || /\b[A-Z][a-z]{2,}\b/.test(rest);

      if (!hasFact) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post has no specific fact (number, name, or proper noun) - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    if (prefix === "reminder") {
      const addressesReader =
        /\b(you|your|don't|stop|start|remember|always|never|keep|drop|skip|forget)\b/i.test(rest);

      if (!addressesReader) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post doesn't address the reader as a reminder - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    return {
      engageable: true,
      reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
    };
  }

  if (/^(founders|builders|creators|solo founders|indie hackers|makers|operators|marketers),/i.test(trimmed)) {
    return {
      engageable: true,
      reason: "Audience-named opener - calls a group directly.",
    };
  }

  if (/^(are you|name a|name one|why does|what does|what's the|who else|how many)\b/i.test(trimmed)) {
    return {
      engageable: true,
      reason: "Prompt opener - the post asks a direct question.",
    };
  }

  if (trimmed.endsWith("?")) {
    return {
      engageable: true,
      reason: "Ends on a question - reply-friendly by design.",
    };
  }

  if (/(drop your handle|comment what|reply with|tell me|let me know|share your)/i.test(trimmed)) {
    return {
      engageable: true,
      reason: "Explicit ask - readers know exactly what to do.",
    };
  }

  if (
    /\d/.test(trimmed) &&
    /\b(today|yesterday|this week|this month|just|finally|shipped|launched|hit|crossed|reached|passed|joined|started|done|released)\b/i.test(trimmed) &&
    trimmed.length < 240
  ) {
    return {
      engageable: true,
      reason: "Milestone moment - readers react to journey, not just info.",
    };
  }

  const hasContrast =
    /\b(but|yet|never|actually|instead|however|rather|despite|even if|until|supposed to|used to)\b/i.test(trimmed);

  if (lines.length >= 2 && hasContrast) {
    return {
      engageable: true,
      reason: "Contrast across lines - drives quotes + saves.",
    };
  }

  return {
    engageable: false,
    reason:
      'No clear engagement hook. Add a "hot take:" / "genuine question:" prefix, end on a question, share a milestone moment, or call out an audience.',
  };
}

function getLearnings(input: {
  trimmed: string;
  wordCount: number;
  lines: number;
}): Learning[] {
  const { trimmed, wordCount, lines } = input;
  const learnings: Learning[] = [];

  if (wordCount > 0 && wordCount <= 12 && lines === 1) {
    learnings.push({
      text: "Your one-liners under 12 words get 40% more replies than longer posts.",
      relevance: "matched",
    });
  }

  if (/^hot take:/i.test(trimmed)) {
    learnings.push({
      text: '"hot take:" openers drove your highest like-to-reply ratio in the last 30 days.',
      relevance: "matched",
    });
  }

  if (/^genuine question:/i.test(trimmed)) {
    learnings.push({
      text: 'Your last 3 "genuine question:" posts averaged 92 replies - your top format.',
      relevance: "matched",
    });
  }

  if (/^(founders|builders|solo founders|creators|indie hackers|makers),/i.test(trimmed)) {
    learnings.push({
      text: "Audience-name openers drive 2x replies for you vs unaddressed posts.",
      relevance: "matched",
    });
  }

  if (lines >= 3) {
    learnings.push({
      text: "Posts with 3+ lines get 3.2x more impressions in your data.",
      relevance: "matched",
    });
  }

  if (wordCount > 30) {
    learnings.push({
      text: "Your posts under 30 words outperform longer ones by 1.8x on engagement rate.",
      relevance: "matched",
    });
  }

  if (learnings.length === 0) {
    learnings.push({
      text: 'Your top 3 posts all opened with "genuine question:" - worth trying that here.',
      relevance: "general",
    });
  }

  return learnings.slice(0, 2);
}

export function runVoiceChecks(
  text: string,
  options: Pick<AnalyzeOptions, "enabled" | "varietyCheck"> = {},
): PostScore {
  const trimmed = text.trim();
  const empty = trimmed.length === 0;
  const lower = trimmed.toLowerCase();
  const lines = nonEmptyLines(trimmed);
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const charCount = trimmed.length;
  const tooShort = !empty && (words < 4 || charCount < 15);
  const thin = !empty && !tooShort && (words < 7 || charCount < 30);
  const hasDash =
    trimmed.includes(String.fromCharCode(8212)) ||
    trimmed.includes(String.fromCharCode(8211));
  const weakCloser =
    /\bthoughts\??$/i.test(trimmed) ||
    /\bagree\??$/i.test(trimmed);
  const buzzword = buzzwords.find((word) => lower.includes(word));
  const aiTell = aiTells.find((phrase) => lower.includes(phrase));
  const hashtagCount = (trimmed.match(/#\w+/g) ?? []).length;
  const allCapsCount = (trimmed.match(/\b[A-Z]{3,}\b/g) ?? [])
    .filter((word) => !allowedAllCaps.includes(word))
    .length;
  const spammyPunctuation =
    /!{3,}/.test(trimmed) ||
    /\?{3,}/.test(trimmed) ||
    /[!?]{4,}/.test(trimmed);
  const weakOpener = weakOpeners.find((item) => item.pattern.test(trimmed));
  const singleLineLong =
    lines.length === 1 &&
    words > 15;
  const hedgeCount = lower
    .split(/[^a-z']+/)
    .filter((token) => hedges.includes(token))
    .length;
  const rawLineCount = empty ? 0 : trimmed.split("\n").length;
  const expandZone = !empty && rawLineCount === 15;
  const baseChecks: VoiceCheck[] = [
    {
      id: "substance",
      label: tooShort
        ? "Too short - add a complete thought"
        : thin
          ? "A bit thin - more substance would help"
          : "Has enough substance",
      status: empty ? "warn" : tooShort ? "fail" : thin ? "warn" : "pass",
    },
    {
      id: "em_dash",
      label: "No em-dashes",
      status: empty ? "pass" : hasDash ? "fail" : "pass",
    },
    {
      id: "weak_closer",
      label: 'No weak closer ("thoughts?", "agree?")',
      status: empty ? "pass" : weakCloser ? "fail" : "pass",
    },
    {
      id: "buzzwords",
      label: buzzword ? `Drop the buzzword: "${buzzword}"` : "No corporate buzzwords",
      status: empty ? "pass" : buzzword ? "fail" : "pass",
    },
    {
      id: "ai_tells",
      label: aiTell ? `Sounds AI-written: "${aiTell}"` : "No AI-tell phrases",
      status: empty ? "pass" : aiTell ? "fail" : "pass",
    },
    {
      id: "hashtags",
      label: hashtagCount > 2
        ? `Too many hashtags (${hashtagCount}, max 2)`
        : "Hashtag use is restrained",
      status: empty ? "pass" : hashtagCount > 2 ? "fail" : "pass",
    },
    {
      id: "shouting",
      label: allCapsCount > 0
        ? `Watch ALL CAPS (${allCapsCount} all-caps word${allCapsCount === 1 ? "" : "s"} - intentional?)`
        : "No SHOUTING",
      status: empty ? "pass" : allCapsCount > 0 ? "warn" : "pass",
    },
    {
      id: "spammy_punct",
      label: spammyPunctuation
        ? 'Spammy punctuation (cut "!!!" / "???")'
        : "No spammy punctuation",
      status: empty ? "pass" : spammyPunctuation ? "warn" : "pass",
    },
    {
      id: "direct_opener",
      label: weakOpener
        ? `Drops a weak opener: "${weakOpener.phrase}"`
        : "Direct opener",
      status: empty || weakOpener ? "warn" : "pass",
    },
    {
      id: "rhythm",
      label: singleLineLong
        ? "Try a hard line break for rhythm"
        : "Rhythm reads well",
      status: empty || singleLineLong ? "warn" : "pass",
    },
    {
      id: "expand_zone",
      label: expandZone
        ? 'Cut 1 line - 15 hides behind "show more", 14 shows in full'
        : "Clear of X's expand cutoff",
      status: empty ? "pass" : expandZone ? "warn" : "pass",
    },
    {
      id: "word_count",
      label: words > 30
        ? `Long for X (${words} words, aim for <= 30)`
        : "Tight word count",
      status: empty || words > 30 || tooShort ? "warn" : "pass",
    },
    {
      id: "hedges",
      label: hedgeCount > 2
        ? `Cut hedge words (${hedgeCount} found: just/really/basically/...)`
        : "Few hedge words",
      status: empty || hedgeCount > 2 ? "warn" : "pass",
    },
  ];
  const checksBeforeFilter = [
    ...baseChecks,
    ...(empty || !options.varietyCheck ? [] : [options.varietyCheck]),
    ...(empty
      ? []
      : runQualityChecks({
          trimmed,
          lower,
          lines,
          wordCount: words,
        })),
  ];
  const checks = options.enabled
    ? checksBeforeFilter.filter((check) => options.enabled?.[check.id] !== false)
    : checksBeforeFilter;
  const engageability = analyzeEngageability(trimmed, lines);
  if (empty) {
    return {
      value: 0,
      checks,
      learnings: [],
      engageability,
    };
  }

  const nonQualityChecks = checks.filter((check) => check.kind !== "quality");
  const qualityChecks = checks.filter((check) => check.kind === "quality");
  const nonQualityPoints = nonQualityChecks.reduce((sum, check) => {
    if (check.status === "pass") {
      return sum + 1;
    }

    if (check.status === "warn") {
      return sum + 0.5;
    }

    return sum;
  }, 0);
  const nonQualityScore =
    nonQualityChecks.length === 0
      ? 100
      : Math.round((nonQualityPoints / nonQualityChecks.length) * 100);
  const qualityPasses = qualityChecks.filter((check) => check.status === "pass").length;
  const qualityScore =
    qualityChecks.length === 0
      ? 100
      : Math.round(40 + (qualityPasses / qualityChecks.length) * 60);
  let value = Math.min(nonQualityScore, qualityScore);

  if (tooShort) {
    value = Math.min(value, 25);
  } else if (thin) {
    value = Math.min(value, 65);
  }

  return {
    value,
    checks,
    learnings: getLearnings({
      trimmed,
      wordCount: words,
      lines: lines.length,
    }),
    engageability,
  };
}

function getQualityMultiplier(score: number, aiRating?: number): {
  signalKey: string;
  label: string;
  multiplier: number;
} {
  if (typeof aiRating === "number") {
    const multiplier =
      aiRating >= 10 ? 5 :
      aiRating >= 9 ? 3.5 :
      aiRating >= 8 ? 2.4 :
      aiRating >= 7 ? 1.6 :
      aiRating >= 6 ? 1.1 :
      aiRating >= 5 ? 0.85 :
      aiRating >= 4 ? 0.6 :
      0.35;

    return {
      signalKey: "quality_ai_rating",
      label: `AI rating ${aiRating}/10`,
      multiplier,
    };
  }

  const multiplier =
    score >= 90 ? 4 :
    score >= 80 ? 2.2 :
    score >= 70 ? 1.4 :
    score >= 50 ? 0.7 :
    0.35;

  return {
    signalKey: "quality_voice",
    label: `Voice score ${score}`,
    multiplier,
  };
}

export function predictEngagement(input: {
  text: string;
  score: number;
  format: Format;
  followers?: number;
  aiRating?: number;
}): EngagementPrediction | null {
  const {
    text,
    score,
    format,
    followers = 1000,
    aiRating,
  } = input;
  const trimmed = text.trim();

  if (trimmed.length < 15) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  const signals: PredictionSignal[] = [];
  const base = 400 * Math.min(10, Math.max(0.2, followers / 1000));
  const quality = getQualityMultiplier(score, aiRating);

  if (quality.multiplier !== 1) {
    signals.push({
      signal_key: quality.signalKey,
      label: `${quality.label} (${quality.multiplier > 1 ? "+" : "-"}${Math.round(
        Math.abs(quality.multiplier - 1) * 100,
      )}%)`,
      multiplier: quality.multiplier,
    });
  }

  const formatMultiplier = formatMultipliers[format] ?? 1;

  if (formatMultiplier !== 1) {
    signals.push({
      signal_key: `format_${format}`,
      label: `${formatLabels[format] ?? "Other"} format ${
        formatMultiplier > 1 ? "+" : ""
      }${Math.round((formatMultiplier - 1) * 100)}%`,
      multiplier: formatMultiplier,
    });
  }

  const trendCount = trendingTerms.filter((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(lower),
  ).length;

  if (trendCount > 0) {
    const trendMultiplier = 1 + Math.min(0.4, 15 * trendCount);

    signals.push({
      signal_key: "zeitgeist",
      label: `Timely keyword +${Math.round((trendMultiplier - 1) * 100)}%`,
      multiplier: trendMultiplier,
    });
  }

  if (/\b(but|yet|never|actually|instead|however|rather|despite|supposed to)\b/i.test(trimmed)) {
    signals.push({
      signal_key: "tension_contradiction",
      label: "Tension / contradiction +25%",
      multiplier: 1.25,
    });
  }

  const midpointRaw = signals.reduce(
    (value, signal) => value * signal.multiplier,
    base,
  );
  const uncertainty =
    signals.length >= 4 ? 0.25 :
    signals.length >= 2 ? 0.4 :
    0.6;
  const hasAiRating = typeof aiRating === "number";
  const confidence =
    (hasAiRating && signals.length >= 3) || (signals.length >= 4 && score >= 70)
      ? "high"
      : (hasAiRating && signals.length >= 1) || (signals.length >= 2 && score >= 50)
        ? "medium"
        : "low";

  return {
    rangeLow: Math.round(midpointRaw * (1 - uncertainty)),
    rangeHigh: Math.round(midpointRaw * (1 + uncertainty)),
    midpoint: Math.round(midpointRaw),
    confidence,
    signals,
  };
}

export function getPostCoachBadge(scoreValue: number): PostCoachBadge {
  if (scoreValue >= 85) {
    return {
      label: "Top tier",
      tone: "top",
      tooltip: "Rare. Don't chase this - 60+ is already ship-ready.",
    };
  }

  if (scoreValue >= 60) {
    return {
      label: "Ship it",
      tone: "ship",
      tooltip: "Solid post. Ship it - higher scores are a bonus, not the goal.",
    };
  }

  if (scoreValue >= 45) {
    return {
      label: "Almost there",
      tone: "almost",
      tooltip: "A few tweaks away from ship-ready (60+).",
    };
  }

  return {
    label: "Rework",
    tone: "rework",
    tooltip: "Rework needed before this is ship-ready (60+).",
  };
}

export function derivePostCoachCard({
  score,
  hasText,
  previewMode = false,
  expanded = false,
}: PostCoachCardInput): PostCoachViewModel {
  if (!hasText || !score) {
    return {
      state: "empty",
      title: "Post Coach",
      message:
        "Start typing to see how the draft scores against your voice rules plus learnings from your last 30 days.",
    };
  }

  const badge = getPostCoachBadge(score.value);
  const failed = score.checks.filter((check) => check.status === "fail");
  const warned = score.checks.filter((check) => check.status === "warn");
  const passed = score.checks.filter((check) => check.status === "pass");
  const helperText =
    "Signals, not verdicts. These checks flag patterns worth weighing - none of them are rules you have to follow. 60+ usually reads ship-ready; the goal is the post, not the score.";
  const footerText =
    "These are static rule checks - good for spotting obvious misses and reminding you of the principles. For whether the post actually delivers insight, humor, or real value, use the AI Rate post action above the composer - the LLM is much better at that judgment.";

  if (previewMode) {
    const sampleItems = [...failed, ...warned, ...passed].slice(0, 2);
    const hiddenChecks = score.checks.length - sampleItems.length;

    return {
      state: "ready",
      title: "Post Coach",
      value: score.value,
      badge,
      target: 60,
      engageability: score.engageability,
      failed,
      warned,
      passed,
      counts: {
        flagged: failed.length,
        nudges: warned.length,
        onPoint: passed.length,
      },
      expanded: false,
      previewMode: true,
      sections: sampleItems.length > 0
        ? [{ title: "Sample", items: sampleItems }]
        : [],
      learnings: [],
      hiddenChecks,
      helperText,
      footerText,
    };
  }

  const sections: PostCoachSection[] = [];

  if (expanded) {
    if (failed.length > 0) {
      sections.push({
        title: "Worth a look",
        items: failed,
      });
    }

    if (warned.length > 0) {
      sections.push({
        title: "Nudges",
        items: warned,
      });
    }

    if (passed.length > 0) {
      sections.push({
        title: "On point",
        items: passed,
      });
    }
  }

  return {
    state: "ready",
    title: "Post Coach",
    value: score.value,
    badge,
    target: 60,
    engageability: score.engageability,
    failed,
    warned,
    passed,
    counts: {
      flagged: failed.length,
      nudges: warned.length,
      onPoint: passed.length,
    },
    expanded,
    previewMode: false,
    sections,
    learnings: expanded ? score.learnings : [],
    hiddenChecks: 0,
    helperText,
    footerText,
  };
}

export function analyzePost(text: string, options: AnalyzeOptions = {}): AnalyzeResult {
  const format = detectFormat(text);
  const score = runVoiceChecks(text, {
    enabled: options.enabled,
    varietyCheck: options.varietyCheck,
  });
  const prediction = predictEngagement({
    text,
    score: score.value,
    format,
    followers: options.followers ?? 1000,
    aiRating: options.aiRating,
  });

  return {
    text,
    format,
    score,
    prediction,
  };
}
