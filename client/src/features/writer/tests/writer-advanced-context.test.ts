import { describe, expect, it } from "vitest";

import {
  applyAdvancedContextChange,
  createInitialModel,
  markAnalysisStale,
  type AdvancedContext,
  type CandidateAnalysisState,
  type RefinementState,
  type WriterPageModel,
} from "../writer-workflow";

import { readyPostCoach } from "./analyze-response-builder";

// A scored "ready" analysis state for a single draft candidate, used to prove
// that a context change downgrades a prior result to "stale" via the existing
// stale mechanism (the page re-scores it through the 500ms debounce).
function readyAnalysisState(): CandidateAnalysisState {
  return {
    status: "ready",
    item: {
      status: "scored",
      id: "draft-post",
      text: "A scored draft that should go stale when context changes.",
      sourceFormat: undefined,
      detectedFormat: "insight_share",
      score: {
        value: 74,
        checks: [],
        learnings: [],
        engageability: {
          engageable: true,
          reason: "Ends with a concrete question.",
        },
      },
      postCoach: readyPostCoach(),
      prediction: {
        status: "disabled",
        reason: "missing_followers",
        message: "Prediction needs follower count.",
      },
      heuristicLabel: "Heuristic rank, not prediction.",
      analyzedAt: "2026-06-07T12:00:00.000Z",
      analyzerVersion: "deterministic-v1",
    },
  };
}

function modelWithReadyAnalysis(): WriterPageModel {
  const base = createInitialModel();

  return {
    ...base,
    idea: "A scored draft that should go stale when context changes.",
    candidates: [
      {
        id: "draft-post",
        source: "draft",
        text: "A scored draft that should go stale when context changes.",
      },
    ],
    analysisByCandidateId: {
      "draft-post": readyAnalysisState(),
    },
  };
}

describe("writer advanced context model", () => {
  it("starts with an empty advanced context and an idle refinement state", () => {
    const model = createInitialModel();

    const advancedContext: AdvancedContext = model.advancedContext;
    const refinement: RefinementState = model.refinement;

    expect(advancedContext).toEqual({});
    expect(refinement).toEqual({ status: "idle" });
  });

  it("round-trips the full advanced-context field shape through the reducer", () => {
    const patch: AdvancedContext = {
      trailingMedianImpressions: 1800,
      repeatHistory: { similarInLast7Days: true, date: "2026-06-10" },
      plannedHourUtc: 20,
      willAttachMedia: true,
      accountAgeYears: 3,
    };

    const next = applyAdvancedContextChange(createInitialModel(), patch);
    const advancedContext: AdvancedContext = next.advancedContext;

    expect(advancedContext.trailingMedianImpressions).toBe(1800);
    expect(advancedContext.repeatHistory).toEqual({
      similarInLast7Days: true,
      date: "2026-06-10",
    });
    expect(advancedContext.plannedHourUtc).toBe(20);
    expect(advancedContext.willAttachMedia).toBe(true);
    expect(advancedContext.accountAgeYears).toBe(3);
  });
});

describe("applyAdvancedContextChange", () => {
  it("merges a patch into the existing advanced context", () => {
    const model: WriterPageModel = {
      ...createInitialModel(),
      advancedContext: { plannedHourUtc: 9 },
    };

    const next = applyAdvancedContextChange(model, {
      trailingMedianImpressions: 1800,
    });

    expect(next.advancedContext).toEqual({
      plannedHourUtc: 9,
      trailingMedianImpressions: 1800,
    });
  });

  it("does not mutate the prior model when applying a patch", () => {
    const model: WriterPageModel = {
      ...createInitialModel(),
      advancedContext: { plannedHourUtc: 9 },
    };

    applyAdvancedContextChange(model, { willAttachMedia: true });

    expect(model.advancedContext).toEqual({ plannedHourUtc: 9 });
  });

  it("marks prior analysis stale so the page re-scores it", () => {
    const model = modelWithReadyAnalysis();

    const next = applyAdvancedContextChange(model, { plannedHourUtc: 20 });

    expect(next.analysisByCandidateId["draft-post"]?.status).toBe("stale");
    expect(next.analysisByCandidateId).toEqual(
      markAnalysisStale(model.analysisByCandidateId),
    );
  });

  it("resets a refined refinement back to idle when context changes", () => {
    const model: WriterPageModel = {
      ...createInitialModel(),
      refinement: { status: "refined", requestId: 7 },
    };

    const next = applyAdvancedContextChange(model, { accountAgeYears: 2 });

    expect(next.refinement).toEqual({ status: "idle" });
  });

  it("resets a running refinement back to idle when context changes", () => {
    const model: WriterPageModel = {
      ...createInitialModel(),
      refinement: { status: "running", requestId: 3 },
    };

    const next = applyAdvancedContextChange(model, { willAttachMedia: false });

    expect(next.refinement).toEqual({ status: "idle" });
  });
});
