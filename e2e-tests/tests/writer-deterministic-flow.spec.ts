import { expect, test, type Page, type Route } from "@playwright/test";

import {
  corsHeaders,
  engineBaseUrl,
  fulfillJson,
  fulfillPreflight,
  requestJson,
  settingsBody,
  statusBody,
} from "./support/engine-stub";

const checkedAt = "2026-06-08T08:00:00.000Z";
const learningCaveat =
  "Static rule check. Imported performance data is not connected yet.";
const heuristicLabel = "Heuristic rank, not prediction.";

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

type AnalysisSource = {
  format?: string;
  id: string;
  text: string;
};

type StubEngineOptions = {
  analyze?: (route: Route, body: AnalyzeRequest, requestCount: number) => Promise<void>;
  generate?: (route: Route, body: unknown, requestCount: number) => Promise<void>;
};

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

// Four-regime reach prediction, schema-shaped to availableEngagementPredictionSchema
// (deterministic-analysis.ts). The legacy rangeLow/rangeHigh/midpoint/confidence
// fields were deleted by RMU; the card now renders the regime values + signals via
// ReachRegimeBlock. The offset keeps each candidate's reach distinct per request.
function prediction(index: number) {
  const offset = index - 1;

  return {
    status: "available",
    predictedMidImpressions: 480 + offset,
    stallRange: { low: 340 + offset, high: 620 + offset },
    escapeRange: { low: 6000 + offset, high: 40000 + offset },
    escapeProbability: 0.12,
    expectedReplies: 9,
    baseImpressions: 480 + offset,
    baseSource: "follower_estimate",
    qualityBasis: "static",
    reachModelVersion: "reach-e2e",
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

function scoredCandidate(
  candidate: AnalysisSource,
  mode: "preview" | "expanded",
  index: number,
) {
  const detectedFormat =
    candidate.format === "debate-question" ? "genuine_question" : "insight_share";

  return {
    status: "scored",
    id: candidate.id,
    text: candidate.text,
    sourceFormat: candidate.format,
    detectedFormat,
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

function scoreFailedCandidate(
  candidate: AnalysisSource,
  message = "Deterministic scoring timed out.",
) {
  return {
    status: "score_failed",
    id: candidate.id,
    text: candidate.text,
    sourceFormat: candidate.format,
    reason: "analysis_failed",
    message,
    retryable: true,
  };
}

function routeError(message: string, code: "generation_failed" | "deterministic_analysis_failed") {
  return {
    code,
    message,
    retryable: true,
    scope: code === "generation_failed" ? "writer" : "deterministic",
    status: 503,
  };
}

async function stubEngine(
  page: Page,
  captured: CapturedRequests,
  options: StubEngineOptions = {},
) {
  // /status, /settings, and /drafts/judge come from the shared parameterized
  // builder (default-ready Codex slot) so this spec carries no bespoke status
  // or settings literals. /ideas/generate and /posts/analyze stay local: they
  // sequence deterministic-domain responses per request, which is this spec's
  // subject under test.
  await page.route(`${engineBaseUrl}/status`, async (route) => {
    await fulfillJson(route, 200, statusBody());
  });

  await page.route(`${engineBaseUrl}/settings`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    await fulfillJson(route, 200, settingsBody());
  });

  await page.route(`${engineBaseUrl}/drafts/judge`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        code: "judge_failed",
        message: "Judging is not exercised in this flow.",
        retryable: true,
        scope: "judge",
        status: 503,
      }),
      headers: corsHeaders,
      status: 503,
    });
  });

  await page.route(`${engineBaseUrl}/ideas/generate`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    const body = requestJson(route);
    captured.generate.push(body);

    if (options.generate !== undefined) {
      await options.generate(route, body, captured.generate.length);
      return;
    }

    await fulfillJson(route, 200, { candidates });
  });

  await page.route(`${engineBaseUrl}/posts/analyze`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    const body = requestJson(route) as AnalyzeRequest;
    captured.analyze.push(body);

    if (options.analyze !== undefined) {
      await options.analyze(route, body, captured.analyze.length);
      return;
    }

    await fulfillJson(route, 200, {
      items: body.items.map((item, index) => {
        const candidate =
          candidates.find((entry) => entry.id === item.id) ??
          {
            format: item.sourceFormat,
            id: item.id,
            text: item.text,
          };

        return scoredCandidate(candidate, body.presentation.postCoachMode, index + 1);
      }),
    });
  });
}

test("studio scores pasted draft automatically with prediction above coach", async ({
  page,
}) => {
  const captured: CapturedRequests = {
    analyze: [],
    generate: [],
  };
  const draft = "Launch notes get better when they name the tradeoff, not just the feature.";

  await stubEngine(page, captured);
  await page.goto("/writer");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();

  const draftInput = page.getByRole("textbox", { name: "Draft" });
  const followersInput = page.getByRole("spinbutton", { name: "Followers" });

  await followersInput.fill("4200");
  await draftInput.fill(draft);
  await expect(draftInput).toHaveValue(draft);
  await expect(followersInput).toHaveValue("4200");

  await expect.poll(() => captured.analyze.length).toBe(1);

  expect(captured.analyze[0]).toEqual({
    items: [
      {
        id: "draft-post",
        text: draft,
      },
    ],
    presentation: {
      postCoachMode: "preview",
    },
    scoringContext: {
      followers: 4200,
    },
  });
  expect(captured.generate).toHaveLength(0);

  const results = page.getByRole("region", { name: "Studio evaluation" });
  await expect(results.getByRole("heading", { name: "Engagement Prediction" })).toBeVisible();
  await expect(results.getByRole("heading", { name: "Draft Review" })).toBeVisible();
  // Four-regime reach surface (ReachRegimeBlock): the expected-reach midpoint, the
  // typical range, and the escape likelihood replace the old single range +
  // midpoint + confidence display.
  await expect(results.getByText("Expected reach")).toBeVisible();
  await expect(results.getByText("480")).toBeVisible();
  await expect(results.getByText("Typical reach")).toBeVisible();
  await expect(results.getByText("340 – 620")).toBeVisible();
  await expect(results.getByText("12% escape")).toBeVisible();
  await expect(results.getByText("Manual follower context")).toBeVisible();
  await expect(results.getByText(learningCaveat)).toBeVisible();

  const resultText = await results.innerText();
  expect(resultText.indexOf("Engagement Prediction")).toBeLessThan(
    resultText.indexOf("Draft Review"),
  );

  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toMatch(/measured performance/i);
  expect(pageText).not.toMatch(/last 30 days/i);
  expect(pageText).not.toMatch(/imported metrics/i);
  expect(pageText).not.toMatch(/live trend/i);
});

test("studio missing-followers recovery focuses the manual context panel", async ({
  page,
}) => {
  const captured: CapturedRequests = {
    analyze: [],
    generate: [],
  };
  const draft = "Show deterministic scoring without follower context.";

  await stubEngine(page, captured, {
    analyze: async (route, body) => {
      await fulfillJson(route, 200, {
        items: body.items.map((item, index) => {
          const candidate =
            candidates.find((entry) => entry.id === item.id) ??
            {
              format: item.sourceFormat,
              id: item.id,
              text: item.text,
            };

          return {
            ...scoredCandidate(candidate, body.presentation.postCoachMode, index + 1),
            prediction: {
              status: "disabled",
              reason: "missing_followers",
              message: "Prediction needs follower count.",
            },
          };
        }),
      });
    },
  });
  await page.goto("/writer");

  const followersInput = page.getByRole("spinbutton", { name: "Followers" });
  await page.getByRole("textbox", { name: "Draft" }).fill(draft);

  await expect.poll(() => captured.analyze.length).toBe(1);
  expect(captured.generate).toHaveLength(0);

  const results = page.getByRole("region", { name: "Studio evaluation" });
  await expect(results.getByText("Prediction needs follower count.")).toBeVisible();
  await results.getByRole("button", { name: "Add followers" }).click();

  await expect(followersInput).toBeFocused();
});

test("studio retries deterministic scoring without generating alternatives", async ({
  page,
}) => {
  const captured: CapturedRequests = {
    analyze: [],
    generate: [],
  };
  const draft = "Make deterministic recovery obvious without changing the draft copy.";
  const draftCandidate = {
    id: "draft-post",
    text: draft,
  };

  await stubEngine(page, captured, {
    analyze: async (route, body, requestCount) => {
      if (requestCount === 1) {
        await fulfillJson(route, 200, {
          items: [scoreFailedCandidate(draftCandidate)],
        });
        return;
      }

      expect(body.items).toEqual([
        {
          id: draftCandidate.id,
          text: draftCandidate.text,
        },
      ]);

      await fulfillJson(route, 200, {
        items: [scoredCandidate(draftCandidate, "preview", 1)],
      });
    },
  });
  await page.goto("/writer");

  await page.getByRole("spinbutton", { name: "Followers" }).fill("4200");
  await page.getByRole("textbox", { name: "Draft" }).fill(draft);

  await expect.poll(() => captured.analyze.length).toBe(1);
  expect(captured.generate).toHaveLength(0);

  const results = page.getByRole("region", { name: "Studio evaluation" });

  await expect(results.getByText("Score failed")).toBeVisible();
  await expect(results.getByText("Deterministic scoring timed out.")).toBeVisible();

  await results.getByRole("button", { name: "Retry score" }).click();

  await expect.poll(() => captured.analyze.length).toBe(2);
  expect(captured.generate).toHaveLength(0);
  expect(captured.analyze[1]).toEqual({
    items: [
      {
        id: draftCandidate.id,
        text: draftCandidate.text,
      },
    ],
    presentation: {
      postCoachMode: "preview",
    },
    scoringContext: {
      followers: 4200,
    },
  });

  await expect(results.getByRole("heading", { name: "Engagement Prediction" })).toBeVisible();
  await expect(results.getByRole("heading", { name: "Draft Review" })).toBeVisible();
  await expect(results.getByText(learningCaveat)).toBeVisible();
  // The recovered draft renders the four-regime reach surface in place of the
  // old single range + midpoint display.
  await expect(results.getByText("Expected reach")).toBeVisible();
  await expect(results.getByText("Typical reach")).toBeVisible();
  await expect(results.getByText("340 – 620")).toBeVisible();
  await expect(results.getByText("480")).toBeVisible();
  await expect(results.getByText("Manual follower context")).toBeVisible();
});

test("studio keeps draft visible when deterministic analysis route fails", async ({
  page,
}) => {
  const captured: CapturedRequests = {
    analyze: [],
    generate: [],
  };
  const draft = "Keep the pasted draft on screen when scoring cannot reach the route.";
  const draftInput = () => page.getByRole("textbox", { name: "Draft" });

  await stubEngine(page, captured, {
    analyze: async (route, body, requestCount) => {
      if (requestCount > 1) {
        await fulfillJson(route, 200, {
          items: body.items.map((item, index) => {
            const candidate =
              candidates.find((entry) => entry.id === item.id) ??
              {
                format: item.sourceFormat,
                id: item.id,
                text: item.text,
              };

            return scoredCandidate(candidate, body.presentation.postCoachMode, index + 1);
          }),
        });
        return;
      }

      await fulfillJson(
        route,
        503,
        routeError(
          "Deterministic scoring is temporarily unavailable.",
          "deterministic_analysis_failed",
        ),
      );
    },
  });
  await page.goto("/writer");

  await draftInput().fill(draft);

  await expect.poll(() => captured.analyze.length).toBe(1);
  expect(captured.generate).toHaveLength(0);
  await expect(draftInput()).toHaveValue(draft);

  const recovery = page.getByRole("alert");
  await expect(recovery.getByText("Route unavailable")).toBeVisible();
  await expect(
    recovery.getByText("Deterministic scoring is temporarily unavailable."),
  ).toBeVisible();
  await recovery.getByRole("button", { name: "Retry" }).click();

  await expect.poll(() => captured.analyze.length).toBe(2);
  expect(captured.generate).toHaveLength(0);
  expect(captured.analyze[1]).toEqual({
    items: [
      {
        id: "draft-post",
        text: draft,
      },
    ],
    presentation: {
      postCoachMode: "preview",
    },
    scoringContext: {},
  });
  const results = page.getByRole("region", { name: "Studio evaluation" });
  await expect(
    results.getByRole("heading", { name: "Draft Review" }),
  ).toBeVisible();
  await expect(
    results.getByRole("progressbar", { name: "Draft Review" }).first(),
  ).toHaveAttribute("aria-valuenow", "77");
});
