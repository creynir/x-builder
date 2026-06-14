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
  availablePrediction,
  buildAnalyzeResponse,
  scoredItem,
} from "./analyze-response-builder";

// FULL-STACK studio flow + cross-cutting scale-separation / single-tree
// invariants through the REAL WriterPage and SettingsRoute public drivers (SSR).
// The only mocked seams are the two API boundaries (the writer api client and the
// settings api client), each schema-shaped to its real contract. No internal
// workflow / render module is mocked, so each invariant is falsifiable against a
// facade. This complements (does not re-run) the writer two-pass integration and
// settings-route suites: it asserts the END-TO-END studio render and the
// scale-separation / single-card-tree invariants, which those do not cover.

const writerPageModulePath = "../writer-page";
const settingsRouteModulePath = "../../../shell/settings-route";

const draftText =
  "A scored studio draft that earns a four-regime reach estimate and a judge-refined one.";

// A verdict with 13 distinct, non-default score dimensions so each of the 13
// rendered judge rows is observable by value in the panel render.
const baseVerdict: JudgeVerdict = {
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
};

const judgedResponse: JudgeDraftResponse = {
  status: "judged",
  verdict: baseVerdict,
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
  openSettings: () => void;
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

// A two-pass analyze: pass-1 (scoreDraft) returns a STATIC prediction; pass-2
// (the refine) returns a JUDGE prediction whose mid impressions differ. The two
// mid values are deliberately distinct so a scale-separation assertion can prove
// the two predictions live on different quality bases — never diffed.
const staticMid = 1500;
const judgeMid = 4200;

function twoPassAnalyze() {
  let call = 0;
  return vi.fn<WriterApiBoundary["analyzePosts"]>(async (request) => {
    call += 1;
    const text = request.items[0]?.text ?? draftText;
    if (call === 1) {
      return buildAnalyzeResponse(request, {
        "draft-post": scoredItem(
          { id: "draft-post", text },
          {
            prediction: availablePrediction({
              qualityBasis: "static",
              predictedMidImpressions: staticMid,
            }),
          },
        ),
      });
    }
    return buildAnalyzeResponse(request, {
      "draft-post": scoredItem(
        { id: "draft-post", text },
        {
          prediction: availablePrediction({
            qualityBasis: "judge",
            predictedMidImpressions: judgeMid,
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

// The writer-page driver's `judge` fires the refine pass without awaiting it,
// then settles one macrotask. A second settle is a safety margin so an
// already-resolved pass-2 has landed before the snapshot.
async function flushMacrotasks() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function textContent(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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
    storagePath: "/tmp/x-builder-studio-e2e-storage",
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
// what subsequent loads return, so the persist->read seam is a real round-trip.
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

// The 13 judge dimensions the panel renders, by their rendered label. Eleven are
// plain numeric rows, plus the audience-match row and the orientation pole scale.
const judgeRowLabels = [
  "Overall",
  "Replies",
  "Profile clicks",
  "Impressions",
  "Bookmark value",
  "Dwell",
  "Voice match",
  "Negative risk",
  "Answer effort",
  "Stranger answerability",
  "Status dependency",
  "Audience match",
] as const;

// Counts the judge score rows actually rendered in the panel. The orientation
// scale is its own row alongside the labeled rows above.
function judgeScoreRowCount(html: string): number {
  return (html.match(/class="xb-judge-scores__row"/g) ?? []).length;
}

// Slices the engagement-prediction reach card out of the markup so a structural
// signature is read from the prediction surface, not from copy elsewhere.
function reachRegimeMarkup(html: string): string {
  const start = html.indexOf('class="xb-reach-regime"');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<div", start);
  expect(open).toBeGreaterThanOrEqual(0);
  // The regime card is the <div class="xb-reach-regime"> ... </div>. Walk to the
  // matching close by counting nested <div> opens from the card open tag.
  let depth = 0;
  let index = open;
  while (index < html.length) {
    const nextOpen = html.indexOf("<div", index + 1);
    const nextClose = html.indexOf("</div>", index + 1);
    if (nextClose === -1) {
      break;
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      index = nextOpen;
      continue;
    }
    if (depth === 0) {
      return html.slice(open, nextClose + "</div>".length);
    }
    depth -= 1;
    index = nextClose;
  }
  throw new Error("Expected a closed xb-reach-regime card in the markup.");
}

// The structural signature shared by BOTH the static and judge renders of the
// reach card: the regime container, its regimes <dl>, and every regime <dt>
// label. A two-implementation facade (a router dispatching static vs judge to
// separate card components) would have to reproduce ALL of these in identical
// structure to pass — which is the single-tree property under test.
const regimeDtLabels = [
  "Expected reach",
  "Escape likelihood",
  "Typical reach",
  "If it breaks out",
  "Expected replies",
] as const;

function assertReachCardSkeleton(cardHtml: string) {
  expect(cardHtml).toContain('class="xb-reach-regime"');
  expect(cardHtml).toContain('class="xb-deterministic-signals xb-reach-regime__regimes"');
  for (const label of regimeDtLabels) {
    expect(cardHtml).toContain(`<dt>${label}</dt>`);
  }
  // Exactly the five regime rows — same dom shape in both states.
  expect((cardHtml.match(/class="xb-deterministic-signals__row"/g) ?? []).length).toBe(
    regimeDtLabels.length,
  );
}

// ── FLOW 1 — full studio flow: one driver render shows all three surfaces ────
describe("full studio flow through the writer driver", () => {
  it("renders a four-regime prediction, all 13 judge rows, and a judge-refined prediction from one component tree", async () => {
    const module = await loadWriterPage();
    const analyzePosts = twoPassAnalyze();
    const judgeDraft = vi.fn(async () => judgedResponse);
    const driver = module.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(analyzePosts, judgeDraft),
      onOpenSettings: vi.fn(),
      renderPage: module.WriterPage,
    });

    // Paste a draft, set followers, expand advanced context + a planned hour,
    // auto-score, then judge -> refine.
    driver.updateFollowers("2400");
    driver.updateIdea(draftText);
    await driver.updateAdvancedContext({ plannedHourUtc: 20 });
    await driver.scoreDraft();
    await driver.judge();
    await flushMacrotasks();

    // ONE driver render after the full flow carries all three surfaces.
    const settled = driver.render();

    expect(judgeDraft).toHaveBeenCalledWith({ text: draftText });
    expect(analyzePosts).toHaveBeenCalledTimes(2);

    // (a) The four-regime prediction surface.
    const card = reachRegimeMarkup(settled);
    assertReachCardSkeleton(card);

    // (b) The judge-refined prediction badge.
    expect(settled).toContain("Refined with judge signal");

    // (c) All 13 judge rows render — every labeled dimension plus the orientation
    // pole scale = 13 rows total.
    for (const label of judgeRowLabels) {
      expect(settled).toContain(label);
    }
    expect(settled).toContain("Reply-oriented");
    expect(settled).toContain("Quote-oriented");
    expect(judgeScoreRowCount(settled)).toBe(13);
    // Each numeric dimension reads through with its verdict value.
    expect(settled).toContain("55");
    expect(settled).toContain("48");
    expect(settled).toContain("30");
    expect(settled).toContain("41");
    expect(settled).toContain("62");
  });
});

// ── FLOW 2 — empty-profile recovery -> Settings -> re-judge ──────────────────
describe("empty-profile recovery through the writer and settings drivers", () => {
  it("shows the recovery affordance whose handler routes to Settings, then a number after a profile is saved and re-judged", async () => {
    const writerModule = await loadWriterPage();
    const settingsModule = await loadSettingsRoute();
    const { apiClient: settingsApiClient, readPersistedProfile } =
      createPersistingSettingsApiClient();

    // A judge whose audienceMatch mirrors the persisted profile: null when empty,
    // numeric once a profile is saved. The client never forwards the profile in
    // the judge body (zero-trace) — the engine reads it cross-process — so the
    // mock keys off the settings store, exactly the real seam.
    const numericAudienceMatch = 73;
    const judgeDraft = vi.fn(async (input: JudgeDraftRequest) => {
      expect(Object.keys(input)).toEqual(["text"]);
      const profilePresent = readPersistedProfile().trim().length > 0;
      return {
        ...judgedResponse,
        verdict: {
          ...baseVerdict,
          scores: {
            ...baseVerdict.scores,
            audienceMatch: profilePresent ? numericAudienceMatch : null,
          },
        },
      } satisfies JudgeDraftResponse;
    });

    const onOpenSettings = vi.fn();
    const writerDriver = writerModule.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(twoPassAnalyze(), judgeDraft),
      onOpenSettings,
      renderPage: writerModule.WriterPage,
    });

    // 1) Judge against an EMPTY profile -> the recovery copy + affordance render.
    writerDriver.updateFollowers("2400");
    writerDriver.updateIdea(draftText);
    await writerDriver.scoreDraft();
    await writerDriver.judge();
    await flushMacrotasks();
    const recoveryHtml = writerDriver.render();

    expect(recoveryHtml).toContain("Audience match");
    expect(recoveryHtml).toContain("Needs account profile");
    // The affordance is a real control whose handler is wired to onOpenSettings.
    expect(recoveryHtml).toContain('aria-label="Add account profile in Settings"');
    expect(textContent(recoveryHtml)).toContain("Add account profile");
    expect(recoveryHtml).not.toContain(String(numericAudienceMatch));

    // The Settings entry is reachable: invoking the driver's settings handler
    // fires onOpenSettings (the wiring the affordance's onClick drives).
    writerDriver.openSettings();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    // 2) SAVE a profile through the REAL SettingsRoute driver (round-trips into
    // the persisting store the judge reads).
    const profile = "Solo founders shipping local-first developer tools.";
    const settingsDriver = settingsModule.createSettingsRoutePublicDriver({
      apiClient: settingsApiClient,
      renderRoute: settingsModule.SettingsRoute,
    });
    await settingsDriver.load();
    settingsDriver.updateField("accountProfile", profile);
    await settingsDriver.save();

    expect(settingsApiClient.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ accountProfile: profile }),
    );
    expect(readPersistedProfile()).toBe(profile);

    // 3) RE-JUDGE: the judge mock now returns a numeric audienceMatch.
    await writerDriver.judge();
    await flushMacrotasks();
    const recoveredHtml = writerDriver.render();

    expect(recoveredHtml).toContain("Audience match");
    expect(recoveredHtml).toContain(String(numericAudienceMatch));
    expect(recoveredHtml).not.toContain("Needs account profile");
    expect(recoveredHtml).not.toContain('aria-label="Add account profile in Settings"');
  });
});

// ── INVARIANT — pre/post-judge scale separation: no delta, one prediction ────
describe("pre/post-judge scale separation through the studio render", () => {
  it("renders distinct static and judge mid impressions with no delta/diff between them", async () => {
    const module = await loadWriterPage();
    const analyzePosts = twoPassAnalyze();
    const driver = module.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(analyzePosts),
      onOpenSettings: vi.fn(),
      renderPage: module.WriterPage,
    });

    driver.updateFollowers("2400");
    driver.updateIdea(draftText);

    // Pass-1 render: a static-basis prediction shows the static mid.
    const staticHtml = await driver.scoreDraft();
    const staticCard = reachRegimeMarkup(staticHtml);
    expect(staticCard).toContain(String(staticMid));
    expect(staticCard).not.toContain("Refined with judge signal");

    // Pass-2 render: the judge-basis prediction REPLACES the static one in place.
    await driver.judge();
    await flushMacrotasks();
    const judgeHtml = driver.render();
    const judgeCard = reachRegimeMarkup(judgeHtml);
    expect(judgeCard).toContain(String(judgeMid));
    expect(judgeCard).toContain("Refined with judge signal");

    // The two reach numbers are different scales (static base vs judge base) —
    // never numerically diffed. No delta/diff/"vs static"/previous marker exists
    // anywhere in the refined output.
    const text = textContent(judgeHtml).toLowerCase();
    expect(text).not.toContain("delta");
    expect(text).not.toContain("vs static");
    expect(text).not.toContain("static prediction");
    expect(text).not.toContain("previous prediction");
    expect(judgeHtml).not.toContain("xb-reach-regime__diff");

    // The model holds ONE prediction per draft version: the static mid is gone
    // from the refined render — it was replaced, not kept beside the judge one.
    expect(judgeHtml).not.toContain(String(staticMid));

    // Exactly one reach-regime card in the refined render (no second card for a
    // retained static prediction).
    expect((judgeHtml.match(/class="xb-reach-regime"/g) ?? []).length).toBe(1);
  });
});

// ── INVARIANT — single component tree: same card skeleton static -> judge ────
describe("single prediction-card tree across the qualityBasis transition", () => {
  it("renders the SAME structural reach-card skeleton in the static and judge states", async () => {
    const module = await loadWriterPage();
    const driver = module.createWriterPagePublicDriver({
      apiClient: createWriterApiClient(twoPassAnalyze()),
      onOpenSettings: vi.fn(),
      renderPage: module.WriterPage,
    });

    driver.updateFollowers("2400");
    driver.updateIdea(draftText);

    // Static-state card.
    const staticHtml = await driver.scoreDraft();
    const staticCard = reachRegimeMarkup(staticHtml);
    assertReachCardSkeleton(staticCard);
    // The static state carries NO judge basis badge.
    expect(staticCard).not.toContain("xb-reach-regime__basis");

    // Judge-state card after refine.
    await driver.judge();
    await flushMacrotasks();
    const judgeHtml = driver.render();
    const judgeCard = reachRegimeMarkup(judgeHtml);
    assertReachCardSkeleton(judgeCard);
    // Only the judge state adds the basis badge — same skeleton, badge + values
    // differ. A two-implementation facade would emit a different skeleton here.
    expect(judgeCard).toContain("xb-reach-regime__basis");
    expect(judgeCard).toContain("Refined with judge signal");

    // The distinctive structural signature (container class + regimes dl class)
    // is byte-present in BOTH renders — the proof that one card component renders
    // both states.
    const signature = '<div class="xb-reach-regime"><dl class="xb-deterministic-signals xb-reach-regime__regimes">';
    expect(staticHtml).toContain(signature);
    expect(judgeHtml).toContain(signature);
  });
});
