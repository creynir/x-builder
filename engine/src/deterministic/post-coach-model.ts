import { postCoachScoreBands } from "./const/scoring-weights.js";
import type {
  PostCoachBadge,
  PostCoachCardInput,
  PostCoachSection,
  PostCoachViewModel,
} from "./types.js";

export function selectPostCoachBadge(scoreValue: number): PostCoachBadge {
  if (scoreValue >= postCoachScoreBands.topTierMinimum) {
    return {
      label: "Top tier",
      tone: "top",
      tooltip: "Rare. Don't chase this - 60+ is already ship-ready.",
    };
  }

  if (scoreValue >= postCoachScoreBands.shipItMinimum) {
    return {
      label: "Ship it",
      tone: "ship",
      tooltip: "Solid post. Ship it - higher scores are a bonus, not the goal.",
    };
  }

  if (scoreValue >= postCoachScoreBands.almostThereMinimum) {
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

export function buildPostCoachModel({
  score,
  hasText,
  previewMode = false,
  expanded = false,
}: PostCoachCardInput): PostCoachViewModel {
  if (!hasText || !score) {
    return {
      state: "empty",
      title: "Post Coach",
      message: "Start typing to see static Post Coach checks for the draft.",
    };
  }

  const badge = selectPostCoachBadge(score.value);
  const failed = score.checks.filter((check) => check.status === "fail");
  const warned = score.checks.filter((check) => check.status === "warn");
  const passed = score.checks.filter((check) => check.status === "pass");
  const helperText =
    "Signals, not verdicts. These checks flag patterns worth weighing - none of them are rules you have to follow. 60+ usually reads ship-ready; the goal is the post, not the score.";
  const footerText =
    "These are static rule checks only. Use them to spot obvious writing issues; they are not a prediction of real audience performance.";

  if (previewMode) {
    const sampleItems = [...failed, ...warned, ...passed].slice(0, 2);
    const hiddenChecks = score.checks.length - sampleItems.length;

    return {
      state: "ready",
      title: "Post Coach",
      value: score.value,
      badge,
      target: postCoachScoreBands.targetScore,
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
    target: postCoachScoreBands.targetScore,
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
