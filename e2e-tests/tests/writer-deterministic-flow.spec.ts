import { expect, test, type Page, type Route } from "@playwright/test";

const engineBaseUrl = "http://127.0.0.1:4173";
const checkedAt = "2026-06-08T08:00:00.000Z";
const learningCaveat =
  "Static rule check. Imported performance data is not connected yet.";
const heuristicLabel = "Heuristic rank, not prediction.";

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, PATCH, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "content-type": "application/json",
};

const candidates = [
  {
    format: "one-liner",
    id: "candidate-one-liner",
    text: "Launch notes get better when they name the tradeoff, not just the feature.",
  },
  {
    format: "mini-framework",
    id: "candidate-mini-framework",
    text: "Name the shift, show the cost, then give the reader one concrete next move.",
  },
  {
    format: "debate-question",
    id: "candidate-debate-question",
    text: "What launch tradeoff would make builders trust the product more?",
  },
] as const;

type Candidate = (typeof candidates)[number];
type AnalyzeRequest = {
  items: Array<{
    id: string;
    sourceFormat?: string;
    text: string;
  }>;
  presentation: {
    postCoachMode: "preview" | "expanded";
  };
  scoringContext: {
    followers?: number;
  };
};

type CapturedRequests = {
  analyze: AnalyzeRequest[];
  generate: unknown[];
};

function subsystem(label: string) {
  return {
    checkedAt,
    details: {},
    label,
    retryable: true,
    state: "ready",
  };
}

function readyStatus() {
  return {
    codex: subsystem("Codex judge"),
    deterministic: subsystem("Deterministic scorer"),
    engine: subsystem("Engine"),
    generatedAt: checkedAt,
    lastRun: {
      state: "none",
    },
    overall: "ready",
    storage: subsystem("Storage"),
    version: "e2e",
  };
}

function settingsResponse() {
  return {
    settings: {
      codexCommandLabel: "Codex judge",
      engineBaseUrl,
      runCodexJudgeAfterGeneration: false,
      showDeterministicDetails: true,
      storagePath: "~/.x-builder/e2e",
    },
    source: "defaults",
  };
}

function postCoach(mode: "preview" | "expanded", index: number) {
  const failed = {
    id: `proof-gap-${index}`,
    kind: "quality",
    label: `API proof gap ${index}`,
    status: "fail",
  };
  const warned = {
    id: `opening-nudge-${index}`,
    kind: "quality",
    label: `API opening nudge ${index}`,
    status: "warn",
  };
  const passed = {
    id: `clear-angle-${index}`,
    kind: "quality",
    label: `API clear angle ${index}`,
    status: "pass",
  };

  return {
    state: "ready",
    title: "Post Coach",
    value: mode === "expanded" ? 84 : 76 + index,
    badge: {
      label: "Ship it",
      tone: "ship",
      tooltip: "API supplied Post Coach badge.",
    },
    target: 60,
    engageability: {
      engageable: true,
      reason: "API says this has a concrete reader payoff.",
    },
    failed: [failed],
    warned: [warned],
    passed: [passed],
    counts: {
      flagged: 1,
      nudges: 1,
      onPoint: 1,
    },
    expanded: mode === "expanded",
    previewMode: mode === "preview",
    sections: [
      {
        title: "Worth a look",
        items: [failed],
      },
      {
        title: "Nudges",
        items: [warned],
      },
      {
        title: "On point",
        items: [passed],
      },
    ],
    learnings: [
      {
        text:
          mode === "expanded"
            ? "Expanded API detail: add one specific proof point before shipping."
            : `Preview API learning ${index}: keep the reader payoff explicit.`,
        relevance: "general",
      },
    ],
    learningCaveat,
    hiddenChecks: 0,
    helperText:
      mode === "expanded"
        ? "Expanded deterministic API helper."
        : "Preview deterministic API helper.",
    footerText: "Static API heuristic, not audience history.",
  };
}

function prediction(index: number) {
  const offset = index - 1;

  return {
    status: "available",
    rangeLow: 340 + offset,
    rangeHigh: 620 + offset,
    midpoint: 480 + offset,
    confidence: "high",
    signals: [
      {
        signal_key: "manual_followers",
        label: "Manual follower context",
        multiplier: 1.15,
      },
      {
        signal_key: "text_quality",
        label: "Text quality signal",
        multiplier: 1.05,
      },
    ],
  };
}

function scoredCandidate(candidate: Candidate, mode: "preview" | "expanded", index: number) {
  return {
    status: "scored",
    id: candidate.id,
    text: candidate.text,
    sourceFormat: candidate.format,
    detectedFormat: candidate.format === "debate-question" ? "genuine_question" : "insight_share",
    score: {
      value: mode === "expanded" ? 84 : 76 + index,
      checks: [
        {
          id: `api-check-${index}`,
          kind: "quality",
          label: `API deterministic check ${index}`,
          status: "pass",
        },
      ],
      learnings: [
        {
          text: `API deterministic learning ${index}.`,
          relevance: "general",
        },
      ],
      engageability: {
        engageable: true,
        reason: "API says this is ready for a static rule pass.",
      },
    },
    postCoach: postCoach(mode, index),
    prediction: prediction(index),
    heuristicLabel,
    analyzedAt: checkedAt,
    analyzerVersion: "deterministic-e2e",
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: corsHeaders,
    status,
  });
}

async function fulfillPreflight(route: Route) {
  await route.fulfill({
    headers: corsHeaders,
    status: 204,
  });
}

function requestJson(route: Route): unknown {
  const postData = route.request().postData();

  if (postData === null) {
    throw new Error(`Expected JSON request body for ${route.request().url()}.`);
  }

  return JSON.parse(postData);
}

async function stubEngine(page: Page, captured: CapturedRequests) {
  await page.route(`${engineBaseUrl}/status`, async (route) => {
    await fulfillJson(route, 200, readyStatus());
  });

  await page.route(`${engineBaseUrl}/settings`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    await fulfillJson(route, 200, settingsResponse());
  });

  await page.route(`${engineBaseUrl}/ideas/generate`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    captured.generate.push(requestJson(route));
    await fulfillJson(route, 200, { candidates });
  });

  await page.route(`${engineBaseUrl}/posts/analyze`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    const body = requestJson(route) as AnalyzeRequest;
    captured.analyze.push(body);

    await fulfillJson(route, 200, {
      items: body.items.map((item, index) => {
        const candidate = candidates.find((entry) => entry.id === item.id);

        if (candidate === undefined) {
          throw new Error(`Unexpected candidate id ${item.id}.`);
        }

        return scoredCandidate(candidate, body.presentation.postCoachMode, index + 1);
      }),
    });
  });
}

test("writer generates and scores candidates with deterministic Post Coach details", async ({
  page,
}) => {
  const captured: CapturedRequests = {
    analyze: [],
    generate: [],
  };
  const idea = "Turn launch tradeoffs into useful builder-facing posts.";

  await stubEngine(page, captured);
  await page.goto("/writer");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "Writer" })).toBeVisible();

  const ideaInput = page.getByRole("textbox", { name: "Idea" });
  const followersInput = page.getByRole("spinbutton", { name: "Followers" });

  await ideaInput.pressSequentially(idea);
  await followersInput.pressSequentially("4200");
  await expect(ideaInput).toHaveValue(idea);
  await expect(followersInput).toHaveValue("4200");
  await page.getByRole("button", { name: "Generate" }).click();

  await expect.poll(() => captured.generate.length).toBe(1);
  await expect.poll(() => captured.analyze.length).toBe(1);

  expect(captured.generate[0]).toEqual({
    idea,
  });
  expect(captured.analyze[0]).toEqual({
    items: candidates.map((candidate) => ({
      id: candidate.id,
      sourceFormat: candidate.format,
      text: candidate.text,
    })),
    presentation: {
      postCoachMode: "preview",
    },
    scoringContext: {
      followers: 4200,
    },
  });

  const results = page.getByRole("region", { name: "Generated candidates" });
  for (const [index, candidate] of candidates.entries()) {
    const candidateNumber = index + 1;
    const candidateArticle = results.locator("article", {
      hasText: candidate.text,
    });

    await expect(candidateArticle.getByText(candidate.text)).toBeVisible();
    await expect(candidateArticle.getByRole("progressbar", { name: "Deterministic score" })).toHaveAttribute(
      "aria-valuenow",
      String(76 + candidateNumber),
    );
    await expect(candidateArticle.getByRole("heading", { name: "Post Coach" })).toBeVisible();
    await expect(candidateArticle.getByText(`Preview API learning ${candidateNumber}: keep the reader payoff explicit.`)).toBeVisible();
    await expect(candidateArticle.getByText(learningCaveat)).toBeVisible();
    await expect(candidateArticle.getByText(heuristicLabel)).toBeVisible();
    await expect(candidateArticle.getByText(`${340 + index} - ${620 + index}`)).toBeVisible();
    await expect(candidateArticle.getByText(String(480 + index))).toBeVisible();
    await expect(candidateArticle.getByText("high")).toBeVisible();
    await expect(candidateArticle.getByText("Manual follower context")).toBeVisible();
  }

  const firstCandidate = page.locator("article", { hasText: candidates[0].text });
  await firstCandidate.getByRole("button", { name: "Details" }).click();

  await expect.poll(() => captured.analyze.length).toBe(2);
  expect(captured.analyze[1]).toEqual({
    items: [
      {
        id: candidates[0].id,
        sourceFormat: candidates[0].format,
        text: candidates[0].text,
      },
    ],
    presentation: {
      postCoachMode: "expanded",
    },
    scoringContext: {
      followers: 4200,
    },
  });

  const dialog = page.getByRole("dialog", { name: "Deterministic details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(candidates[0].text)).toBeVisible();
  await expect(dialog.getByText("Expanded API detail: add one specific proof point before shipping.")).toBeVisible();
  await expect(dialog.getByText("Expanded deterministic API helper.")).toBeVisible();
  await expect(dialog.getByText(heuristicLabel)).toBeVisible();
  await expect(dialog.getByText("340 - 620")).toBeVisible();
  await expect(dialog.getByText("480")).toBeVisible();
  await expect(dialog.getByText("high")).toBeVisible();

  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toMatch(/measured performance/i);
  expect(pageText).not.toMatch(/last 30 days/i);
  expect(pageText).not.toMatch(/imported metrics/i);
  expect(pageText).not.toMatch(/live trend/i);
});
