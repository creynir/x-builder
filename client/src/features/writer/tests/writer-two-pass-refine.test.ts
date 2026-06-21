import { describe, expect, it, vi } from "vitest";
import type {
  AnalyzePostsRequest,
  AnalyzePostsResponse,
  JudgeDraftResponse,
  JudgeVerdict,
} from "@x-builder/shared";

import {
  applyFollowerDraftChange,
  applyIdeaChange,
  createInitialModel,
  runJudgeDraft,
  runTwoPassRefine,
  type CandidateAnalysisState,
  type WriterApiClient,
  type WriterCandidate,
  type WriterPageModel,
} from "../writer-workflow";
import {
  availablePrediction,
  buildAnalyzeResponse,
  scoredItem,
} from "./analyze-response-builder";

const draftText = "A scored draft awaiting a judge-refined reach estimate.";

// A judge verdict whose two reach scalars (impressions, replies) are distinct,
// non-default values so a leaked extra `scores` key would be observable: every
// other dimension is a different number than the two that must cross the wire.
const verdict: JudgeVerdict = {
  verdict: "slight_rework",
  confidence: "medium",
  scores: {
    overall: 78,
    replies: 80,
    profileClicks: 72,
    impressions: 65,
    bookmarkValue: 60,
    dwellProxy: 70,
    voiceMatch: 85,
    negativeRisk: 10,
    answerEffort: 55,
    strangerAnswerability: 48,
    statusDependency: 30,
    replyVsQuoteOrientation: 62,
    audienceMatch: 41,
  },
  headline: "Strong hook, weak closer.",
  strengths: ["Concrete claim up front"],
  improvements: ["Trim the middle paragraph"],
  annotations: [],
};

const judgedResponse: JudgeDraftResponse = {
  status: "judged",
  verdict,
  model: "claude-cli",
  judgedAt: "2026-06-10T12:00:00.000Z",
};

// A single draft candidate matching the model idea (the refine gate requires the
// scored candidate's text to equal model.idea.trim()).
const draftCandidate: WriterCandidate = {
  id: "draft-post",
  source: "draft",
  text: draftText,
};

// A ready analysis state carrying a static, available prediction for the draft.
// The two-pass refine replaces this prediction in place; "available" (not
// disabled) is required so there is a prediction to refine at all.
function readyStaticAnalysis(
  text: string = draftText,
): CandidateAnalysisState {
  return {
    status: "ready",
    item: scoredItem(
      { id: "draft-post", text },
      { prediction: availablePrediction({ qualityBasis: "static" }) },
    ),
  };
}

// A model with a ready, scored draft whose text equals the idea and a judge
// verdict already published — the exact precondition runTwoPassRefine requires.
function scoredAndJudgedModel(
  overrides: Partial<WriterPageModel> = {},
): WriterPageModel {
  return {
    ...createInitialModel(),
    idea: draftText,
    candidates: [draftCandidate],
    analysisByCandidateId: { "draft-post": readyStaticAnalysis() },
    judge: { status: "ready", verdict, model: "claude-cli" },
    refinement: { status: "idle" },
    ...overrides,
  };
}

// Reads a candidate's prediction out of a ready analysis state, asserting the
// state is ready and the prediction is available (so qualityBasis is reachable).
function availablePredictionOf(
  state: CandidateAnalysisState | undefined,
): Extract<
  ReturnType<typeof availablePrediction>,
  { status: "available" }
> {
  if (state === undefined || state.status !== "ready") {
    throw new Error("Expected a ready analysis state for the draft candidate.");
  }

  if (state.item.status !== "scored") {
    throw new Error("Expected the draft candidate's item to be scored.");
  }

  const prediction = state.item.prediction;

  if (prediction.status !== "available") {
    throw new Error("Expected an available prediction on the scored draft.");
  }

  return prediction;
}

// An analyze mock that returns a refined (judge-quality) prediction. The returned
// item carries qualityBasis: "judge" so a successful pass-2 can be observed.
function judgeRefinedAnalyze() {
  return vi.fn<WriterApiClient["analyzePosts"]>(async (request) =>
    buildAnalyzeResponse(request, {
      "draft-post": scoredItem(
        { id: "draft-post", text: request.items[0]?.text ?? draftText },
        {
          prediction: availablePrediction({
            qualityBasis: "judge",
            predictedMidImpressions: 4200,
            stallRange: { low: 2600, high: 7000 },
          }),
        },
      ),
    }),
  );
}

function buildApiClient(
  analyzePosts: WriterApiClient["analyzePosts"],
  judgeDraft: WriterApiClient["judgeDraft"] = vi.fn(async () => judgedResponse),
): WriterApiClient {
  return {
    analyzePosts,
    generateIdea: vi.fn() as unknown as WriterApiClient["generateIdea"],
    judgeDraft,
  };
}

// Mirrors WriterPage.publishModel: applies functional updates against a running
// snapshot and exposes the latest model so post-action state is assertable.
function runWith(
  model: WriterPageModel,
  run: (publish: (
    update: WriterPageModel | ((value: WriterPageModel) => WriterPageModel),
  ) => void) => Promise<WriterPageModel>,
) {
  let current = model;
  const publish = (
    update: WriterPageModel | ((value: WriterPageModel) => WriterPageModel),
  ): void => {
    current = typeof update === "function" ? update(current) : update;
  };

  return run(publish).then((returned) => ({ returned, current }));
}

// The only two scalars allowed to cross into pass-2; everything else on the
// verdict's scores must be absent from the request's judgeSignals.
const leakedScoreKeys = [
  "overall",
  "profileClicks",
  "bookmarkValue",
  "dwellProxy",
  "voiceMatch",
  "negativeRisk",
  "answerEffort",
  "strangerAnswerability",
  "statusDependency",
  "replyVsQuoteOrientation",
  "audienceMatch",
] as const;

describe("runTwoPassRefine judge-signal request", () => {
  it("re-issues analyze carrying exactly the two judge reach scalars", async () => {
    const analyze = judgeRefinedAnalyze();
    const apiClient = buildApiClient(analyze);

    await runWith(scoredAndJudgedModel(), (publish) =>
      runTwoPassRefine(apiClient, scoredAndJudgedModel(), publish),
    );

    expect(analyze).toHaveBeenCalledTimes(1);
    const request = analyze.mock.calls[0]?.[0] as AnalyzePostsRequest;
    expect(request.scoringContext.judgeSignals).toEqual({
      impressions: 65,
      replies: 80,
    });
  });

  it("never leaks any other verdict score dimension into judgeSignals", async () => {
    const analyze = judgeRefinedAnalyze();
    const apiClient = buildApiClient(analyze);

    await runWith(scoredAndJudgedModel(), (publish) =>
      runTwoPassRefine(apiClient, scoredAndJudgedModel(), publish),
    );

    const request = analyze.mock.calls[0]?.[0] as AnalyzePostsRequest;
    const judgeSignals = request.scoringContext.judgeSignals ?? {};
    expect(Object.keys(judgeSignals).sort()).toEqual(["impressions", "replies"]);
    for (const key of leakedScoreKeys) {
      expect(judgeSignals).not.toHaveProperty(key);
    }
  });

  it("marks the refinement running with a fresh request id when refine starts", async () => {
    const apiClient = buildApiClient(judgeRefinedAnalyze());
    let runningSeen = false;

    await runWith(scoredAndJudgedModel(), (publish) => {
      const wrapped = (
        update:
          | WriterPageModel
          | ((value: WriterPageModel) => WriterPageModel),
      ): void => {
        const sampled =
          typeof update === "function"
            ? update(scoredAndJudgedModel())
            : update;
        if (sampled.refinement.status === "running") {
          runningSeen = true;
        }
        publish(update);
      };
      return runTwoPassRefine(apiClient, scoredAndJudgedModel(), wrapped);
    });

    expect(runningSeen).toBe(true);
  });
});

describe("runTwoPassRefine prediction replacement", () => {
  it("replaces the static prediction with the judge-quality prediction on success", async () => {
    const apiClient = buildApiClient(judgeRefinedAnalyze());

    const { current } = await runWith(scoredAndJudgedModel(), (publish) =>
      runTwoPassRefine(apiClient, scoredAndJudgedModel(), publish),
    );

    const prediction = availablePredictionOf(
      current.analysisByCandidateId["draft-post"],
    );
    expect(prediction.qualityBasis).toBe("judge");
    expect(prediction.predictedMidImpressions).toBe(4200);
    expect(current.refinement.status).toBe("refined");
  });

  it("holds exactly one prediction for the candidate after refining", async () => {
    const apiClient = buildApiClient(judgeRefinedAnalyze());

    const { current } = await runWith(scoredAndJudgedModel(), (publish) =>
      runTwoPassRefine(apiClient, scoredAndJudgedModel(), publish),
    );

    const state = current.analysisByCandidateId["draft-post"];
    if (state === undefined || state.status !== "ready") {
      throw new Error("Expected a ready analysis state after refine.");
    }
    if (state.item.status !== "scored") {
      throw new Error("Expected a scored item after refine.");
    }
    // The model keeps a single prediction field per candidate; there is no
    // separate static/pre-judge prediction lingering beside the judge one.
    expect("staticPrediction" in state.item).toBe(false);
    expect("previousPrediction" in state.item).toBe(false);
    expect(state.item.prediction.status).toBe("available");
  });
});

describe("runTwoPassRefine stale-guard", () => {
  it("drops a refine result when the draft text changed while it was in flight", async () => {
    const analysis = createDeferred<AnalyzePostsResponse>();
    const analyze = vi.fn<WriterApiClient["analyzePosts"]>(
      async () => analysis.promise,
    );
    const apiClient = buildApiClient(analyze);

    let current = scoredAndJudgedModel();
    const publish = (
      update:
        | WriterPageModel
        | ((value: WriterPageModel) => WriterPageModel),
    ): void => {
      current = typeof update === "function" ? update(current) : update;
    };

    const refining = runTwoPassRefine(apiClient, current, publish);

    // User edits the draft while pass-2 is still pending: the idea and the
    // candidate text both move off the judged draft.
    const editedText = "An edited draft that the stale judge must not refine.";
    current = applyIdeaChange(current, editedText);
    current = {
      ...current,
      candidates: [{ id: "draft-post", source: "draft", text: editedText }],
      analysisByCandidateId: {
        "draft-post": {
          status: "ready",
          item: scoredItem(
            { id: "draft-post", text: editedText },
            { prediction: availablePrediction({ qualityBasis: "static" }) },
          ),
        },
      },
    };

    analysis.resolve(
      buildAnalyzeResponse(
        { items: [{ id: "draft-post", text: draftText }], scoringContext: {}, presentation: { postCoachMode: "preview" } },
        {
          "draft-post": scoredItem(
            { id: "draft-post", text: draftText },
            { prediction: availablePrediction({ qualityBasis: "judge" }) },
          ),
        },
      ),
    );
    await refining;

    // The stale result is dropped: refinement is not "refined", and the
    // candidate's prediction is still the static one for the edited text.
    expect(current.refinement.status).not.toBe("refined");
    const prediction = availablePredictionOf(
      current.analysisByCandidateId["draft-post"],
    );
    expect(prediction.qualityBasis).toBe("static");
  });

  it("drops an earlier refine once a newer refine starts (latest request id wins)", async () => {
    const first = createDeferred<AnalyzePostsResponse>();
    const second = createDeferred<AnalyzePostsResponse>();
    const calls: Array<ReturnType<typeof createDeferred<AnalyzePostsResponse>>> =
      [first, second];
    let callIndex = 0;
    const analyze = vi.fn<WriterApiClient["analyzePosts"]>(async () => {
      const deferred = calls[callIndex];
      callIndex += 1;
      if (deferred === undefined) {
        throw new Error("Unexpected extra analyze call.");
      }
      return deferred.promise;
    });
    const apiClient = buildApiClient(analyze);

    let current = scoredAndJudgedModel();
    const publish = (
      update:
        | WriterPageModel
        | ((value: WriterPageModel) => WriterPageModel),
    ): void => {
      current = typeof update === "function" ? update(current) : update;
    };

    const firstRefine = runTwoPassRefine(apiClient, current, publish);
    // A newer refine begins before the first resolves (rapid re-judge).
    const secondRefine = runTwoPassRefine(apiClient, current, publish);

    const refinedFirst = buildAnalyzeResponse(
      { items: [{ id: "draft-post", text: draftText }], scoringContext: {}, presentation: { postCoachMode: "preview" } },
      {
        "draft-post": scoredItem(
          { id: "draft-post", text: draftText },
          {
            prediction: availablePrediction({
              qualityBasis: "judge",
              predictedMidImpressions: 1111,
            }),
          },
        ),
      },
    );
    const refinedSecond = buildAnalyzeResponse(
      { items: [{ id: "draft-post", text: draftText }], scoringContext: {}, presentation: { postCoachMode: "preview" } },
      {
        "draft-post": scoredItem(
          { id: "draft-post", text: draftText },
          {
            prediction: availablePrediction({
              qualityBasis: "judge",
              predictedMidImpressions: 9999,
            }),
          },
        ),
      },
    );

    // The newer refine resolves first and wins; the older one resolves late and
    // must be dropped rather than clobbering the newer prediction.
    second.resolve(refinedSecond);
    await secondRefine;
    first.resolve(refinedFirst);
    await firstRefine;

    const prediction = availablePredictionOf(
      current.analysisByCandidateId["draft-post"],
    );
    expect(prediction.predictedMidImpressions).toBe(9999);
  });
});

describe("runTwoPassRefine failure", () => {
  it("keeps the static prediction and surfaces an analysis error when pass-2 fails", async () => {
    const analyze = vi.fn<WriterApiClient["analyzePosts"]>(async () => {
      throw Object.assign(new Error("engine down"), {
        apiError: {
          code: "deterministic_analysis_failed",
          message: "Scoring failed for this candidate.",
          retryable: true,
          scope: "writer",
          status: 500,
        },
      });
    });
    const apiClient = buildApiClient(analyze);

    const { current } = await runWith(scoredAndJudgedModel(), (publish) =>
      runTwoPassRefine(apiClient, scoredAndJudgedModel(), publish),
    );

    // The static prediction remains visible and is never upgraded to judge.
    const prediction = availablePredictionOf(
      current.analysisByCandidateId["draft-post"],
    );
    expect(prediction.qualityBasis).toBe("static");
    // The judge verdict stays visible underneath the failed refine.
    expect(current.judge.status).toBe("ready");
    // An analysis error banner is surfaced for the failed pass-2.
    expect(current.routeError?.scope).toBe("writer");
    expect(current.routeErrorOrigin).toBe("analysis");
    expect(current.refinement.status).not.toBe("refined");
  });
});

describe("runTwoPassRefine no-op gates", () => {
  it("does not fire pass-2 when the judge is not ready", async () => {
    const analyze = judgeRefinedAnalyze();
    const apiClient = buildApiClient(analyze);
    const model = scoredAndJudgedModel({ judge: { status: "idle" } });

    await runWith(model, (publish) => runTwoPassRefine(apiClient, model, publish));

    expect(analyze).not.toHaveBeenCalled();
  });

  it("does not fire pass-2 when the draft text changed before refine starts", async () => {
    const analyze = judgeRefinedAnalyze();
    const apiClient = buildApiClient(analyze);
    // Idea no longer matches the scored candidate's text (judged stale).
    const model = scoredAndJudgedModel({
      idea: "A different idea than the one that was scored and judged.",
    });

    await runWith(model, (publish) => runTwoPassRefine(apiClient, model, publish));

    expect(analyze).not.toHaveBeenCalled();
  });

  it("does not fire pass-2 when the draft prediction is disabled", async () => {
    const analyze = judgeRefinedAnalyze();
    const apiClient = buildApiClient(analyze);
    const model = scoredAndJudgedModel({
      analysisByCandidateId: {
        "draft-post": {
          status: "ready",
          item: scoredItem(
            { id: "draft-post", text: draftText },
            {
              prediction: {
                status: "disabled",
                reason: "missing_followers",
                message: "Prediction needs follower count.",
              },
            },
          ),
        },
      },
    });

    await runWith(model, (publish) => runTwoPassRefine(apiClient, model, publish));

    expect(analyze).not.toHaveBeenCalled();
  });
});

describe("runJudgeDraft two-pass orchestration", () => {
  it("publishes the verdict before firing the refine pass", async () => {
    const analyze = judgeRefinedAnalyze();
    const judgeDraft = vi.fn(async () => judgedResponse);
    const apiClient = buildApiClient(analyze, judgeDraft);

    const model: WriterPageModel = {
      ...createInitialModel(),
      idea: draftText,
      candidates: [draftCandidate],
      analysisByCandidateId: { "draft-post": readyStaticAnalysis() },
    };

    let verdictPublishedBeforeAnalyze = false;
    let current = model;
    const publish = (
      update:
        | WriterPageModel
        | ((value: WriterPageModel) => WriterPageModel),
    ): void => {
      current = typeof update === "function" ? update(current) : update;
      if (current.judge.status === "ready" && analyze.mock.calls.length === 0) {
        verdictPublishedBeforeAnalyze = true;
      }
    };

    await runJudgeDraft(apiClient, model, publish);

    // The verdict must reach the model before the refine pass calls analyze, so
    // the JudgePanel renders ahead of the refining prediction.
    expect(verdictPublishedBeforeAnalyze).toBe(true);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("refines the prediction after a successful judge run", async () => {
    const analyze = judgeRefinedAnalyze();
    const apiClient = buildApiClient(analyze, vi.fn(async () => judgedResponse));

    const model: WriterPageModel = {
      ...createInitialModel(),
      idea: draftText,
      candidates: [draftCandidate],
      analysisByCandidateId: { "draft-post": readyStaticAnalysis() },
    };

    const { current } = await runWith(model, (publish) =>
      runJudgeDraft(apiClient, model, publish),
    );

    expect(current.judge.status).toBe("ready");
    const prediction = availablePredictionOf(
      current.analysisByCandidateId["draft-post"],
    );
    expect(prediction.qualityBasis).toBe("judge");
    expect(current.refinement.status).toBe("refined");
  });
});

describe("edit reset of refinement", () => {
  it("resets a refined refinement to skipped when the idea changes", () => {
    const model = scoredAndJudgedModel({
      refinement: { status: "refined", requestId: 4 },
    });

    const next = applyIdeaChange(model, "An edited idea after a refined verdict.");

    expect(next.refinement).toEqual({ status: "skipped" });
  });

  it("resets a running refinement to skipped when the idea changes", () => {
    const model = scoredAndJudgedModel({
      refinement: { status: "running", requestId: 2 },
    });

    const next = applyIdeaChange(model, "An edit landing mid-refine.");

    expect(next.refinement).toEqual({ status: "skipped" });
  });

  it("resets refinement to skipped when the follower draft changes", () => {
    const model = scoredAndJudgedModel({
      refinement: { status: "refined", requestId: 6 },
    });

    const next = applyFollowerDraftChange(model, "1200");

    expect(next.refinement).toEqual({ status: "skipped" });
  });
});

// Local deferred helper (mirrors writer-page.test.tsx) so a pending pass-2 can
// be held open to exercise the stale-guard and latest-wins races.
function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}
