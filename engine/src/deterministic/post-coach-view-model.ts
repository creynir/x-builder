import type { PostCoachViewModel as ApiPostCoachViewModel } from "@x-builder/shared";

import { learningCaveat } from "./deterministic-analysis-constants.js";
import { sanitizePostCoachViewModel } from "./learning-copy.js";
import { buildPostCoachModel } from "./post-coach-model.js";
import type {
  PostCoachScore,
  PostCoachViewModel,
} from "./types.js";

type PostCoachMode = "preview" | "expanded";

const addDayOneCaveat = (
  viewModel: PostCoachViewModel,
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
  const viewModel = buildPostCoachModel({
    score: input.score,
    hasText: input.text.trim().length > 0,
    previewMode: input.mode === "preview",
    expanded: input.mode === "expanded",
  });

  return addDayOneCaveat(sanitizePostCoachViewModel(viewModel));
};
