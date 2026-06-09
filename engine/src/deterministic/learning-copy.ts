import type {
  ScoreLearning,
  PostCoachViewModel,
  DeterministicPostScore,
} from "./types.js";

const emptyPostCoachMessage =
  "Start typing to see how the draft scores against static voice rules.";

const postCoachCopyFallback =
  "Static rule check. Imported performance data is not connected yet.";

const importedPerformanceClaimPattern =
  /\b(your data|last 30 days|averaged|replies for you|imported metrics|personal performance data|outperform(?:s|ed)?|highest like-to-reply ratio|AI Rate post|above the composer)\b/i;

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

  if (/3\+ lines|Three or more non-empty lines/i.test(text)) {
    return "Three or more non-empty lines can make the structure easier to scan.";
  }

  if (/under 30 words|Shorter posts/i.test(text)) {
    return "Short posts usually reduce friction before the hook lands.";
  }

  return "This draft matched a deterministic voice rule.";
};

export const sanitizeLearning = (learning: ScoreLearning): ScoreLearning => ({
  ...learning,
  text: `Static rule evidence: ${staticLearningText(learning.text)}`,
});

export const sanitizeScoreLearnings = (
  score: DeterministicPostScore,
): DeterministicPostScore => ({
  ...score,
  learnings: score.learnings.map(sanitizeLearning),
});

const sanitizePostCoachCopy = (text: string): string =>
  importedPerformanceClaimPattern.test(text) ? postCoachCopyFallback : text;

export const sanitizePostCoachViewModel = (
  viewModel: PostCoachViewModel,
): PostCoachViewModel => {
  if (viewModel.state === "empty") {
    return {
      ...viewModel,
      message: importedPerformanceClaimPattern.test(viewModel.message)
        ? emptyPostCoachMessage
        : viewModel.message,
    };
  }

  return {
    ...viewModel,
    learnings: viewModel.learnings.map(sanitizeLearning),
    helperText: sanitizePostCoachCopy(viewModel.helperText),
    footerText: sanitizePostCoachCopy(viewModel.footerText),
  };
};
