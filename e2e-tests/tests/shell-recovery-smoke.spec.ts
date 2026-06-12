import { expect, test, type Page, type Route } from "@playwright/test";

const engineBaseUrl = "http://127.0.0.1:4173";
const checkedAt = "2026-06-06T00:00:00.000Z";

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, PATCH, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "content-type": "application/json",
};

type CapturedRequests = {
  analyze: number;
  generate: number;
  settings: number;
  status: number;
};

type StubEngineOptions = {
  status?: () => ReturnType<typeof readyStatus>;
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
    llm: subsystem("Codex judge"),
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

function codexUnavailableStatus() {
  return {
    ...readyStatus(),
    llm: {
      ...subsystem("Codex judge"),
      message: "Codex is unavailable. Deterministic scoring still works.",
      state: "unavailable",
    },
    overall: "partial",
  };
}

function settingsResponse() {
  return {
    settings: {
      claudeModel: "",
      codexModel: "",
      cursorModel: "",
      engineBaseUrl: engineBaseUrl,
      judgeProvider: "codex-cli",
      showDeterministicDetails: true,
      storagePath: "~/.x-builder/e2e",
    },
    source: "defaults",
  };
}

function requestJson(route: Route): unknown {
  const postData = route.request().postData();

  if (postData === null) {
    throw new Error(`Expected JSON request body for ${route.request().url()}.`);
  }

  return JSON.parse(postData);
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

async function stubEngine(page: Page, options: StubEngineOptions = {}) {
  const capturedRequests: CapturedRequests = {
    analyze: 0,
    generate: 0,
    settings: 0,
    status: 0,
  };
  const status = options.status ?? readyStatus;

  await page.route(`${engineBaseUrl}/status`, async (route) => {
    capturedRequests.status += 1;
    await fulfillJson(route, 200, status());
  });

  await page.route(`${engineBaseUrl}/settings`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    capturedRequests.settings += 1;
    await fulfillJson(route, 200, settingsResponse());
  });

  await page.route(`${engineBaseUrl}/ideas/generate`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    capturedRequests.generate += 1;
    await fulfillJson(route, 503, {
      code: "engine_unreachable",
      message: "The local engine could not be reached. Try again.",
      retryable: true,
      scope: "app",
      status: 503,
    });
  });

  await page.route(`${engineBaseUrl}/posts/analyze`, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await fulfillPreflight(route);
      return;
    }

    capturedRequests.analyze += 1;
    requestJson(route);
    await fulfillJson(route, 503, {
      code: "deterministic_analysis_failed",
      message: "Deterministic scoring is temporarily unavailable.",
      retryable: true,
      scope: "deterministic",
      status: 503,
    });
  });

  return capturedRequests;
}

test("opens at root inside the shell and resolves to Writer", async ({ page }) => {
  const requests = await stubEngine(page);

  await page.goto("/");

  await expect(page).toHaveURL(/\/writer$/);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Draft" })).toBeVisible();
  expect(requests.status).toBeGreaterThan(0);
});

test("shows Codex ready status on boot", async ({ page }) => {
  const requests = await stubEngine(page);

  await page.goto("/");

  await expect(page).toHaveURL(/\/writer$/);
  await expect(
    page.getByRole("status").filter({ hasText: "Codex judge ready" }),
  ).toBeVisible();
  expect(requests.status).toBeGreaterThan(0);
});

test("sidebar navigation reaches every shell route with active state", async ({ page }) => {
  const requests = await stubEngine(page);

  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary" });
  const routes = [
    { heading: "Studio", label: "Studio", path: "/writer" },
    { heading: "Voice", label: "Voice", path: "/voice" },
    { heading: "Post Library", label: "Post Library", path: "/library" },
    { heading: "Settings", label: "Settings", path: "/settings" },
  ];

  for (const route of routes) {
    await nav.getByRole("link", { name: route.label }).click();

    await expect(page).toHaveURL(new RegExp(`${route.path}$`));
    await expect(nav.getByRole("link", { name: route.label })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
    ).toBeVisible();
  }

  await expect(page.getByLabel("Engine URL")).toBeVisible();
  await expect(page.getByLabel("Storage path")).toBeVisible();
  await expect(page.getByLabel("Judge provider")).toBeVisible();
  await expect(page.getByLabel("Codex model")).toBeVisible();
  await expect(page.getByLabel("Claude model")).toBeVisible();
  await expect(page.getByLabel("Cursor model")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Studio" })).toBeVisible();
  expect(requests.status).toBeGreaterThan(0);
  expect(requests.settings).toBeGreaterThan(0);
});

test("placeholder routes render useful recovery copy", async ({ page }) => {
  const requests = await stubEngine(page);

  await page.goto("/voice");

  await expect(page.getByRole("heading", { level: 1, name: "Voice" })).toBeVisible();
  await expect(
    page.getByText("Voice profile setup is not part of this shell pass."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Studio" })).toBeVisible();

  await page.getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Post Library" })
    .click();

  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page.getByText("Post memory is reserved for the library feature pass."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Studio" })).toBeVisible();
  expect(requests.status).toBeGreaterThan(0);
});

test("studio preserves draft during deterministic backend failure", async ({ page }) => {
  const requests = await stubEngine(page);

  await page.goto("/writer");

  const idea = "Turn customer support surprises into launch-week content.";
  const ideaInput = page.getByRole("textbox", { name: "Draft" });

  await ideaInput.fill(idea);

  const recovery = page.getByRole("alert");
  await expect(recovery).toBeVisible();
  await expect(recovery.getByText("Route unavailable")).toBeVisible();
  await expect(
    recovery.getByText("Deterministic scoring is temporarily unavailable."),
  ).toBeVisible();
  await expect(ideaInput).toHaveValue(idea);
  await expect(recovery.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  const bannerBox = await recovery.boundingBox();
  const ideaBox = await ideaInput.boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(ideaBox).not.toBeNull();
  expect(bannerBox!.y).toBeLessThan(ideaBox!.y);

  expect(requests.analyze).toBe(1);
  expect(requests.status).toBeGreaterThan(0);
  expect(requests.settings).toBe(0);
  expect(requests.generate).toBe(0);
});

test("keeps Writer usable when only Codex readiness is unavailable", async ({ page }) => {
  const requests = await stubEngine(page, { status: codexUnavailableStatus });

  await page.goto("/writer");

  const status = page.getByRole("status").filter({ hasText: "Codex judge unavailable" });
  await expect(status.getByText("Engine ready")).toBeVisible();
  await expect(status.getByText("Deterministic scorer ready")).toBeVisible();
  await expect(status.getByText("Codex judge unavailable")).toBeVisible();
  await expect(
    status.getByText("Codex is unavailable. Deterministic scoring still works."),
  ).toBeVisible();
  await expect(status.getByRole("button", { name: "Open Settings" })).toBeVisible();

  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Draft" })).toBeEditable();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Deterministic scorer failed")).toHaveCount(0);
  await expect(page.getByText("Route unavailable")).toHaveCount(0);
  expect(requests.status).toBeGreaterThan(0);
});

test("opens Settings from partial readiness without exposing raw judge controls", async ({ page }) => {
  const requests = await stubEngine(page, { status: codexUnavailableStatus });

  await page.goto("/writer");

  await page
    .getByRole("status")
    .filter({ hasText: "Codex judge unavailable" })
    .getByRole("button", { name: "Open Settings" })
    .click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Engine URL")).toBeVisible();
  await expect(page.getByLabel("Storage path")).toBeVisible();
  await expect(page.getByLabel("Judge provider")).toBeVisible();
  await expect(page.getByLabel("Codex command label")).toHaveCount(0);
  await expect(page.getByText("Codex command label")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Test readiness" })).toBeEnabled();
  await expect(page.getByText("Judge provider")).not.toHaveText(
    /codex exec|raw llm|llm judge|judge retry|retry judge/i,
  );
  await expect(page.getByText("Codex model")).not.toHaveText(
    /codex exec|raw llm|llm judge|judge retry|retry judge/i,
  );
  await expect(page.getByText("Leave empty to use the provider's default.")).not.toHaveText(
    /codex exec|raw llm|llm judge|judge retry|retry judge/i,
  );

  await page.getByRole("button", { name: "Test readiness" }).click();

  await expect(page.getByText("Codex judge unavailable")).toBeVisible();
  await expect(page.getByText("Deterministic scorer ready")).toBeVisible();
  await expect(page.getByText(/codex exec|raw llm|llm judge|judge retry|retry judge/i)).toHaveCount(0);
  expect(requests.status).toBeGreaterThanOrEqual(2);
  expect(requests.settings).toBeGreaterThan(0);
});
