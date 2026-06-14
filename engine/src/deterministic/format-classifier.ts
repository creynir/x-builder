import { countWords, getNonEmptyLines } from "./text-metrics.js";
import type { PostFormat } from "./types.js";

export const predictionFormatLabels: Record<PostFormat, string> = {
  genuine_question: "Question",
  hot_take: "Hot take",
  audience_question: "Audience-Q",
  story: "Story",
  insight_share: "Insight",
  ab_choice: "A/B",
  connect: "Connect",
  other: "Other",
  fill_blank_tribal: "Fill-blank",
  cta_farm: "CTA",
  fantasy_question: "Fantasy-Q",
  binary_choice: "Binary",
  nuanced_question: "Nuanced-Q",
  recognition_roast: "Roast",
  wisdom_one_liner: "Wisdom",
  milestone: "Milestone",
};

const hotTakePrefixes = [
  "hot take:",
  "unpopular opinion:",
  "popular opinion:",
  "real talk:",
];

const tribeVocative = /^(founders|builders|creators|solo founders|indie hackers|makers),/i;

// "X has Y" / "X is Y" — a subject followed by a copula/possessive verb and a complement.
const parallelClaimLine = /\b(has|is)\b\s+\S/i;

// A trailing fill-in line: dangling verb/preposition, or an open-ended marker (?, …, ...).
const incompleteFinalLine = /(\b(has|is|are|for|with|equals?|=)\s*[?]?\s*$|[?]\s*$|(…|\.\.\.)\s*$)/i;

const ctaImperative =
  /\b(drop|share|show|pitch|tell|name|post|reply with|comment)\b[^.?!]*\b(your|ur|me|below|us)\b/i;
const ctaReciprocity = /\bi'?ll\s+(rate|roast|check|review|follow|critique)\b/i;

const fantasyStake =
  /(\$\s?\d|\b\d+\s?(k|m|million|billion)\b|\bimagine\b|\byou just\b|\bif you (had|could|were|got|won)\b)/i;

const milestoneNoun = /\b(followers|days|mrr|arr|users|customers|impressions|sales|revenue|signups)\b/i;
const milestoneGoalPhrase = /\b(my goal|aiming to|by end of|i'?m going to)\b/i;

const recognitionMarkers =
  /(\bwe all know\b|\bi know a guy\b|\bthat one (guy|friend|founder|person|dev|engineer|coworker)\b|\byour .*\bfriends?\b)/i;

export function classifyPostFormat(text: string): PostFormat {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return "other";
  }

  const lowerText = trimmedText.toLowerCase();
  const visibleLines = getNonEmptyLines(trimmedText);
  const wordCount = countWords(trimmedText);
  const isQuestion = trimmedText.endsWith("?");
  const hasFirstPerson = /\b(i|my|we)\b/i.test(trimmedText);
  const hasSecondPerson = /\byou\b|\byour\b|\byou'?(re|ve|d|ll)\b/i.test(trimmedText);

  // 1. hot_take — explicit opinion prefixes.
  if (hotTakePrefixes.some((prefix) => lowerText.startsWith(prefix))) {
    return "hot_take";
  }

  // 2. genuine_question — explicit question prefix.
  if (lowerText.startsWith("genuine question:")) {
    return "genuine_question";
  }

  // 3. fill_blank_tribal — 2+ parallel "X has/is Y" lines with an incomplete final line.
  if (visibleLines.length >= 3) {
    const finalLine = visibleLines[visibleLines.length - 1]!;
    const parallelCount = visibleLines
      .slice(0, -1)
      .filter((line) => parallelClaimLine.test(line)).length;

    if (parallelCount >= 2 && incompleteFinalLine.test(finalLine)) {
      return "fill_blank_tribal";
    }
  }

  // 4. cta_farm — imperative + object, or a reciprocity offer.
  if (ctaImperative.test(trimmedText) || ctaReciprocity.test(trimmedText)) {
    return "cta_farm";
  }

  // 5. fantasy_question — second-person hypothetical with a concrete stake, ending in a question.
  if (isQuestion && hasSecondPerson && fantasyStake.test(trimmedText)) {
    return "fantasy_question";
  }

  // 6. binary_choice — short inline "X or Y?" framing (distinct from a bulleted A/B list).
  if (isQuestion && /\bor\b/i.test(trimmedText) && wordCount <= 8 && visibleLines.length === 1) {
    return "binary_choice";
  }

  // 7. audience_question — tribe vocative plus a quick question.
  if (tribeVocative.test(trimmedText)) {
    return "audience_question";
  }

  // 8. connect — pure "let's connect" with no CTA object (broadened CTA cases left at step 4).
  if (/\blet'?s connect\b/i.test(trimmedText)) {
    return "connect";
  }

  // 9. recognition_roast — observational humor about a recognizable subject, no advice.
  if (recognitionMarkers.test(trimmedText)) {
    return "recognition_roast";
  }

  // 10. milestone — first person + number + (milestone noun OR goal phrase).
  if (
    hasFirstPerson &&
    /\d/.test(trimmedText) &&
    (milestoneNoun.test(trimmedText) || milestoneGoalPhrase.test(trimmedText))
  ) {
    return "milestone";
  }

  // 11. story — three or more visible lines in first person.
  if (visibleLines.length >= 3 && hasFirstPerson) {
    return "story";
  }

  // 12. ab_choice — bulleted list, no inline "X or Y?" question.
  if (/^[-*]\s+/m.test(trimmedText) && visibleLines.length <= 5) {
    return "ab_choice";
  }

  // 13. nuanced_question — multi-clause / conditional / self-incriminating question.
  if (
    isQuestion &&
    (/\bbe honest\b/i.test(trimmedText) ||
      /\bdo you actually\b/i.test(trimmedText) ||
      /\bor\b/i.test(trimmedText) ||
      (trimmedText.match(/,/g)?.length ?? 0) >= 1)
  ) {
    return "nuanced_question";
  }

  // 14. genuine_question — easy single-clause question fallback.
  if (isQuestion && visibleLines.length <= 3) {
    return "genuine_question";
  }

  // 15. wisdom_one_liner — single advice/truth line (no question, no story).
  if (visibleLines.length === 1) {
    return "wisdom_one_liner";
  }

  // 16. insight_share — multi-line statement that matched nothing earlier.
  return "insight_share";
}
