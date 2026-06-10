import {
  allowedAcronyms,
  corporateBuzzwords,
  generatedWritingTells,
  hedgeWords,
  weakOpeningPhrases,
} from "./rule-lexicon.js";
import { countRawLines } from "./text-metrics.js";
import { evaluateQualitySignalChecks } from "./quality-signal-checks.js";
import type { VoiceCheck } from "./voice-check.js";

function evaluateHighIntentChecks(input: {
  trimmedText: string;
  lowerText: string;
  visibleLines: string[];
  draftWordCount: number;
}): VoiceCheck[] {
  const { trimmedText, lowerText, visibleLines, draftWordCount } = input;
  const hasPrefix =
    /^(hot take|genuine question|popular opinion|unpopular opinion|real talk|fun fact|reminder):/i.test(trimmedText);
  const hasAudienceOpener =
    /^(founders|builders|creators|solo founders|indie hackers|makers|operators|marketers),/i.test(trimmedText);
  const startsWithNumber = /^\d+\b/.test(trimmedText);
  const hasQuestionOpener =
    /^(are you|name a|name one|why does|what does|what's the|who else|how many)\b/i.test(trimmedText);
  const endsWithQuestion = trimmedText.endsWith("?");
  const hasHook =
    hasPrefix ||
    hasAudienceOpener ||
    startsWithNumber ||
    hasQuestionOpener ||
    endsWithQuestion;
  const hasContrast =
    /\b(but|yet|never|actually|instead|however|rather|despite|even if|until)\b/i.test(trimmedText);
  const hasComparison =
    /\b(over|than|vs\.?|versus|beats|outperforms?)\b/i.test(trimmedText);
  const hasExpectation =
    /\b(supposed to|used to|thought)\b/i.test(lowerText);
  const hasMultiLineTurn = visibleLines.length >= 2 && (hasContrast || hasComparison);
  const hasTension =
    hasContrast ||
    hasExpectation ||
    hasMultiLineTurn;
  const hasProperNoun =
    /\b[A-Z][a-z]{2,}\b/.test(trimmedText.replace(/^[A-Z]/, ""));
  const hasNumber = /\d/.test(trimmedText);
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
  ].some((term) => new RegExp(`\\b${term}\\b`, "i").test(trimmedText));
  const hasConcreteDetail =
    hasProperNoun ||
    hasNumber ||
    hasSpecificTerm;
  const oneLineQuotable =
    visibleLines.length === 1 &&
    draftWordCount <= 12;
  const finalLine = visibleLines[visibleLines.length - 1] ?? "";
  const finalLineWords = finalLine.split(/\s+/).filter(Boolean).length;
  const hasPunchlineEnding =
    visibleLines.length >= 2 &&
    finalLineWords <= 8 &&
    /\b(wins?|loses?|kills?|earns?|compounds?|matters?|works?|fails?|breaks?|builds?|ships?|stops?|begins?)\b/i.test(finalLine);
  const hasQuotableShape =
    oneLineQuotable ||
    hasPunchlineEnding;
  const hasInsight = [
    /\bi\s+(learned|noticed|realized|figured out|stopped|started)\b/i,
    /\b(most|everyone|nobody|no one)\s+(thinks?|says?|believes?|gets?)\b/i,
    /\bthe\s+(trick|secret|truth|reason|catch|move)\s+is\b/i,
    /\bwhat\s+(nobody|no one|most people)\s+(tells?|knows?|sees?)\b/i,
    /\bturns? out\b/i,
  ].some((pattern) => pattern.test(trimmedText));
  const hasPracticalValue = [
    /\bhere'?s\s+(how|why|what|the)\b/i,
    /\b(steps?|tips?|ways?|reasons?|things?|rules?|lessons?)\b/i,
    /^\d+\s+(steps?|tips?|ways?|reasons?|things?|rules?|lessons?|mistakes?)\b/i,
    /\b(do\s+this|try\s+this|stop|start)\b/i,
  ].some((pattern) => pattern.test(trimmedText));
  const hasHumor = [
    /\b(me:|also me:|narrator:)\b/i,
    /\b(somehow|apparently|allegedly|but ok|fine)\b/i,
    /[!]{1,}/,
    /\b(literally|legit|fr|tbh)\b/i,
    /\b(my brain|my dumb|my idiot|future me|past me)\b/i,
  ].some((pattern) => pattern.test(trimmedText));
  const hasProof = [
    /\bfrom\s+\d+.{0,10}to\s+\d+/i,
    /\d+\s*(%|x|usd|\$|followers?|mrr|arr|replies|impressions?)/i,
    /\bin\s+(\d+|a|one|two|three)\s+(days?|weeks?|months?|years?)\b/i,
    /\blast\s+(week|month|year|quarter)\b/i,
  ].some((pattern) => pattern.test(trimmedText));
  const valueSignals: string[] = [];

  if (hasInsight) {
    valueSignals.push("insight");
  }

  if (hasPracticalValue) {
    valueSignals.push("value");
  }

  if (hasHumor) {
    valueSignals.push("humor");
  }

  if (hasProof) {
    valueSignals.push("proof");
  }

  const hasValueSignal = valueSignals.length > 0;
  const nonEmptyLineCount = trimmedText
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  const hasBlankLine = /\n\s*\n/.test(trimmedText);
  const needsBreathingRoom = nonEmptyLineCount >= 2 && !hasBlankLine;

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
      label: hasConcreteDetail
        ? "Concrete specifics"
        : "Too abstract - add a number, name, or specific term",
      status: hasConcreteDetail ? "pass" : "fail",
    },
    {
      id: "quality_quotable",
      kind: "quality",
      label: hasQuotableShape
        ? "Quotable structure"
        : "Not yet quotable - tighten to <=12 words or end on a punchline",
      status: hasQuotableShape ? "pass" : "fail",
    },
    {
      id: "quality_value",
      kind: "quality",
      label: hasValueSignal
        ? `Carries ${valueSignals.join(" + ")}`
        : "No clear value-add yet (insight, value, humor, or proof)",
      status: hasValueSignal ? "pass" : "fail",
    },
    {
      id: "quality_breathing",
      kind: "quality",
      label: needsBreathingRoom
        ? "Add a blank line between thoughts (breathing room)"
        : nonEmptyLineCount >= 2
          ? "Breathing room between thoughts"
          : "One-liner (breathing room n/a)",
      status: needsBreathingRoom ? "fail" : "pass",
    },
    {
      id: "quality_question",
      kind: "quality",
      label: endsWithQuestion
        ? "Ends on a question (drives replies)"
        : "No question to bait replies",
      status: endsWithQuestion ? "pass" : "fail",
    },
    ...evaluateQualitySignalChecks({
      trimmed: trimmedText,
      lines: visibleLines,
      wordCount: draftWordCount,
    }),
  ];
}

export function evaluateWritingChecks(input: {
  trimmedText: string;
  lowerText: string;
  visibleLines: string[];
  draftWordCount: number;
  characterCount: number;
  isEmpty: boolean;
  isTooShort: boolean;
  isThin: boolean;
  varietyCheck?: VoiceCheck;
}): VoiceCheck[] {
  const {
    trimmedText,
    lowerText,
    visibleLines,
    draftWordCount,
    isEmpty,
    isTooShort,
    isThin,
    varietyCheck,
  } = input;
  const hasDash =
    trimmedText.includes(String.fromCharCode(8212)) ||
    trimmedText.includes(String.fromCharCode(8211));
  const hasWeakCloser =
    /\bthoughts\??$/i.test(trimmedText) ||
    /\bagree\??$/i.test(trimmedText);
  const matchedBuzzword = corporateBuzzwords.find((word) => lowerText.includes(word));
  const matchedGeneratedTell = generatedWritingTells.find((phrase) => lowerText.includes(phrase));
  const hashtagCount = (trimmedText.match(/#\w+/g) ?? []).length;
  const allCapsWordCount = (trimmedText.match(/\b[A-Z]{3,}\b/g) ?? [])
    .filter((word) => !allowedAcronyms.includes(word))
    .length;
  const hasSpammyPunctuation =
    /!{3,}/.test(trimmedText) ||
    /\?{3,}/.test(trimmedText) ||
    /[!?]{4,}/.test(trimmedText);
  const matchedWeakOpener = weakOpeningPhrases.find((item) => item.pattern.test(trimmedText));
  const isLongSingleLine =
    visibleLines.length === 1 &&
    draftWordCount > 15;
  const hedgeWordCount = lowerText
    .split(/[^a-z']+/)
    .filter((token) => hedgeWords.includes(token))
    .length;
  const rawLineCount = countRawLines(trimmedText);
  const hitsExpandCutoff = !isEmpty && rawLineCount >= 15;
  const baselineChecks: VoiceCheck[] = [
    {
      id: "substance",
      label: isTooShort
        ? "Too short - add a complete thought"
        : isThin
          ? "A bit thin - more substance would help"
          : "Has enough substance",
      status: isEmpty ? "warn" : isTooShort ? "fail" : isThin ? "warn" : "pass",
    },
    {
      id: "em_dash",
      label: "No em-dashes",
      status: isEmpty ? "pass" : hasDash ? "fail" : "pass",
    },
    {
      id: "weak_closer",
      label: 'No weak closer ("thoughts?", "agree?")',
      status: isEmpty ? "pass" : hasWeakCloser ? "fail" : "pass",
    },
    {
      id: "buzzwords",
      label: matchedBuzzword ? `Drop the buzzword: "${matchedBuzzword}"` : "No corporate buzzwords",
      status: isEmpty ? "pass" : matchedBuzzword ? "fail" : "pass",
    },
    {
      id: "ai_tells",
      label: matchedGeneratedTell ? `Sounds AI-written: "${matchedGeneratedTell}"` : "No AI-tell phrases",
      status: isEmpty ? "pass" : matchedGeneratedTell ? "fail" : "pass",
    },
    {
      id: "hashtags",
      label: hashtagCount > 2
        ? `Too many hashtags (${hashtagCount}, max 2)`
        : "Hashtag use is restrained",
      status: isEmpty ? "pass" : hashtagCount > 2 ? "fail" : "pass",
    },
    {
      id: "shouting",
      label: allCapsWordCount > 0
        ? `Watch ALL CAPS (${allCapsWordCount} all-caps word${allCapsWordCount === 1 ? "" : "s"} - intentional?)`
        : "No SHOUTING",
      status: isEmpty ? "pass" : allCapsWordCount > 0 ? "warn" : "pass",
    },
    {
      id: "spammy_punct",
      label: hasSpammyPunctuation
        ? 'Spammy punctuation (cut "!!!" / "???")'
        : "No spammy punctuation",
      status: isEmpty ? "pass" : hasSpammyPunctuation ? "warn" : "pass",
    },
    {
      id: "direct_opener",
      label: matchedWeakOpener
        ? `Drops a weak opener: "${matchedWeakOpener.phrase}"`
        : "Direct opener",
      status: isEmpty || matchedWeakOpener ? "warn" : "pass",
    },
    {
      id: "rhythm",
      label: isLongSingleLine
        ? "Try a hard line break for rhythm"
        : "Rhythm reads well",
      status: isEmpty || isLongSingleLine ? "warn" : "pass",
    },
    {
      id: "expand_zone",
      label: hitsExpandCutoff
        ? 'Cut 1 line - 15 hides behind "show more", 14 shows in full'
        : "Clear of X's expand cutoff",
      status: isEmpty ? "pass" : hitsExpandCutoff ? "warn" : "pass",
    },
    {
      id: "word_count",
      label: draftWordCount > 30
        ? `Long for X (${draftWordCount} words, aim for <= 30)`
        : "Tight word count",
      status: isEmpty || draftWordCount > 30 || isTooShort ? "warn" : "pass",
    },
    {
      id: "hedges",
      label: hedgeWordCount > 2
        ? `Cut hedge words (${hedgeWordCount} found: just/really/basically/...)`
        : "Few hedge words",
      status: isEmpty || hedgeWordCount > 2 ? "warn" : "pass",
    },
  ];

  return [
    ...baselineChecks,
    ...(isEmpty || !varietyCheck ? [] : [varietyCheck]),
    ...(isEmpty
      ? []
      : evaluateHighIntentChecks({
          trimmedText,
          lowerText,
          visibleLines,
          draftWordCount,
        })),
  ];
}
