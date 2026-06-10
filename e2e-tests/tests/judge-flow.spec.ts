import { expect, test, type Page, type Route } from "@playwright/test";

const engineBaseUrl = "http://127.0.0.1:4173";
const checkedAt = "2026-06-08T08:00:00.000Z";

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, PATCH, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "content-type": "application/json",
};

const verdict = {
  rating: 8,
  headline: "Strong hook, weak closer.",
  strengths: ["Opens with a concrete claim", "Ends on a reply-friendly question"],
  improvements: ["Trim the middle paragraph", "Cut one hedge word"],
};

function subsystem(label: string, state: "ready" | "unavailable") {
  return { checkedAt, details: {}, label, retryable: state !== "ready", state };
}

function statusBody(codexState: "ready" | "unavailable") {
  return {
    codex: subsystem("Codex judge", codexState),
    deterministic: subsystem("Deterministic scorer", "ready"),
    engine: subsystem("Engine", "ready"),
    generatedAt: checkedAt,
    lastRun: { state: "none" },
    overall: codexState === "ready" ? "ready" : "partial",
    storage: subsystem("Storage", "ready"),
    version: "e2e",
  };
}

function scoredAnalyzeBody(body: { items: Array<{ id: string; text: string }> }) {
  return {
    items: body.items.map((item) => ({
      status: "scored",
      id: item.id,
      text: item.text,
      detectedFormat: "insight_share",
      score: {
        value: 80,
        checks: [{ id: "api-check", kind: "quality", label: "API check", status: "pass" }],
        learnings: [],
        engageability: { engageable: true, reason: "Ready for a static pass." },
      },
      postCoach: { state: "empty", title: "Post Coach", message: "Preview." },
      prediction: { status: "disabled", reason: "missing_followers", message: "Add followers." },
      heuristicLabel: "Heuristic rank, not prediction.",
      analyzedAt: checkedAt,
      analyzerVersion: "deterministic-e2e",
    })),
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ body: JSON.stringify(body), headers: corsHeaders, status });
}

async function stubEngine(
  page: Page,
  options: { codexState: "ready" | "unavailable"; onJudge?: (route: Route) => Promise<void> },
) {
  await page.route(`${engineBaseUrl}/status`, async (route) => {
    await fulfillJson(route, 200, statusBody(options.codexState));
  });
  await page.route(`${engineBaseUrl}/settings`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    await fulfillJson(route, 200, {
      settings: {
        codexCommandLabel: "Codex judge",
        engineBaseUrl,
        runCodexJudgeAfterGeneration: false,
        showDeterministicDetails: true,
        storagePath: "~/.x-builder/e2e",
      },
      source: "defaults",
    });
  });
  await page.route(`${engineBaseUrl}/posts/analyze`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    await fulfillJson(route, 200, scoredAnalyzeBody(JSON.parse(route.request().postData() ?? "{}")));
  });
  await page.route(`${engineBaseUrl}/drafts/judge`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    if (options.onJudge !== undefined) {
      await options.onJudge(route);
      return;
    }
    await fulfillJson(route, 200, { status: "judged", verdict, model: "codex-cli", judgedAt: checkedAt });
  });
}

test("judges a pasted draft and renders the Codex verdict panel", async ({ page }) => {
  await stubEngine(page, { codexState: "ready" });
  await page.goto("/writer");
  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();

  await page.getByRole("textbox", { name: "Draft" }).fill(
    "Most onboarding advice is wrong. You need one screen where the user finishes their first real task.",
  );

  const judgeButton = page.getByRole("button", { name: "Judge draft" });
  await expect(judgeButton).toBeEnabled();
  await judgeButton.click();

  const judgePanel = page.getByRole("region", { name: "Codex judge" });
  await expect(judgePanel.getByText("8/10")).toBeVisible();
  await expect(judgePanel.getByText("Strong hook, weak closer.")).toBeVisible();
  await expect(judgePanel.getByText("Opens with a concrete claim")).toBeVisible();
  await expect(judgePanel.getByText("Trim the middle paragraph")).toBeVisible();

  await page.screenshot({ path: "/tmp/lj-judge-verdict.png", fullPage: true });
});

test("disables the judge button with a hint when codex is unavailable", async ({ page }) => {
  await stubEngine(page, { codexState: "unavailable" });
  await page.goto("/writer");
  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();

  await page.getByRole("textbox", { name: "Draft" }).fill("A draft that cannot be judged right now.");

  await expect(page.getByRole("button", { name: "Judge draft" })).toBeDisabled();
  await expect(page.getByText("Codex judge is unavailable right now.")).toBeVisible();

  await page.screenshot({ path: "/tmp/lj-judge-unavailable.png", fullPage: true });
});
