import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AnalyzedPostItem,
  AnalyzePostsRequest,
  AnalyzePostsResponse,
  ApiError,
  EngagementPrediction,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
  GeneratedIdeaCandidate,
  PostCoachViewModel,
} from "@x-builder/shared";

const writerPageModulePath = "../writer-page";
const learningCaveat = "Static rule check. Imported performance data is not connected yet.";

type ScoredAnalyzedPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;
type ScoreFailedAnalyzedPostItem = Extract<
  AnalyzedPostItem,
  { status: "score_failed" }
>;
type ReadyPostCoachViewModel = Extract<PostCoachViewModel, { state: "ready" }>;
type AvailableEngagementPrediction = Extract<
  EngagementPrediction,
  { status: "available" }
>;

type WriterApiClient = {
  analyzePosts: (input: AnalyzePostsRequest) => Promise<AnalyzePostsResponse>;
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
};

type WriterPageProps = {
  apiClient: WriterApiClient;
  onOpenSettings: () => void;
};

type WriterPagePublicDriverOptions = WriterPageProps & {
  renderPage?: (props: WriterPageProps) => ReactElement;
};

type WriterPagePublicDriver = {
  applyFollowers: () => Promise<string>;
  closeDetails: () => string;
  closeDetailsWithEscape: () => {
    activeTarget: string;
    focusRequest: number;
    html: string;
  };
  generate: () => Promise<string>;
  focusFollowers: () => {
    activeTarget: string;
    focusRequest: number;
    html: string;
  };
  openDetails: (itemId: string) => Promise<string>;
  openSettings: () => void;
  render: () => string;
  retry: () => Promise<string>;
  retryDetails: () => Promise<string>;
  retryScore: (itemId: string) => Promise<string>;
  scoreDraft: () => Promise<string>;
  updateFollowers: (followers: string) => string;
  updateIdea: (idea: string) => string;
};

type WriterPageModule = {
  WriterPage: (props: WriterPageProps) => ReactElement;
  createWriterPagePublicDriver: (
    options: WriterPagePublicDriverOptions,
  ) => WriterPagePublicDriver;
};

async function loadWriterPage() {
  return (await import(writerPageModulePath)) as WriterPageModule;
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function expectIdeaPreserved(html: string, idea: string) {
  expect(html).toContain(escapeHtml(idea));
}

function flushAsyncTasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve()).then(() => undefined);
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

function createValidIdeaResponse(): GenerateIdeaResponse {
  return {
    candidates: [
      {
        format: "one-liner",
        id: "candidate-one-liner",
        text: "Local-first writing tools need boring edges.",
      },
      {
        format: "mini-framework",
        id: "candidate-mini-framework",
        text: "Name the constraint, show the tradeoff, then make the local-first call.",
      },
      {
        format: "debate-question",
        id: "candidate-debate-question",
        text: "What local-first compromise would make builders trust the tool more?",
      },
    ],
  };
}

function readyPostCoach(
  overrides: Partial<ReadyPostCoachViewModel> = {},
): ReadyPostCoachViewModel {
  const failedCheck = {
    id: "specificity",
    label: "Needs one concrete proof",
    status: "fail" as const,
  };
  const warnedCheck = {
    id: "ending_question",
    label: "Question could be sharper",
    status: "warn" as const,
  };
  const passedCheck = {
    id: "plain_language",
    label: "Plain language",
    status: "pass" as const,
  };

  return {
    state: "ready",
    title: "Post Coach",
    value: 74,
    badge: {
      label: "Ship it",
      tone: "ship",
      tooltip: "Solid post. Ship it; higher scores are a bonus.",
    },
    target: 60,
    engageability: {
      engageable: true,
      reason: "Ends with a concrete question.",
    },
    failed: [failedCheck],
    warned: [warnedCheck],
    passed: [passedCheck],
    counts: {
      flagged: 1,
      nudges: 1,
      onPoint: 1,
    },
    expanded: false,
    previewMode: true,
    sections: [
      {
        title: "Worth a look",
        items: [failedCheck],
      },
      {
        title: "Nudges",
        items: [warnedCheck],
      },
      {
        title: "On point",
        items: [passedCheck],
      },
    ],
    learnings: [
      {
        text: "Static rule evidence: concrete examples make posts easier to evaluate.",
        relevance: "general",
      },
    ],
    learningCaveat,
    hiddenChecks: 0,
    helperText: "Signals, not verdicts.",
    footerText: "Static heuristic checks only.",
    ...overrides,
  };
}

function availablePrediction(
  overrides: Partial<AvailableEngagementPrediction> = {},
): AvailableEngagementPrediction {
  // End-state four-regime contract: no legacy mirror fields. Tests that need a
  // distinct reach value override stallRange/predictedMidImpressions directly.
  return {
    status: "available",
    signals: [
      {
        signal_key: "voice_score",
        label: "Static score 74",
        multiplier: 0.9,
      },
      {
        signal_key: "manual_followers",
        label: "Manual follower context",
        multiplier: 1.2,
      },
    ],
    predictedMidImpressions: 1500,
    stallRange: { low: 800, high: 2400 },
    escapeRange: { low: 6000, high: 40000 },
    escapeProbability: 0.12,
    expectedReplies: 9,
    baseImpressions: 1500,
    baseSource: "follower_estimate",
    qualityBasis: "static",
    reachModelVersion: "reach-v1",
    ...overrides,
  };
}

function scoredAnalysisItem(
  candidate: GeneratedIdeaCandidate,
  overrides: Partial<ScoredAnalyzedPostItem> = {},
): ScoredAnalyzedPostItem {
  return {
    status: "scored",
    id: candidate.id,
    text: candidate.text,
    sourceFormat: candidate.format,
    detectedFormat: "insight_share",
    score: {
      value: 74,
      checks: [
        {
          id: "plain_language",
          label: "Plain language",
          status: "pass",
        },
      ],
      learnings: [
        {
          text: "Static rule evidence: concrete examples make posts easier to evaluate.",
          relevance: "general",
        },
      ],
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
    ...overrides,
  };
}

function scoreFailedAnalysisItem(
  candidate: GeneratedIdeaCandidate,
  overrides: Partial<ScoreFailedAnalyzedPostItem> = {},
): ScoreFailedAnalyzedPostItem {
  return {
    status: "score_failed",
    id: candidate.id,
    text: candidate.text,
    sourceFormat: candidate.format,
    reason: "analysis_failed",
    message: "Deterministic analysis failed for this candidate.",
    retryable: true,
    ...overrides,
  };
}

function createAnalyzePostsResponse(
  response: GenerateIdeaResponse = createValidIdeaResponse(),
): AnalyzePostsResponse {
  return {
    items: response.candidates.map((candidate) => scoredAnalysisItem(candidate)),
  };
}

function expectedAnalyzePostsRequest(
  candidates: GeneratedIdeaCandidate[],
  scoringContext: AnalyzePostsRequest["scoringContext"] = {},
): AnalyzePostsRequest {
  return {
    items: candidates.map((candidate) => ({
      id: candidate.id,
      text: candidate.text,
      sourceFormat: candidate.format,
    })),
    presentation: {
      postCoachMode: "preview",
    },
    scoringContext,
  };
}

function expectedAnalyzePostsRequestFor(
  candidate: GeneratedIdeaCandidate,
  scoringContext: AnalyzePostsRequest["scoringContext"] = {},
): AnalyzePostsRequest {
  return expectedAnalyzePostsRequest([candidate], scoringContext);
}

function expectedExpandedAnalyzePostsRequestFor(
  candidate: GeneratedIdeaCandidate,
  scoringContext: AnalyzePostsRequest["scoringContext"] = {},
): AnalyzePostsRequest {
  return {
    ...expectedAnalyzePostsRequestFor(candidate, scoringContext),
    presentation: {
      postCoachMode: "expanded",
    },
  };
}

function candidateTextSegment(
  text: string,
  currentCandidateText: string,
  nextCandidateText?: string,
) {
  const start = text.indexOf(currentCandidateText);
  expect(start).toBeGreaterThanOrEqual(0);
  const end =
    nextCandidateText === undefined
      ? text.length
      : text.indexOf(nextCandidateText, start + currentCandidateText.length);

  expect(end).toBeGreaterThan(start);

  return text.slice(start, end);
}

function candidateHtmlSegment(
  html: string,
  currentCandidateText: string,
  nextCandidateText?: string,
) {
  const escapedCurrentText = escapeHtml(currentCandidateText);
  const escapedNextText =
    nextCandidateText === undefined ? undefined : escapeHtml(nextCandidateText);
  const start = html.indexOf(escapedCurrentText);
  expect(start).toBeGreaterThanOrEqual(0);
  const end =
    escapedNextText === undefined
      ? html.length
      : html.indexOf(escapedNextText, start + escapedCurrentText.length);

  expect(end).toBeGreaterThan(start);

  return html.slice(start, end);
}

function dialogTextSegment(html: string) {
  const start = html.indexOf('role="dialog"');
  expect(start).toBeGreaterThanOrEqual(0);

  return textContent(html.slice(start));
}

function createApiError(overrides: Partial<ApiError> = {}): ApiError {
  return {
    code: "engine_unreachable",
    message: "Could not reach the local engine. Your idea is still here.",
    retryable: true,
    scope: "writer",
    status: 503,
    ...overrides,
  };
}

function throwApiError(apiError: ApiError): never {
  throw Object.assign(new Error(apiError.message), {
    apiError,
  });
}

function createApiClient(
  generateIdea: WriterApiClient["generateIdea"] = vi.fn(async () =>
    createValidIdeaResponse(),
  ),
  analyzePosts: WriterApiClient["analyzePosts"] = vi.fn(async () =>
    createAnalyzePostsResponse(),
  ),
): WriterApiClient {
  return {
    analyzePosts,
    generateIdea,
  };
}

function createDriver(
  createWriterPagePublicDriver: WriterPageModule["createWriterPagePublicDriver"],
  options: WriterPagePublicDriverOptions,
) {
  return createWriterPagePublicDriver(options);
}

describe("WriterPage manual follower prediction context", () => {
  it("renders manual follower context while empty followers keep prediction missing and score visible", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () =>
      createAnalyzePostsResponse(response),
    );
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Manual followers should not be required for Draft Review.");
    const html = await driver.generate();
    const text = textContent(html);

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith(
      expectedAnalyzePostsRequest(response.candidates),
    );
    expect(text).toContain("Manual account context");
    expect(text).toContain("Followers");
    expect(text).toContain("Static score");
    expect(text).toContain("Prediction needs follower count.");
  });

  it("submits valid manual followers with analysis and renders available prediction results", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () => ({
      items: response.candidates.map((candidate) =>
        scoredAnalysisItem(candidate, {
          prediction: availablePrediction(),
        }),
      ),
    }));
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateFollowers("2400");
    driver.updateIdea("Use follower count only for this prediction request.");
    const html = await driver.generate();
    const text = textContent(html);

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith(
      expectedAnalyzePostsRequest(response.candidates, { followers: 2400 }),
    );
    expect(text).toContain("800 – 2,400");
    expect(text).toContain("12% escape");
    expect(text).not.toContain("missing_followers");
  });

  it("shows inline validation while recomputing invalid followers without prediction context", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () =>
      createAnalyzePostsResponse(response),
    );
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Invalid follower edits should stay local.");
    await driver.generate();
    driver.updateFollowers("not-a-number");
    const html = await driver.applyFollowers();

    expect(textContent(html)).toContain(
      "Enter your current follower count to estimate impressions.",
    );
    expect(textContent(html)).toContain("Prediction needs follower count.");

    expect(apiClient.generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequest(response.candidates),
    );
  });

  it("still scores generated candidates when follower input is invalid", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () =>
      createAnalyzePostsResponse(response),
    );
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateFollowers("not-a-number");
    driver.updateIdea("Invalid followers should not block deterministic scoring.");
    const html = await driver.generate();
    const text = textContent(html);

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith(
      expectedAnalyzePostsRequest(response.candidates),
    );
    expect(text).toContain("Enter your current follower count to estimate impressions.");
    expect(text).toContain("Static score");
    expect(text).toContain("Prediction needs follower count.");
  });

  it("recomputes prediction analysis with updated followers without regenerating candidates", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: response.candidates.map((candidate) =>
          scoredAnalysisItem(candidate, {
            prediction: availablePrediction({
              predictedMidImpressions: 480,
              stallRange: { low: 320, high: 640 },
            }),
          }),
        ),
      }));
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const apiClient = createApiClient(generateIdea, analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Follower changes should only refresh deterministic analysis.");
    await driver.generate();
    const staleHtml = driver.updateFollowers("4800");
    const staleText = textContent(staleHtml);

    expect(staleText).toContain("Prediction needs refresh.");
    expect(staleText).toContain("Recompute prediction");

    const recomputedHtml = await driver.applyFollowers();
    const recomputedText = textContent(recomputedHtml);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequest(response.candidates, { followers: 4800 }),
    );
    expect(recomputedText).toContain("320 – 640");
    expect(recomputedText).toContain(response.candidates[0]?.text);
  });

  it("does not persist manual followers into a fresh writer route render", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const apiClient = createApiClient(vi.fn(async () => response));
    const firstDriver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    firstDriver.updateFollowers("2400");
    firstDriver.updateIdea("Follower context should be request scoped.");
    await firstDriver.generate();

    const freshDriver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });
    const freshHtml = freshDriver.render();
    const freshText = textContent(freshHtml);

    expect(freshText).toContain("Manual account context");
    expect(freshText).toContain("Followers");
    expect(freshHtml).toContain('id="deterministic-followers"');
    expect(freshHtml).not.toContain('value="2400"');
    expect(freshText).not.toContain("manual");
  });
});

describe("WriterPage generation behavior", () => {
  it("keeps follower context inside the score-card column", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    const html = driver.render();

    expect(html.indexOf('id="deterministic-followers"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('id="writer-idea"')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('id="deterministic-followers"')).toBeGreaterThan(
      html.indexOf('class="xb-writer-results-stack"'),
    );
    expect(html).toContain('class="xb-writer-workspace"');
    expect(html).toContain('class="xb-writer-results"');
  });

  it("renders empty evaluation cards before a draft is typed", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    const text = textContent(driver.render());

    expect(text).toContain("Engagement Prediction");
    expect(text).toContain("Prediction unavailable");
    expect(text).toContain("Paste a draft and add followers to estimate impressions.");
    expect(text).toContain("Draft Review");
    expect(text).toContain("Paste a draft to see static review checks.");
  });

  it("scores a typed draft without generating variants", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const draftText =
      "Stripe checkout taught me to remove one field before adding another.";
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async (request) => ({
      items: request.items.map((item) =>
        scoredAnalysisItem(
          {
            format: "one-liner",
            id: item.id,
            text: item.text,
          },
          {
            sourceFormat: item.sourceFormat,
          },
        ),
      ),
    }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(generateIdea, analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(draftText);
    const html = await driver.scoreDraft();
    const text = textContent(html);

    expect(generateIdea).not.toHaveBeenCalled();
    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith({
      items: [
        {
          id: "draft-post",
          sourceFormat: undefined,
          text: draftText,
        },
      ],
      presentation: {
        postCoachMode: "preview",
      },
      scoringContext: {},
    });
    expect(text).toContain("Engagement Prediction");
    expect(text).toContain("Draft Review");
    expect(text.indexOf("Engagement Prediction")).toBeLessThan(
      text.indexOf("Draft Review"),
    );
    expect(text).toContain("74");
    expect(text).toContain(draftText);
  });

  it("keeps empty submissions local and shows a field error", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const apiClient = createApiClient();
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("   ");
    const html = await driver.generate();

    expect(apiClient.generateIdea).not.toHaveBeenCalled();
    expect(textContent(html)).toContain("Enter an idea before generating.");
  });

  it("submits valid ideas through the typed API boundary and renders three candidates", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const apiClient = createApiClient(vi.fn(async () => response));
    const idea = "Make a local-first writing tool feel trustworthy.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expect(apiClient.generateIdea).toHaveBeenCalledOnce();
    expect(apiClient.generateIdea).toHaveBeenCalledWith({
      idea,
    });
    expect(text).toContain("Local-first writing tools need boring edges.");
    expect(text).toContain(
      "Name the constraint, show the tradeoff, then make the local-first call.",
    );
    expect(text).toContain(
      "What local-first compromise would make builders trust the tool more?",
    );
    expect(text).toContain("One-liner");
    expect(text).toContain("Mini framework");
    expect(text).toContain("Debate question");
  });

  it("keeps generated variants visible when draft auto scoring checks again", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(
      async () => createAnalyzePostsResponse(response),
    );
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(generateIdea, analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Generate variants, then do not replace them with draft scoring.");
    await driver.generate();
    const html = await driver.scoreDraft();
    const text = textContent(html);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(text).toContain("One-liner");
    expect(text).toContain("Mini framework");
    expect(text).toContain("Debate question");
    expect(text).not.toContain("Current draft");
  });

  it("renders generated candidate text while scoring is still loading", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analysis = createDeferred<AnalyzePostsResponse>();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(
      () => analysis.promise,
    );
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Make scoring visibly separate from generation.");
    const generate = driver.generate();
    await flushAsyncTasks();
    const pendingHtml = driver.render();
    const pendingText = textContent(pendingHtml);

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith(
      expectedAnalyzePostsRequest(response.candidates),
    );
    expect(pendingText).toContain("Local-first writing tools need boring edges.");
    expect(pendingText).toContain(
      "Name the constraint, show the tradeoff, then make the local-first call.",
    );
    expect(pendingText).toContain(
      "What local-first compromise would make builders trust the tool more?",
    );
    expect(pendingText).toContain("Scoring candidate");

    analysis.resolve(createAnalyzePostsResponse(response));
    await generate;
  });

  it("keeps newer idea edits when generation resolves from an older request", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const generation = createDeferred<GenerateIdeaResponse>();
    const response = createValidIdeaResponse();
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(
      () => generation.promise,
    );
    const apiClient = createApiClient(generateIdea);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });
    const originalIdea = "Generate from this request-start draft.";
    const editedIdea = "Keep this newer draft edit visible.";

    driver.updateIdea(originalIdea);
    const generate = driver.generate();
    await flushAsyncTasks();
    driver.updateIdea(editedIdea);
    generation.resolve(response);
    const html = await generate;

    expect(generateIdea).toHaveBeenCalledWith({
      idea: originalIdea,
    });
    expectIdeaPreserved(html, editedIdea);
  });

  it("ignores older generation responses after a newer run succeeds", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const olderGeneration = createDeferred<GenerateIdeaResponse>();
    const newerGeneration = createDeferred<GenerateIdeaResponse>();
    const olderResponse: GenerateIdeaResponse = {
      candidates: [
        {
          format: "one-liner",
          id: "older-candidate",
          text: "Older generated text should not replace the current run.",
        },
      ],
    };
    const newerResponse: GenerateIdeaResponse = {
      candidates: [
        {
          format: "one-liner",
          id: "newer-candidate",
          text: "Newer generated text should remain visible.",
        },
      ],
    };
    const generateIdea = vi
      .fn<WriterApiClient["generateIdea"]>()
      .mockImplementationOnce(() => olderGeneration.promise)
      .mockImplementationOnce(() => newerGeneration.promise);
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(
      async (request) => ({
        items: request.items.map((item) =>
          scoredAnalysisItem(
            {
              format: item.sourceFormat ?? "one-liner",
              id: item.id,
              text: item.text,
            },
            {
              text: item.text,
            },
          ),
        ),
      }),
    );
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(generateIdea, analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Older generation request.");
    const olderRun = driver.generate();
    await flushAsyncTasks();
    driver.updateIdea("Newer generation request.");
    const newerRun = driver.generate();
    await flushAsyncTasks();

    newerGeneration.resolve(newerResponse);
    const newerHtml = await newerRun;
    olderGeneration.resolve(olderResponse);
    const finalHtml = await olderRun;
    const finalText = textContent(finalHtml);

    expect(generateIdea).toHaveBeenCalledTimes(2);
    expect(textContent(newerHtml)).toContain("Newer generated text should remain visible.");
    expect(finalText).toContain("Newer generated text should remain visible.");
    expect(finalText).not.toContain("Older generated text should not replace the current run.");
  });

  it("does not score stale generation responses after a newer run succeeds", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const olderGeneration = createDeferred<GenerateIdeaResponse>();
    const newerGeneration = createDeferred<GenerateIdeaResponse>();
    const olderResponse: GenerateIdeaResponse = {
      candidates: [
        {
          format: "one-liner",
          id: "older-candidate",
          text: "Older generated text should not be scored.",
        },
      ],
    };
    const newerResponse: GenerateIdeaResponse = {
      candidates: [
        {
          format: "one-liner",
          id: "newer-candidate",
          text: "Newer generated text should be scored.",
        },
      ],
    };
    const generateIdea = vi
      .fn<WriterApiClient["generateIdea"]>()
      .mockImplementationOnce(() => olderGeneration.promise)
      .mockImplementationOnce(() => newerGeneration.promise);
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(
      async (request) => ({
        items: request.items.map((item) =>
          scoredAnalysisItem({
            format: item.sourceFormat ?? "one-liner",
            id: item.id,
            text: item.text,
          }),
        ),
      }),
    );
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(generateIdea, analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Older generation request.");
    const olderRun = driver.generate();
    await flushAsyncTasks();
    driver.updateIdea("Newer generation request.");
    const newerRun = driver.generate();
    await flushAsyncTasks();

    newerGeneration.resolve(newerResponse);
    await newerRun;
    olderGeneration.resolve(olderResponse);
    await olderRun;

    expect(generateIdea).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith(
      expectedAnalyzePostsRequest(newerResponse.candidates),
    );
  });

  it("uses latest follower draft when generation resolves after follower edits", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const generation = createDeferred<GenerateIdeaResponse>();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () => ({
      items: response.candidates.map((candidate) =>
        scoredAnalysisItem(candidate, {
          prediction: availablePrediction({
            predictedMidImpressions: 1050,
            stallRange: { low: 700, high: 1400 },
          }),
        }),
      ),
    }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(() => generation.promise), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateFollowers("4200");
    driver.updateIdea("Follower edits during generation should not strand scoring.");
    const generate = driver.generate();
    await flushAsyncTasks();
    driver.updateFollowers("7777");

    generation.resolve(response);
    const html = await generate;
    const text = textContent(html);

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith(
      expectedAnalyzePostsRequest(response.candidates, { followers: 7777 }),
    );
    expect(html).toContain('value="7777"');
    expect(text).toContain("700 – 1,400");
    expect(text).not.toContain("Scoring candidate");
    expect(text).not.toContain("Prediction needs refresh.");
  });

  it("attaches successful scoring results to their generated candidates by candidate id", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const analysisResponse: AnalyzePostsResponse = {
      items: [
        scoredAnalysisItem(debateQuestion, {
          score: {
            ...scoredAnalysisItem(debateQuestion).score,
            value: 61,
          },
          postCoach: readyPostCoach({
            value: 61,
            badge: {
              label: "Ship it",
              tone: "ship",
              tooltip: "The debate question is ready to test.",
            },
          }),
        }),
        scoredAnalysisItem(oneLiner, {
          score: {
            ...scoredAnalysisItem(oneLiner).score,
            value: 84,
          },
          postCoach: readyPostCoach({
            value: 84,
            badge: {
              label: "Top tier",
              tone: "top",
              tooltip: "The one-liner is unusually clear.",
            },
          }),
        }),
        scoredAnalysisItem(miniFramework, {
          score: {
            ...scoredAnalysisItem(miniFramework).score,
            value: 39,
          },
          postCoach: readyPostCoach({
            value: 39,
            badge: {
              label: "Rework",
              tone: "rework",
              tooltip: "The framework needs sharper contrast.",
            },
          }),
        }),
      ],
    };
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(
      async () => analysisResponse,
    );
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Map deterministic scores to the generated cards by id.");
    await driver.generate();
    await flushAsyncTasks();
    const text = textContent(driver.render());

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledWith(
      expectedAnalyzePostsRequest(response.candidates),
    );
    expect(candidateTextSegment(text, oneLiner.text, miniFramework.text)).toContain(
      "84",
    );
    expect(candidateTextSegment(text, oneLiner.text, miniFramework.text)).toContain(
      "Top tier",
    );
    expect(
      candidateTextSegment(text, miniFramework.text, debateQuestion.text),
    ).toContain("39");
    expect(
      candidateTextSegment(text, miniFramework.text, debateQuestion.text),
    ).toContain("Rework");
    expect(candidateTextSegment(text, debateQuestion.text)).toContain("61");
    expect(candidateTextSegment(text, debateQuestion.text)).toContain("Static score");
    expect(text).toContain("Prediction needs follower count.");
  });

  it("keeps generated source slot in candidate metadata when analysis reports a different format", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () => ({
      items: [
        scoredAnalysisItem(oneLiner),
        scoredAnalysisItem(miniFramework, {
          sourceFormat: oneLiner.format,
          detectedFormat: "insight_share",
        }),
        scoredAnalysisItem(debateQuestion),
      ],
    }));
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Render the writer slot separately from analyzer metadata.");
    await driver.generate();
    await flushAsyncTasks();
    const html = driver.render();
    const miniFrameworkHtml = candidateHtmlSegment(
      html,
      miniFramework.text,
      debateQuestion.text,
    );

    expect(html.indexOf("Mini framework")).toBeLessThan(html.indexOf(miniFramework.text));
    expect(miniFrameworkHtml).not.toContain("One-liner");

    const detailText = dialogTextSegment(await driver.openDetails(miniFramework.id));

    expect(detailText).toContain("Source format");
    expect(detailText).toContain("mini-framework");
    expect(detailText).toContain("Detected format");
    expect(detailText).toContain("insight_share");
  });

  it("keeps failed scored candidate text visible with a score retry action", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () => ({
      items: [
        scoredAnalysisItem(oneLiner),
        scoreFailedAnalysisItem(miniFramework),
        scoredAnalysisItem(debateQuestion),
      ],
    }));
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("A scoring failure should not erase generated text.");
    await driver.generate();
    await flushAsyncTasks();
    const text = textContent(driver.render());

    expect(text).toContain(miniFramework.text);
    expect(text).toContain("Deterministic analysis failed for this candidate.");
    expect(text).toContain("Retry score");
    expect(text).toContain(oneLiner.text);
    expect(text).toContain(debateQuestion.text);
  });

  it("turns partial analysis responses into terminal per-candidate errors", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () => ({
      items: [scoredAnalysisItem(oneLiner)],
    }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Partial scoring responses should not leave cards loading.");
    const html = await driver.generate();
    const text = textContent(html);

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(text).toContain(oneLiner.text);
    expect(text).toContain(miniFramework.text);
    expect(text).toContain(debateQuestion.text);
    expect(text).toContain("Could not score candidate");
    expect(text).toContain("Scoring did not return a result for this candidate.");
    expect(text).toContain("Retry score");
    expect(text).not.toContain("Scoring candidate");
  });

  it("surfaces full analysis route failures without turning every card into score_failed", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analysisError = createApiError({
      code: "deterministic_analysis_failed",
      message: "Deterministic scoring is temporarily unavailable.",
      retryable: true,
      scope: "writer",
      status: 503,
    });
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(async () =>
      throwApiError(analysisError),
    );
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Full scoring outages should keep drafts visible.");
    await driver.generate();
    await flushAsyncTasks();
    const text = textContent(driver.render());

    expect(analyzePosts).toHaveBeenCalledOnce();
    for (const candidate of response.candidates) {
      expect(text).toContain(candidate.text);
    }
    expect(text).toContain("Route unavailable");
    expect(text).toContain("Deterministic scoring is temporarily unavailable.");
    expect(text).toContain("Retry");
    expect(text).not.toContain("Deterministic analysis failed for this candidate.");
    expect(text).not.toContain("Retry score");
  });

  it("retries a full analysis route failure without regenerating candidates", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analysisError = createApiError({
      code: "deterministic_analysis_failed",
      message: "Deterministic scoring is temporarily unavailable.",
      retryable: true,
      scope: "writer",
      status: 503,
    });
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => throwApiError(analysisError))
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response));
    const apiClient = createApiClient(generateIdea, analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Route retry should resume deterministic scoring only.");
    await driver.generate();
    await flushAsyncTasks();
    const retryHtml = await driver.retry();
    const retryText = textContent(retryHtml);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequest(response.candidates),
    );
    expect(retryText).not.toContain("Route unavailable");
    expect(retryText).toContain("Static score");
    for (const candidate of response.candidates) {
      expect(retryText).toContain(candidate.text);
    }
  });

  it("retries analysis transport failures without regenerating candidates", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const analysisError = createApiError({
      code: "engine_unreachable",
      message: "Could not reach the engine while scoring.",
      retryable: true,
      scope: "route",
      status: 503,
    });
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => throwApiError(analysisError))
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response));
    const apiClient = createApiClient(generateIdea, analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Transport failures from analysis should not regenerate.");
    await driver.generate();
    await flushAsyncTasks();
    const retryText = textContent(await driver.retry());

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequest(response.candidates),
    );
    expect(retryText).toContain("Static score");
    expect(retryText).not.toContain("Could not reach the engine while scoring.");
  });

  it("retries scoring for an existing candidate without regenerating text", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner),
          scoreFailedAnalysisItem(miniFramework),
          scoredAnalysisItem(debateQuestion),
        ],
      }))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(miniFramework, {
            score: {
              ...scoredAnalysisItem(miniFramework).score,
              value: 91,
            },
            postCoach: readyPostCoach({
              value: 91,
              badge: {
                label: "Top tier",
                tone: "top",
                tooltip: "The retried framework is now strong.",
              },
            }),
          }),
        ],
      }));
    const apiClient = createApiClient(generateIdea, analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Retry score should reuse the generated candidate.");
    await driver.generate();
    await flushAsyncTasks();
    const retryHtml = await driver.retryScore(miniFramework.id);
    const retryText = textContent(retryHtml);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequestFor(miniFramework),
    );
    expect(retryText).toContain(miniFramework.text);
    expect(retryText).toContain("91");
    expect(retryText).toContain("Top tier");
  });

  it("retries scoring with invalid followers by omitting prediction context", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner),
          scoreFailedAnalysisItem(miniFramework),
          scoredAnalysisItem(debateQuestion),
        ],
      }))
      .mockImplementationOnce(async () => ({
        items: [scoredAnalysisItem(miniFramework)],
      }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(generateIdea, analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Invalid followers should not block score retry.");
    await driver.generate();
    driver.updateFollowers("not-a-number");
    const retryHtml = await driver.retryScore(miniFramework.id);
    const retryText = textContent(retryHtml);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequestFor(miniFramework),
    );
    expect(retryText).toContain("Enter your current follower count to estimate impressions.");
    expect(retryText).toContain("Prediction needs follower count.");
    expect(retryText).toContain(miniFramework.text);
  });

  it("keeps the existing score_failed card when score retry hits a route failure", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const analysisError = createApiError({
      code: "deterministic_analysis_failed",
      message: "Deterministic scoring is temporarily unavailable.",
      retryable: true,
      scope: "writer",
      status: 503,
    });
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner),
          scoreFailedAnalysisItem(miniFramework),
          scoredAnalysisItem(debateQuestion),
        ],
      }))
      .mockImplementationOnce(async () => throwApiError(analysisError));
    const apiClient = createApiClient(generateIdea, analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Retry score route failures should not regenerate.");
    await driver.generate();
    await flushAsyncTasks();
    const retryHtml = await driver.retryScore(miniFramework.id);
    const retryText = textContent(retryHtml);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequestFor(miniFramework),
    );
    expect(retryText).toContain("Route unavailable");
    expect(retryText).toContain("Deterministic scoring is temporarily unavailable.");
    expect(retryText).toContain(miniFramework.text);
    expect(retryText).toContain("Deterministic analysis failed for this candidate.");
    expect(retryText).toContain("Retry score");
  });

  it("keeps newer analysis success when an older analysis failure resolves later", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const olderAnalysis = createDeferred<AnalyzePostsResponse>();
    const newerAnalysis = createDeferred<AnalyzePostsResponse>();
    const staleError = createApiError({
      code: "deterministic_analysis_failed",
      message: "Older scoring failure should not replace newer success.",
      retryable: true,
      scope: "writer",
      status: 503,
    });
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(() => olderAnalysis.promise)
      .mockImplementationOnce(() => newerAnalysis.promise);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Late scoring failures should not erase newer results.");
    await driver.generate();
    driver.updateFollowers("4200");
    const olderRun = driver.applyFollowers();
    await flushAsyncTasks();
    driver.updateFollowers("7777");
    driver.updateFollowers("4200");
    const newerRun = driver.applyFollowers();
    await flushAsyncTasks();

    newerAnalysis.resolve({
      items: response.candidates.map((candidate) =>
        scoredAnalysisItem(candidate, {
          prediction: availablePrediction({
            predictedMidImpressions: 700,
            stallRange: { low: 500, high: 900 },
          }),
        }),
      ),
    });
    const newerHtml = await newerRun;
    olderAnalysis.reject(Object.assign(new Error(staleError.message), { apiError: staleError }));
    const finalHtml = await olderRun;
    const finalText = textContent(finalHtml);

    expect(analyzePosts).toHaveBeenCalledTimes(3);
    expect(textContent(newerHtml)).toContain("500 – 900");
    expect(finalText).toContain("500 – 900");
    expect(finalText).not.toContain("Older scoring failure should not replace newer success.");
    expect(finalText).not.toContain("Route unavailable");
  });

  it("does not start duplicate analysis while generated candidates are still being scored", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner] = response.candidates;
    if (oneLiner === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const analysis = createDeferred<AnalyzePostsResponse>();
    const analyzePosts = vi.fn<WriterApiClient["analyzePosts"]>(
      () => analysis.promise,
    );
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Preview scoring should be the only active analysis request.");
    const generate = driver.generate();
    await flushAsyncTasks();

    await driver.openDetails(oneLiner.id);
    await driver.retryScore(oneLiner.id);
    await driver.applyFollowers();

    expect(analyzePosts).toHaveBeenCalledOnce();
    expect(textContent(driver.render())).toContain("Scoring candidate");

    analysis.resolve(createAnalyzePostsResponse(response));
    const html = await generate;

    expect(textContent(html)).toContain("Static score");
  });

  it("keeps newer edits when follower recompute resolves from an older draft", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const recompute = createDeferred<AnalyzePostsResponse>();
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(() => recompute.promise);
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Follower recompute should merge into latest state.");
    await driver.generate();
    driver.updateFollowers("4200");
    const applyFollowers = driver.applyFollowers();
    await flushAsyncTasks();
    driver.updateFollowers("7777");
    recompute.resolve({
      items: response.candidates.map((candidate) =>
        scoredAnalysisItem(candidate, {
          prediction: availablePrediction({
            predictedMidImpressions: 630,
            stallRange: { low: 420, high: 840 },
          }),
        }),
      ),
    });
    const html = await applyFollowers;
    const text = textContent(html);

    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequest(response.candidates, {
        followers: 4200,
      }),
    );
    expect(html).toContain('value="7777"');
    expect(text).toContain("Prediction needs refresh.");
    expect(text).not.toContain("420 – 840");
    expect(text).not.toContain("Typical reach");
  });

  it("keeps newer idea edits when score retry resolves", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const retryAnalysis = createDeferred<AnalyzePostsResponse>();
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner),
          scoreFailedAnalysisItem(miniFramework),
          scoredAnalysisItem(debateQuestion),
        ],
      }))
      .mockImplementationOnce(() => retryAnalysis.promise);
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });
    const editedIdea = "Keep the user edit while retry scoring completes.";

    driver.updateIdea("Retry scoring should preserve later idea edits.");
    await driver.generate();
    const retryScore = driver.retryScore(miniFramework.id);
    await flushAsyncTasks();
    driver.updateIdea(editedIdea);
    retryAnalysis.resolve({
      items: [scoredAnalysisItem(miniFramework)],
    });
    const html = await retryScore;

    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedAnalyzePostsRequestFor(miniFramework),
    );
    expectIdeaPreserved(html, editedIdea);
    expect(textContent(html)).toContain(miniFramework.text);
  });

  it("opens details for a scored candidate with expanded Post Coach analysis", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const detailPostCoach = readyPostCoach({
      expanded: true,
      previewMode: false,
      hiddenChecks: 0,
      sections: [
        {
          title: "Worth a look",
          items: [
            {
              id: "api-detail-check",
              label: "API detail says the middle clause needs proof",
              status: "warn",
            },
          ],
        },
      ],
      learnings: [
        {
          text: "Detail learning from expanded API data.",
          relevance: "matched",
        },
      ],
    });
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(miniFramework, {
            detectedFormat: "story",
            postCoach: detailPostCoach,
            prediction: availablePrediction({
              predictedMidImpressions: 585,
              stallRange: { low: 410, high: 760 },
            }),
          }),
        ],
      }));
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const apiClient = createApiClient(generateIdea, analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Open the scored candidate detail inspector.");
    await driver.generate();
    const html = await driver.openDetails(miniFramework.id);
    const text = textContent(html);
    const dialogText = dialogTextSegment(html);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedExpandedAnalyzePostsRequestFor(miniFramework),
    );
    expect(html).toContain('role="dialog"');
    expect(dialogText).toContain("Deterministic details");
    expect(dialogText).toContain(miniFramework.text);
    expect(dialogText).toContain("74");
    expect(dialogText).toContain("Source format");
    expect(dialogText).toContain("mini-framework");
    expect(dialogText).toContain("Detected format");
    expect(dialogText).toContain("story");
    expect(dialogText).toContain("deterministic-v1");
    expect(dialogText).toContain("2026-06-07T12:00:00.000Z");
    expect(dialogText).toContain("Worth a look");
    expect(dialogText).toContain("API detail says the middle clause needs proof");
    expect(dialogText).toContain("Detail learning from expanded API data.");
    expect(dialogText).toContain("410 – 760");
    expect(dialogText).toContain("585");
    expect(text).toContain(oneLiner.text);
    expect(text).toContain(debateQuestion.text);
  });

  it("closes stale details when a new generation succeeds", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const firstResponse = createValidIdeaResponse();
    const [oneLiner] = firstResponse.candidates;
    if (oneLiner === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const nextResponse: GenerateIdeaResponse = {
      candidates: [
        {
          format: "one-liner",
          id: "replacement-candidate",
          text: "Replacement candidate should not share stale details.",
        },
      ],
    };
    const generateIdea = vi
      .fn<WriterApiClient["generateIdea"]>()
      .mockImplementationOnce(async () => firstResponse)
      .mockImplementationOnce(async () => nextResponse);
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(firstResponse))
      .mockImplementationOnce(async () => ({
        items: [scoredAnalysisItem(oneLiner)],
      }))
      .mockImplementationOnce(async () => createAnalyzePostsResponse(nextResponse));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(generateIdea, analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Open details before generating again.");
    await driver.generate();
    const openHtml = await driver.openDetails(oneLiner.id);

    expect(openHtml).toContain('role="dialog"');
    expect(dialogTextSegment(openHtml)).toContain(oneLiner.text);

    const nextHtml = await driver.generate();
    const nextText = textContent(nextHtml);

    expect(generateIdea).toHaveBeenCalledTimes(2);
    expect(nextHtml).not.toContain('role="dialog"');
    expect(nextText).not.toContain("Deterministic details");
    expect(nextText).not.toContain(oneLiner.text);
    expect(nextText).toContain("Replacement candidate should not share stale details.");
  });

  it("closes an open detail inspector when follower context changes", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [, miniFramework] = response.candidates;
    if (miniFramework === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(miniFramework, {
            prediction: availablePrediction({
              predictedMidImpressions: 585,
              stallRange: { low: 410, high: 760 },
            }),
          }),
        ],
      }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Follower changes should invalidate open details.");
    await driver.generate();
    const openHtml = await driver.openDetails(miniFramework.id);

    expect(dialogTextSegment(openHtml)).toContain("410 – 760");

    const changedHtml = driver.updateFollowers("9999");
    const changedText = textContent(changedHtml);

    expect(changedHtml).not.toContain('role="dialog"');
    expect(changedText).not.toContain("Deterministic details");
    expect(changedText).not.toContain("410 – 760");
    expect(changedText).toContain("Prediction needs refresh.");
  });

  it("shows missing follower recovery in details without hiding candidate text", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner] = response.candidates;
    if (oneLiner === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner, {
            prediction: {
              status: "disabled",
              reason: "missing_followers",
              message: "Prediction needs follower count.",
            },
          }),
        ],
      }));
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Details should keep the selected text visible.");
    await driver.generate();
    const html = await driver.openDetails(oneLiner.id);
    const text = textContent(html);

    expect(text).toContain(oneLiner.text);
    expect(text).toContain("Prediction needs follower count.");
    expect(text).toContain("missing_followers");
    expect(text).toContain("Add followers");

    const focusResult = driver.focusFollowers();
    const repeatedFocusResult = driver.focusFollowers();

    expect(focusResult.activeTarget).toBe("manual-followers");
    expect(repeatedFocusResult.activeTarget).toBe("manual-followers");
    expect(repeatedFocusResult.focusRequest).toBeGreaterThan(
      focusResult.focusRequest,
    );
    expect(focusResult.html).toContain('data-focus-target="manual-followers"');
  });

  it("opens details with invalid followers by omitting prediction context", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner] = response.candidates;
    if (oneLiner === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner, {
            prediction: {
              status: "disabled",
              reason: "missing_followers",
              message: "Prediction needs follower count.",
            },
          }),
        ],
      }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Invalid followers should not block details.");
    await driver.generate();
    driver.updateFollowers("not-a-number");
    const html = await driver.openDetails(oneLiner.id);
    const text = textContent(html);

    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedExpandedAnalyzePostsRequestFor(oneLiner),
    );
    expect(text).toContain("Enter your current follower count to estimate impressions.");
    expect(dialogTextSegment(html)).toContain(oneLiner.text);
    expect(dialogTextSegment(html)).toContain("Prediction needs follower count.");
  });

  it("retries detail analysis without regenerating candidates", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [, miniFramework] = response.candidates;
    if (miniFramework === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const generateIdea = vi.fn<WriterApiClient["generateIdea"]>(async () => response);
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(miniFramework, {
            postCoach: readyPostCoach({
              title: "Post Coach",
              helperText: "Expanded details could not be loaded.",
            }),
          }),
        ],
      }))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(miniFramework, {
            score: {
              ...scoredAnalysisItem(miniFramework).score,
              value: 88,
            },
            postCoach: readyPostCoach({
              value: 88,
              expanded: true,
              previewMode: false,
              sections: [
                {
                  title: "On point",
                  items: [
                    {
                      id: "recovered-detail",
                      label: "Recovered expanded Post Coach payload",
                      status: "pass",
                    },
                  ],
                },
              ],
            }),
          }),
        ],
      }));
    const apiClient = createApiClient(generateIdea, analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Retrying details should stay in analysis only.");
    await driver.generate();
    await driver.openDetails(miniFramework.id);
    const retryHtml = await driver.retryDetails();
    const retryText = textContent(retryHtml);

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(analyzePosts).toHaveBeenCalledTimes(3);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      3,
      expectedExpandedAnalyzePostsRequestFor(miniFramework),
    );
    expect(retryText).toContain(miniFramework.text);
    expect(retryText).toContain("88");
    expect(retryText).toContain("On point");
    expect(retryText).toContain("Recovered expanded Post Coach payload");
  });

  it("offers retry when detail route analysis fails", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner] = response.candidates;
    if (oneLiner === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const detailError = createApiError({
      code: "deterministic_analysis_failed",
      message: "Expanded deterministic details are temporarily unavailable.",
      retryable: true,
      scope: "writer",
      status: 503,
    });
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => throwApiError(detailError))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner, {
            postCoach: readyPostCoach({
              expanded: true,
              previewMode: false,
              sections: [
                {
                  title: "On point",
                  items: [
                    {
                      id: "retried-detail",
                      label: "Retried detail payload",
                      status: "pass",
                    },
                  ],
                },
              ],
            }),
          }),
        ],
      }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Detail route errors should expose retry.");
    await driver.generate();
    const failedHtml = await driver.openDetails(oneLiner.id);
    const failedDialogText = dialogTextSegment(failedHtml);

    expect(failedDialogText).toContain("Expanded deterministic details are temporarily unavailable.");
    expect(failedDialogText).toContain("Retry expanded review");

    const retryHtml = await driver.retryDetails();
    const retryDialogText = dialogTextSegment(retryHtml);

    expect(analyzePosts).toHaveBeenCalledTimes(3);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      3,
      expectedExpandedAnalyzePostsRequestFor(oneLiner),
    );
    expect(retryDialogText).toContain("Retried detail payload");
  });

  it("does not start duplicate expanded detail analysis while details are loading", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner] = response.candidates;
    if (oneLiner === undefined) {
      throw new Error("Expected the writer fixture to include a candidate.");
    }
    const expandedDetails = createDeferred<AnalyzePostsResponse>();
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(() => expandedDetails.promise)
      .mockImplementation(async () => ({
        items: [scoredAnalysisItem(oneLiner)],
      }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Duplicate details clicks should not duplicate expanded scoring.");
    await driver.generate();
    const firstOpen = driver.openDetails(oneLiner.id);
    await flushAsyncTasks();
    const secondOpen = driver.openDetails(oneLiner.id);
    await flushAsyncTasks();

    expect(analyzePosts).toHaveBeenCalledTimes(2);

    expandedDetails.resolve({
      items: [scoredAnalysisItem(oneLiner)],
    });
    const firstHtml = await firstOpen;
    const secondHtml = await secondOpen;

    expect(textContent(firstHtml)).toContain(oneLiner.text);
    expect(textContent(secondHtml)).toContain(oneLiner.text);
  });

  it("closes details and returns to the candidate board", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: [scoredAnalysisItem(oneLiner)],
      }));
    const apiClient = createApiClient(vi.fn(async () => response), analyzePosts);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Close behavior should leave the board intact.");
    await driver.generate();
    const openHtml = await driver.openDetails(oneLiner.id);

    expect(openHtml).toContain('role="dialog"');

    const closedHtml = driver.closeDetails();
    const closedText = textContent(closedHtml);

    expect(closedHtml).not.toContain('role="dialog"');
    expect(closedText).not.toContain("Deterministic details");
    expect(closedText).toContain(oneLiner.text);
    expect(closedText).toContain(miniFramework.text);
    expect(closedText).toContain(debateQuestion.text);
  });

  it("keeps compact board preview analysis after expanded details close", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const previewOnlyCheck = "Preview-only Post Coach check";
    const previewOnlyLearning = "Preview-only Post Coach learning.";
    const expandedOnlyCheck = "Expanded-only Post Coach check";
    const expandedOnlyLearning = "Expanded-only Post Coach learning.";
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(oneLiner),
          scoredAnalysisItem(miniFramework, {
            postCoach: readyPostCoach({
              warned: [
                {
                  id: "preview-only-check",
                  label: previewOnlyCheck,
                  status: "warn",
                },
              ],
              sections: [
                {
                  title: "Worth a look",
                  items: [
                    {
                      id: "preview-only-check",
                      label: previewOnlyCheck,
                      status: "warn",
                    },
                  ],
                },
              ],
              learnings: [
                {
                  text: previewOnlyLearning,
                  relevance: "general",
                },
              ],
            }),
          }),
          scoredAnalysisItem(debateQuestion),
        ],
      }))
      .mockImplementationOnce(async () => ({
        items: [
          scoredAnalysisItem(miniFramework, {
            postCoach: readyPostCoach({
              expanded: true,
              passed: [
                {
                  id: "expanded-only-check",
                  label: expandedOnlyCheck,
                  status: "pass",
                },
              ],
              previewMode: false,
              sections: [
                {
                  title: "Worth a look",
                  items: [
                    {
                      id: "expanded-only-check",
                      label: expandedOnlyCheck,
                      status: "pass",
                    },
                  ],
                },
              ],
              learnings: [
                {
                  text: expandedOnlyLearning,
                  relevance: "matched",
                },
              ],
            }),
          }),
        ],
      }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Expanded details should not replace compact board preview.");
    await driver.generate();
    const openHtml = await driver.openDetails(miniFramework.id);

    expect(dialogTextSegment(openHtml)).toContain(expandedOnlyCheck);
    expect(dialogTextSegment(openHtml)).toContain(expandedOnlyLearning);

    const closedText = textContent(driver.closeDetails());
    const miniFrameworkSegment = candidateTextSegment(
      closedText,
      miniFramework.text,
      debateQuestion.text,
    );

    expect(miniFrameworkSegment).toContain(previewOnlyCheck);
    expect(miniFrameworkSegment).not.toContain(previewOnlyLearning);
    expect(miniFrameworkSegment).not.toContain(expandedOnlyCheck);
    expect(miniFrameworkSegment).not.toContain(expandedOnlyLearning);
  });

  it("does not reopen details when a closed expanded request resolves", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const expandedDetails = createDeferred<AnalyzePostsResponse>();
    const staleExpandedCheck = "Stale expanded detail should stay closed";
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(() => expandedDetails.promise);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Closed details should ignore stale expanded analysis.");
    await driver.generate();
    const openDetails = driver.openDetails(oneLiner.id);
    await flushAsyncTasks();

    const loadingHtml = driver.render();
    expect(loadingHtml).toContain('role="dialog"');
    expect(textContent(loadingHtml)).toContain("Loading deterministic details");

    const closedHtml = driver.closeDetails();
    expect(closedHtml).not.toContain('role="dialog"');

    expandedDetails.resolve({
      items: [
        scoredAnalysisItem(oneLiner, {
          postCoach: readyPostCoach({
            expanded: true,
            previewMode: false,
            sections: [
              {
                title: "Worth a look",
                items: [
                  {
                    id: "stale-expanded-check",
                    label: staleExpandedCheck,
                    status: "warn",
                  },
                ],
              },
            ],
          }),
        }),
      ],
    });
    const resolvedHtml = await openDetails;
    const resolvedText = textContent(resolvedHtml);

    expect(analyzePosts).toHaveBeenCalledTimes(2);
    expect(analyzePosts).toHaveBeenNthCalledWith(
      2,
      expectedExpandedAnalyzePostsRequestFor(oneLiner),
    );
    expect(resolvedHtml).not.toContain('role="dialog"');
    expect(resolvedText).not.toContain("Deterministic details");
    expect(resolvedText).not.toContain(staleExpandedCheck);
    expect(resolvedText).toContain(oneLiner.text);
    expect(resolvedText).toContain(miniFramework.text);
    expect(resolvedText).toContain(debateQuestion.text);
  });

  it("closes details with Escape, keeps the board mounted, and returns focus to the details trigger", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const response = createValidIdeaResponse();
    const [oneLiner, miniFramework, debateQuestion] = response.candidates;
    if (
      oneLiner === undefined ||
      miniFramework === undefined ||
      debateQuestion === undefined
    ) {
      throw new Error("Expected the writer fixture to include three candidates.");
    }
    const analyzePosts = vi
      .fn<WriterApiClient["analyzePosts"]>()
      .mockImplementationOnce(async () => createAnalyzePostsResponse(response))
      .mockImplementationOnce(async () => ({
        items: [scoredAnalysisItem(oneLiner)],
      }));
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient: createApiClient(vi.fn(async () => response), analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea("Escape should close details and restore focus.");
    await driver.generate();
    const openHtml = await driver.openDetails(oneLiner.id);

    expect(openHtml).toContain('role="dialog"');

    const result = driver.closeDetailsWithEscape();
    const closedText = textContent(result.html);

    expect(result.html).not.toContain('role="dialog"');
    expect(closedText).not.toContain("Deterministic details");
    expect(closedText).toContain(oneLiner.text);
    expect(closedText).toContain(miniFramework.text);
    expect(closedText).toContain(debateQuestion.text);
    expect(result.activeTarget).toBe(`candidate-details:${oneLiner.id}`);
  });

  it("keeps overlong ideas local and shows the shared field validation message", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const apiClient = createApiClient();
    const idea = "x".repeat(4_001);
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expect(apiClient.generateIdea).not.toHaveBeenCalled();
    expectIdeaPreserved(html, idea);
    expect(text).toContain("Idea must be 4,000 characters or fewer.");
    expect(text).not.toContain("Route unavailable");
    expect(text).not.toContain("Retry");
  });

  it("maps backend idea field validation to the local Idea error", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const validationError = createApiError({
      code: "validation_failed",
      fieldErrors: {
        idea: ["Idea must be 4,000 characters or fewer."],
      },
      message: "The request is invalid.",
      retryable: false,
      scope: "field",
      status: 400,
    });
    const apiClient = createApiClient(
      vi.fn(async () => throwApiError(validationError)),
    );
    const idea = "This idea passes local validation but fails at the backend boundary.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expect(apiClient.generateIdea).toHaveBeenCalledOnce();
    expectIdeaPreserved(html, idea);
    expect(text).toContain("Idea must be 4,000 characters or fewer.");
    expect(text).not.toContain("Route unavailable");
    expect(text).not.toContain("Retry");
  });

  it("preserves the idea and offers retry plus Settings when the backend is unavailable", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const engineError = createApiError();
    const apiClient = createApiClient(vi.fn(async () => throwApiError(engineError)));
    const onOpenSettings = vi.fn();
    const idea = "The engine may be offline, but the draft should survive.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings,
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expectIdeaPreserved(html, idea);
    expect(text).toContain("Could not reach the local engine. Your idea is still here.");
    expect(text).toContain("Retry");
    expect(text).toContain("Open Settings");

    driver.openSettings();

    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("retries failed generation with the same payload", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const engineError = createApiError();
    const response = createValidIdeaResponse();
    const generateIdea = vi
      .fn<WriterApiClient["generateIdea"]>()
      .mockImplementationOnce(async () => throwApiError(engineError))
      .mockImplementationOnce(async () => response);
    const apiClient = createApiClient(generateIdea);
    const idea = "Retry should not mutate the submitted idea.";
    const expectedPayload: GenerateIdeaRequest = {
      idea,
    };
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const failedHtml = await driver.generate();

    expect(generateIdea).toHaveBeenCalledOnce();
    expect(apiClient.analyzePosts).not.toHaveBeenCalled();
    expect(textContent(failedHtml)).toContain(
      "Could not reach the local engine. Your idea is still here.",
    );

    const retryHtml = await driver.retry();

    expect(generateIdea).toHaveBeenCalledTimes(2);
    expect(generateIdea).toHaveBeenNthCalledWith(1, expectedPayload);
    expect(generateIdea).toHaveBeenNthCalledWith(2, expectedPayload);
    expect(textContent(retryHtml)).toContain(
      "Local-first writing tools need boring edges.",
    );
  });

  it("shows invalid_response as a route error when the API client rejects schema output", async () => {
    const { WriterPage, createWriterPagePublicDriver } = await loadWriterPage();
    const invalidResponseError = createApiError({
      code: "invalid_response",
      message: "invalid_response",
      retryable: true,
      scope: "writer",
      status: 502,
    });
    const apiClient = createApiClient(
      vi.fn(async () => throwApiError(invalidResponseError)),
    );
    const idea = "Bad candidate payloads should not look successful.";
    const driver = createDriver(createWriterPagePublicDriver, {
      apiClient,
      onOpenSettings: vi.fn(),
      renderPage: WriterPage,
    });

    driver.updateIdea(idea);
    const html = await driver.generate();
    const text = textContent(html);

    expectIdeaPreserved(html, idea);
    expect(text).toContain("invalid_response");
    expect(text).toContain("Retry");
  });
});
