import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AnalyzePostsRequest,
  AnalyzePostsResponse,
  AppSettings,
  AppSettingsResponse,
  AppStatus,
  GenerateIdeaRequest,
  GenerateIdeaResponse,
  JudgeDraftRequest,
  JudgeDraftResponse,
  JudgeVerdict,
  RouteConfig,
} from "@x-builder/shared";

import {
  applyIdeaChange,
  createInitialModel,
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

// ── Boundaries under test ───────────────────────────────────────────────────
// This suite exercises the REAL writer-workflow reducers/runners and the REAL
// WriterPage / SettingsRoute public drivers end-to-end. The only things mocked
// are the two API boundaries (WriterApiClient and the settings API client),
// each schema-shaped to its real contract. No internal workflow module is
// mocked, so each invariant below is falsifiable against a facade.

const writerPageModulePath = "../writer-page";
const settingsRouteModulePath = "../../../shell/settings-route";

const draftText = "A scored draft awaiting a judge-refined reach estimate.";

// A verdict whose two reach scalars (impressions, replies) are distinct,
// non-default values, with every other dimension a different number — so a
// leaked extra `scores` key would be observable in the pass-2 request body. The
// five behavioral dims carry their own distinct numbers so the panel render can
// assert each by value.
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

// ── WriterPage driver harness ────────────────────────────────────────────────

type WriterApiBoundary = {
  analyzePosts: (input: AnalyzePostsRequest) => Promise<AnalyzePostsResponse>;
  generateIdea: (input: GenerateIdeaRequest) => Promise<GenerateIdeaResponse>;
  judgeDraft: (input: JudgeDraftRequest) => Promise<JudgeDraftResponse>;
};

type AdvancedContextPatch = {
  trailingMedianImpressions?: number;
  repeatHistory?: { similarInLast7Days: boolean; date?: string };
  plannedHourUtc?: number;
  willAttachMedia?: boolean;
  accountAgeYears?: number;
};

type WriterPageProps = {
  apiClient: WriterApiBoundary;
  onOpenSettings: () => void;
};

type WriterPagePublicDriver = {
  generate: () => Promise<string>;
  judge: () => Promise<string>;
  render: () => string;
  scoreDraft: () => Promise<string>;
  updateAdvancedContext: (patch: AdvancedContextPatch) => Promise<string>;
  updateFollowers: (followers: string) => string;
  updateIdea: (idea: string) => string;
};

type WriterPagePublicDriverOptions = WriterPageProps & {
  renderPage?: (props: WriterPageProps) => ReactElement;
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

function defaultIdeaResponse(): GenerateIdeaResponse {
  return {
    candidates: [
      {
        format: "one-liner",
        id: "candidate-one-liner",
        text: "Local-first writing tools need boring edges.",
      },
    ],
  };
}

// A two-pass analyze stub: pass-1 (scoreDraft) returns an available STATIC
// prediction; pass-2 (the refine call) returns an available JUDGE prediction so
// the upgraded reach is observable in the rendered page.
function twoPassAnalyze() {
  let call = 0;
  return vi.fn<WriterApiClient["analyzePosts"]>(async (request) => {
    call += 1;
    const text = request.items[0]?.text ?? draftText;
    if (call === 1) {
      return buildAnalyzeResponse(request, {
        "draft-post": scoredItem(
          { id: "draft-post", text },
          { prediction: availablePrediction({ qualityBasis: "static" }) },
        ),
      });
    }
    return buildAnalyzeResponse(request, {
      "draft-post": scoredItem(
        { id: "draft-post", text },
        {
          prediction: availablePrediction({
            qualityBasis: "judge",
            predictedMidImpressions: 4200,
            stallRange: { low: 2600, high: 7000 },
          }),
        },
      ),
    });
  });
}

function createWriterApiClient(
  analyzePosts: WriterApiBoundary["analyzePosts"],
  judgeDraft: WriterApiBoundary["judgeDraft"] = vi.fn(async () => judgedResponse),
): WriterApiBoundary {
  return {
    analyzePosts,
    generateIdea: vi.fn(async () => defaultIdeaResponse()),
    judgeDraft,
  };
}

// Resolve the writer-page driver's deferred-judge tick (the `judge` entry fires
// the refine pass without awaiting it, then settles one macrotask). A second
// settle here is a safety margin so an already-resolved pass-2 has landed.
async function flushMacrotasks() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

// ── SettingsRoute driver harness (account-profile persist seam) ──────────────

type SettingsApiClient = {
  getSettings: () => Promise<AppSettingsResponse>;
  getStatus: () => Promise<AppStatus>;
  saveSettings: (settings: AppSettings) => Promise<AppSettingsResponse>;
};

type SettingsRouteProps = {
  apiClient: SettingsApiClient;
  openedFrom?: RouteConfig["id"];
  onNavigate?: (to: RouteConfig["path"]) => void;
  onNavigateToWriter?: () => void;
  onStatusRefresh?: (status: AppStatus) => void;
};

type TextSettingsFieldName = Extract<keyof AppSettings, "accountProfile">;

type SettingsRoutePublicDriver = {
  load: () => Promise<string>;
  save: () => Promise<string>;
  updateField: (field: TextSettingsFieldName, value: string) => string;
};

type SettingsRoutePublicDriverOptions = SettingsRouteProps & {
  renderRoute?: (props: SettingsRouteProps) => ReactElement;
};

type SettingsRouteModule = {
  SettingsRoute: (props: SettingsRouteProps) => ReactElement;
  createSettingsRoutePublicDriver: (
    options: SettingsRoutePublicDriverOptions,
  ) => SettingsRoutePublicDriver;
};

async function loadSettingsRoute() {
  return (await import(settingsRouteModulePath)) as SettingsRouteModule;
}

function defaultSettings(): AppSettings {
  return {
    accountProfile: "",
    claudeModel: "",
    codexModel: "",
    cursorModel: "",
    engineBaseUrl: "http://127.0.0.1:4173",
    judgeProvider: "claude-cli",
    showDeterministicDetails: true,
    storagePath: "/tmp/x-builder-integration-storage",
  };
}

function settingsResponse(
  settings: AppSettings,
  source: AppSettingsResponse["source"],
): AppSettingsResponse {
  return {
    settings,
    source,
    updatedAt: source === "persisted" ? "2026-06-06T12:00:00.000Z" : undefined,
  };
}

// A settings API client backed by an in-memory persisted store: a save updates
// what subsequent loads return, so the persist→read seam is a real round-trip
// rather than a one-shot stub.
function createPersistingSettingsApiClient() {
  let persisted: AppSettingsResponse = settingsResponse(defaultSettings(), "defaults");
  const getSettings = vi.fn<SettingsApiClient["getSettings"]>(async () => persisted);
  const saveSettings = vi.fn<SettingsApiClient["saveSettings"]>(
    async (settings: AppSettings) => {
      persisted = settingsResponse(settings, "persisted");
      return persisted;
    },
  );

  return {
    apiClient: {
      getSettings,
      getStatus: vi.fn() as unknown as SettingsApiClient["getStatus"],
      saveSettings,
    } satisfies SettingsApiClient,
    readPersistedProfile: () => persisted.settings.accountProfile ?? "",
  };
}

// ── Reducer/runner harness (request-shape + stale-guard invariants) ──────────
// Mirrors WriterPage.publishModel: apply functional updates against a running
// snapshot so post-action state is assertable while driving the real runners.
function runWith(
  model: WriterPageModel,
  run: (
    publish: (
      update: WriterPageModel | ((value: WriterPageModel) => WriterPageModel),
    ) => void,
  ) => Promise<WriterPageModel>,
) {
  let current = model;
  const publish = (
    update: WriterPageModel | ((value: WriterPageModel) => WriterPageModel),
  ): void => {
    current = typeof update === "function" ? update(current) : update;
  };

  return run(publish).then((returned) => ({ returned, current }));
}

const draftCandidate: WriterCandidate = {
  id: "draft-post",
  source: "draft",
  text: draftText,
};

function readyStaticAnalysis(text: string = draftText): CandidateAnalysisState {
  return {
    status: "ready",
    item: scoredItem(
      { id: "draft-post", text },
      { prediction: availablePrediction({ qualityBasis: "static" }) },
    ),
  };
}

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

function judgeRefinedAnalyze() {
  return vi.fn<WriterApiClient["analyzePosts"]>(async (request) =>
    buildAnalyzeResponse(request, {
      "draft-post": scoredItem(
        { id: "draft-post", text: request.items[0]?.text ?? draftText },
        { prediction: availablePrediction({ qualityBasis: "judge" }) },
      ),
    }),
  );
}

function reducerApiClient(
  analyzePosts: WriterApiClient["analyzePosts"],
): WriterApiClient {
  return {
    analyzePosts,
    generateIdea: vi.fn() as unknown as WriterApiClient["generateIdea"],
    judgeDraft: vi.fn(async () => judgedResponse),
  };
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

// Reads the available prediction out of a ready, scored analysis state.
function availablePredictionOf(
  state: CandidateAnalysisState | undefined,
): Extract<ReturnType<typeof availablePrediction>, { status: "available" }> {
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

// The eleven verdict score dimensions that must NEVER cross into pass-2.
const forbiddenJudgeSignalKeys = [
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

// ── FLOW 1 — auto-score → judge → refine through the WriterPage driver ───────
describe("writer two-pass flow through the public driver", () => {
  it("commits a judge-quality prediction and renders the five behavioral verdict dimensions after refine", async () => {
    const module = await loadWriterPage();
    const analyzePosts = twoPassAnalyze();
    const judgeDraft = vi.fn(async () => judgedResponse);
    const driver = module.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(analyzePosts, judgeDraft),
      onOpenSettings: vi.fn(),
      renderPage: module.WriterPage,
    });

    driver.updateFollowers("2400");
    driver.updateIdea(draftText);
    await driver.scoreDraft();

    const html = await driver.judge();
    await flushMacrotasks();
    const settled = driver.render();

    // The judge was consulted and the refine pass re-issued analyze.
    expect(judgeDraft).toHaveBeenCalledWith({ text: draftText });
    expect(analyzePosts).toHaveBeenCalledTimes(2);

    // The committed model shows a qualityBasis="judge" prediction — rendered as
    // the judge-refined reach badge in the deterministic prediction surface.
    expect(html).toContain("Refined with judge signal");
    expect(settled).toContain("Refined with judge signal");

    // The verdict's five new behavioral dimensions render in the JudgePanel.
    for (const label of [
      "Answer effort",
      "Stranger answerability",
      "Status dependency",
      "Audience match",
    ]) {
      expect(settled).toContain(label);
    }
    // replyVsQuoteOrientation renders as a labeled pole scale, not a raw label.
    expect(settled).toContain("Reply-oriented");
    expect(settled).toContain("Quote-oriented");
    // Each behavioral dimension reads through with its verdict value.
    expect(settled).toContain("55");
    expect(settled).toContain("48");
    expect(settled).toContain("30");
    expect(settled).toContain("41");
  });
});

// ── FLOW 2 — settings persist → judge read seam at the mock-API boundary ─────
describe("account-profile settings persist to judge audience-match seam", () => {
  it("persists a profile via the settings driver and the writer judge then reflects a numeric audience match", async () => {
    // 1) Persist a non-empty accountProfile through the REAL SettingsRoute driver.
    const settingsModule = await loadSettingsRoute();
    const { apiClient: settingsApiClient, readPersistedProfile } =
      createPersistingSettingsApiClient();
    const settingsDriver = settingsModule.createSettingsRoutePublicDriver({
      apiClient: settingsApiClient,
      renderRoute: settingsModule.SettingsRoute,
    });

    const profile = "Solo founders shipping local-first developer tools.";
    await settingsDriver.load();
    settingsDriver.updateField("accountProfile", profile);
    await settingsDriver.save();

    // The profile is now persisted at the settings boundary.
    expect(settingsApiClient.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ accountProfile: profile }),
    );
    expect(readPersistedProfile()).toBe(profile);

    // 2) The writer does NOT send accountProfile in the judge body (zero-trace)
    //    — the engine reads the persisted profile cross-process. We verify the
    //    seam AT THE BOUNDARY: a profile-present judgeDraft mock returns a
    //    NUMERIC audienceMatch (the engine's profile-present output).
    const numericAudienceMatch = 73;
    const judgeDraft = vi.fn(async (input: JudgeDraftRequest) => {
      // Zero-trace: the judge request body carries only the trimmed draft text;
      // the client never forwards the account profile.
      expect(Object.keys(input)).toEqual(["text"]);
      const profilePresent = readPersistedProfile().trim().length > 0;
      return {
        ...judgedResponse,
        verdict: {
          ...verdict,
          scores: {
            ...verdict.scores,
            audienceMatch: profilePresent ? numericAudienceMatch : null,
          },
        },
      } satisfies JudgeDraftResponse;
    });

    const writerModule = await loadWriterPage();
    const writerDriver = writerModule.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(twoPassAnalyze(), judgeDraft),
      onOpenSettings: vi.fn(),
      renderPage: writerModule.WriterPage,
    });

    writerDriver.updateFollowers("2400");
    writerDriver.updateIdea(draftText);
    await writerDriver.scoreDraft();
    await writerDriver.judge();
    await flushMacrotasks();
    const settled = writerDriver.render();

    // The judge boundary was consulted, and the panel reflects the NUMBER, never
    // the missing-profile recovery copy.
    expect(judgeDraft).toHaveBeenCalledWith({ text: draftText });
    expect(settled).toContain("Audience match");
    expect(settled).toContain(String(numericAudienceMatch));
    expect(settled).not.toContain("Needs account profile");
    expect(settled).not.toContain("Add account profile in Settings");
  });
});

// ── FLOW 3 — advanced context alongside an unchanged followers ───────────────
describe("advanced context analyze wiring through the public driver", () => {
  it("carries advanced fields in scoringContext alongside an unchanged followers", async () => {
    const module = await loadWriterPage();
    const analyzePosts = twoPassAnalyze();
    const driver = module.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: module.WriterPage,
    });

    driver.updateFollowers("2400");
    driver.updateIdea(draftText);
    await driver.updateAdvancedContext({ plannedHourUtc: 20, willAttachMedia: true });
    await driver.scoreDraft();

    expect(analyzePosts).toHaveBeenCalled();
    const request = analyzePosts.mock.calls.at(-1)?.[0];
    // Advanced fields ride along…
    expect(request?.scoringContext.plannedHourUtc).toBe(20);
    expect(request?.scoringContext.willAttachMedia).toBe(true);
    // …without disturbing the follower context.
    expect(request?.scoringContext.followers).toBe(2400);
  });
});

// ── INVARIANT — exactly one prediction per draft version after refine ────────
describe("single-prediction invariant after refine", () => {
  it("holds exactly one available prediction per candidate with no lingering static/previous field", async () => {
    const apiClient = reducerApiClient(judgeRefinedAnalyze());

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

    // The refined judge prediction replaced the static one in place.
    expect(state.item.prediction.status).toBe("available");
    const prediction = availablePredictionOf(state);
    expect(prediction.qualityBasis).toBe("judge");
    // No diff state: there is no second prediction kept beside the judge one.
    expect("staticPrediction" in state.item).toBe(false);
    expect("previousPrediction" in state.item).toBe(false);
    expect(state).not.toHaveProperty("previous");
  });
});

// ── INVARIANT — editing the draft mid-refine drops the stale result ──────────
describe("stale-refine drop invariant", () => {
  it("drops a refine that resolves after the draft text changed and does not mark it refined", async () => {
    const analysis = createDeferred<AnalyzePostsResponse>();
    const analyze = vi.fn<WriterApiClient["analyzePosts"]>(
      async () => analysis.promise,
    );
    const apiClient = reducerApiClient(analyze);

    let current = scoredAndJudgedModel();
    const publish = (
      update: WriterPageModel | ((value: WriterPageModel) => WriterPageModel),
    ): void => {
      current = typeof update === "function" ? update(current) : update;
    };

    // Drive a refine in flight (pass-2 analyze is held open).
    const refining = runTwoPassRefine(apiClient, current, publish);
    expect(current.refinement.status).toBe("running");

    // The user edits the draft while pass-2 is still pending: both the idea and
    // the scored candidate move off the judged text. The edit reducer resets
    // refinement to "skipped".
    const editedText = "An edited draft the stale judge must not refine.";
    current = applyIdeaChange(current, editedText);
    current = {
      ...current,
      candidates: [{ id: "draft-post", source: "draft", text: editedText }],
      analysisByCandidateId: {
        "draft-post": readyStaticAnalysis(editedText),
      },
    };
    expect(current.refinement.status).toBe("skipped");

    // The stale pass-2 resolves for the OLD text.
    analysis.resolve(
      buildAnalyzeResponse(
        {
          items: [{ id: "draft-post", text: draftText }],
          scoringContext: {},
          presentation: { postCoachMode: "preview" },
        },
        {
          "draft-post": scoredItem(
            { id: "draft-post", text: draftText },
            { prediction: availablePrediction({ qualityBasis: "judge" }) },
          ),
        },
      ),
    );
    await refining;

    // The stale result is dropped: not "refined", and the visible prediction is
    // still the static one for the edited text (text-equality + requestId guard).
    expect(current.refinement.status).not.toBe("refined");
    const prediction = availablePredictionOf(
      current.analysisByCandidateId["draft-post"],
    );
    expect(prediction.qualityBasis).toBe("static");
  });
});

// ── INVARIANT — followers keeps flowing in scoringContext with advanced fields ─
describe("followers-preservation invariant under advanced context", () => {
  it("keeps followers in scoringContext when advanced fields are added", async () => {
    const module = await loadWriterPage();
    const analyzePosts = twoPassAnalyze();
    const driver = module.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: module.WriterPage,
    });

    driver.updateFollowers("1875");
    driver.updateIdea(draftText);
    // Score once with followers only, then add advanced fields and score again.
    await driver.scoreDraft();
    const followersOnly = analyzePosts.mock.calls.at(-1)?.[0];
    expect(followersOnly?.scoringContext.followers).toBe(1875);

    await driver.updateAdvancedContext({ plannedHourUtc: 9, accountAgeYears: 3 });
    await driver.scoreDraft();
    const withAdvanced = analyzePosts.mock.calls.at(-1)?.[0];

    // Followers is NOT overwritten by the advanced spread.
    expect(withAdvanced?.scoringContext.followers).toBe(1875);
    expect(withAdvanced?.scoringContext.plannedHourUtc).toBe(9);
    expect(withAdvanced?.scoringContext.accountAgeYears).toBe(3);
  });
});

// ── INVARIANT — pass-2 body carries exactly the two judge reach scalars ──────
describe("pass-2 judge-signal request-shape invariant", () => {
  it("sends scoringContext.judgeSignals === { impressions, replies } and no other verdict score key", async () => {
    const analyze = judgeRefinedAnalyze();
    const apiClient = reducerApiClient(analyze);

    await runWith(scoredAndJudgedModel(), (publish) =>
      runTwoPassRefine(apiClient, scoredAndJudgedModel(), publish),
    );

    expect(analyze).toHaveBeenCalledTimes(1);
    const request = analyze.mock.calls[0]?.[0];
    if (request === undefined) {
      throw new Error("Expected the refine pass to issue an analyze request.");
    }
    const judgeSignals = request.scoringContext.judgeSignals;

    // Exact 2-key shape, values lifted from the verdict's two reach scalars.
    expect(judgeSignals).toEqual({ impressions: 65, replies: 80 });
    expect(Object.keys(judgeSignals ?? {}).sort()).toEqual([
      "impressions",
      "replies",
    ]);
    // Key-absence of the other eleven verdict dimensions.
    for (const key of forbiddenJudgeSignalKeys) {
      expect(judgeSignals).not.toHaveProperty(key);
    }
  });
});
