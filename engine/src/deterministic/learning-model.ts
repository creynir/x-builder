import type { ScoreLearning } from "./types.js";

export function deriveScoreLearnings(input: {
  trimmedText: string;
  wordCount: number;
  lineCount: number;
}): ScoreLearning[] {
  const { trimmedText, wordCount, lineCount } = input;
  const learnings: ScoreLearning[] = [];

  if (wordCount > 0 && wordCount <= 12 && lineCount === 1) {
    learnings.push({
      text: "One-liners under 12 words are easier to scan in a fast feed.",
      relevance: "matched",
    });
  }

  if (/^hot take:/i.test(trimmedText)) {
    learnings.push({
      text: '"hot take:" openers create a clear argument to react to.',
      relevance: "matched",
    });
  }

  if (/^genuine question:/i.test(trimmedText)) {
    learnings.push({
      text: '"genuine question:" openers give readers an easy reply path.',
      relevance: "matched",
    });
  }

  if (/^(founders|builders|solo founders|creators|indie hackers|makers),/i.test(trimmedText)) {
    learnings.push({
      text: "Audience-name openers make the reader group explicit.",
      relevance: "matched",
    });
  }

  if (lineCount >= 3) {
    learnings.push({
      text: "Three or more non-empty lines can make the structure easier to scan.",
      relevance: "matched",
    });
  }

  if (wordCount > 30) {
    learnings.push({
      text: "Shorter posts often reduce friction before the hook lands.",
      relevance: "matched",
    });
  }

  if (learnings.length === 0) {
    learnings.push({
      text: '"genuine question:" is worth trying when the post needs a clearer reply path.',
      relevance: "general",
    });
  }

  return learnings.slice(0, 2);
}
