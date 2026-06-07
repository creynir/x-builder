import type { Learning, PostScore } from "./post-analyzer.js";

const staticLearningText = (text: string): string => {
  if (/one-liners under 12 words/i.test(text)) {
    return "Concise one-liners are easier to scan.";
  }

  if (/hot take/i.test(text)) {
    return '"hot take:" openers create a clear argument to react to.';
  }

  if (/genuine question/i.test(text)) {
    return '"genuine question:" openers give readers an easy reply path.';
  }

  if (/Audience-name openers/i.test(text)) {
    return "Audience-name openers make the reader group explicit.";
  }

  if (/3\+ lines/i.test(text)) {
    return "Three or more non-empty lines can make the structure easier to scan.";
  }

  if (/under 30 words/i.test(text)) {
    return "Short posts usually reduce friction before the hook lands.";
  }

  return "This draft matched a deterministic voice rule.";
};

export const sanitizeLearning = (learning: Learning): Learning => ({
  ...learning,
  text: `Static rule evidence: ${staticLearningText(learning.text)}`,
});

export const sanitizeScoreLearnings = (score: PostScore): PostScore => ({
  ...score,
  learnings: score.learnings.map(sanitizeLearning),
});
