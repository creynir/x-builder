import type { PostCoachViewModel as ApiPostCoachViewModel } from "@x-builder/shared";

import { learningCaveat } from "./deterministic-analysis-constants.js";
import {
  derivePostCoachCard,
  type PostCoachScore,
  type PostCoachViewModel as AnalyzerPostCoachViewModel,
} from "./post-analyzer.js";

type PostCoachMode = "preview" | "expanded";

const addDayOneCaveat = (
  viewModel: AnalyzerPostCoachViewModel,
): ApiPostCoachViewModel => {
  if (viewModel.state === "empty") {
    return viewModel;
  }

  return {
    ...viewModel,
    learningCaveat,
  };
};

export const deriveApiPostCoach = (input: {
  score: PostCoachScore;
  text: string;
  mode: PostCoachMode;
}): ApiPostCoachViewModel => {
  const viewModel = derivePostCoachCard({
    score: input.score,
    hasText: input.text.trim().length > 0,
    previewMode: input.mode === "preview",
    expanded: input.mode === "expanded",
  });

  return addDayOneCaveat(viewModel);
};
