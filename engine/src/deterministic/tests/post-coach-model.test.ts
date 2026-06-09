import { describe, expect, it } from "vitest";

import {
  buildPostCoachModel,
  selectPostCoachBadge,
} from "../post-coach-model";
import { evaluateDraftVoice } from "../voice-score";
describe("post-coach-model", () => {
  it("derives the empty Post Coach card state before the user writes", () => {
    expect(buildPostCoachModel({ hasText: false, score: null })).toEqual({
      state: "empty",
      title: "Post Coach",
      message: "Start typing to see static Post Coach checks for the draft.",
    });
  });

  it("derives expanded Post Coach sections from voice checks", () => {
    const score = evaluateDraftVoice(
      [
        "everyone should log launches",
        "",
        "we got 42 replies last week",
        "",
        "proof creates trust",
      ].join("\n"),
      {
        varietyCheck: {
          id: "variety_format_mix",
          label: "Format mix (insight share)",
          status: "pass",
        },
      },
    );
    const card = buildPostCoachModel({
      expanded: true,
      hasText: true,
      score,
    });

    expect(card).toMatchObject({
      state: "ready",
      title: "Post Coach",
      value: 81,
      target: 60,
      badge: {
        label: "Ship it",
        tone: "ship",
      },
      counts: {
        flagged: 4,
        nudges: 2,
        onPoint: 24,
      },
      expanded: true,
      previewMode: false,
      hiddenChecks: 0,
    });

    if (card.state !== "ready") {
      throw new Error("Expected ready card.");
    }

    expect(card.sections.map((section) => section.title)).toEqual([
      "Worth a look",
      "Nudges",
      "On point",
    ]);
    expect(card.sections[0]?.items.map((check) => check.id)).toEqual([
      "quality_hook",
      "quality_tension",
      "quality_quotable",
      "quality_question",
    ]);
    expect(card.sections[2]?.items.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "quality_answerable_question",
        "quality_vague_curiosity",
        "quality_standalone_context",
        "quality_claim_evidence",
        "quality_one_idea_focus",
        "line_length",
        "link_density",
        "mention_density",
      ]),
    );
  });

  it("derives preview samples without learnings", () => {
    const score = evaluateDraftVoice("everyone should log launches");
    const card = buildPostCoachModel({
      hasText: true,
      previewMode: true,
      score,
    });

    expect(card).toMatchObject({
      state: "ready",
      expanded: false,
      previewMode: true,
      learnings: [],
      sections: [
        {
          title: "Sample",
        },
      ],
      hiddenChecks: score.checks.length - 2,
    });
  });

  it("labels score bands for card badges", () => {
    expect(selectPostCoachBadge(90)).toMatchObject({ label: "Top tier", tone: "top" });
    expect(selectPostCoachBadge(60)).toMatchObject({ label: "Ship it", tone: "ship" });
    expect(selectPostCoachBadge(45)).toMatchObject({ label: "Almost there", tone: "almost" });
    expect(selectPostCoachBadge(20)).toMatchObject({ label: "Rework", tone: "rework" });
  });
});
