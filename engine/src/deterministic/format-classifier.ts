import { countWords, getNonEmptyLines } from "./text-metrics.js";
import type { PostFormat } from "./types.js";

export const predictionFormatLabels: Record<PostFormat, string> = {
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

export const varietyFormatLabels: Record<PostFormat, string> = {
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

export function classifyPostFormat(text: string): PostFormat {
  const trimmedText = text.trim();
  const lowerText = trimmedText.toLowerCase();

  if (!trimmedText) {
    return "other";
  }

  if (
    lowerText.startsWith("hot take:") ||
    lowerText.startsWith("unpopular opinion:") ||
    lowerText.startsWith("popular opinion:") ||
    lowerText.startsWith("real talk:")
  ) {
    return "hot_take";
  }

  if (lowerText.startsWith("genuine question:")) {
    return "genuine_question";
  }

  if (/^(founders|builders|creators|solo founders|indie hackers|makers),/i.test(trimmedText)) {
    return "audience_question";
  }

  const visibleLines = getNonEmptyLines(trimmedText);

  if (visibleLines.length >= 3 && /\b(i|my|we)\b/i.test(trimmedText)) {
    return "story";
  }

  if (/^[-*]\s+/m.test(trimmedText) && visibleLines.length <= 5) {
    return "ab_choice";
  }

  if (/(drop your handle|comment what you|let'?s connect|reply with)/i.test(trimmedText)) {
    return "connect";
  }

  if (trimmedText.endsWith("?") && visibleLines.length <= 3) {
    return "genuine_question";
  }

  if (/(my goal|aiming to|by end of|i'?m going to)/i.test(trimmedText) && /\d/.test(trimmedText)) {
    return "goal_share";
  }

  if (visibleLines.length === 1 && countWords(trimmedText) <= 15) {
    return "one_liner";
  }

  return "insight_share";
}
