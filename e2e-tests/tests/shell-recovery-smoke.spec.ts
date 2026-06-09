import { expect, test, type Page, type Route } from "@playwright/test";

const engineBaseUrl = "http://127.0.0.1:4173";
const checkedAt = "2026-06-06T00:00:00.000Z";

const corsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, PATCH, POST, OPTIONS",
  "access-control-allow-origin": "*",
  "content-type": "application/json",
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
      engineBaseUrl: engineBaseUrl,
      runCodexJudgeAfterGeneration: false,
      showDeterministicDetails: true,
      storagePath: "~/.x-builder/e2e",
    },
    source: "defaults",
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

async function stubEngine(page: Page) {
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

    await fulfillJson(route, 503, {
      code: "engine_unreachable",
      message: "The local engine could not be reached. Try again.",
      retryable: true,
      scope: "app",
      status: 503,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await stubEngine(page);
});

test("opens at root inside the shell and resolves to Writer", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/writer$/);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Writer" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Idea" })).toBeVisible();
});

test("sidebar navigation reaches every shell route with active state", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Primary" });
  const routes = [
    { heading: "Writer", label: "Writer", path: "/writer" },
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
  await expect(page.getByRole("button", { name: "Back to Writer" })).toBeVisible();
});

test("placeholder routes render useful recovery copy", async ({ page }) => {
  await page.goto("/voice");

  await expect(page.getByRole("heading", { level: 1, name: "Voice" })).toBeVisible();
  await expect(
    page.getByText("Voice profile setup is not part of this shell pass."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Writer" })).toBeVisible();

  await page.getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Post Library" })
    .click();

  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page.getByText("Post memory is reserved for the library feature pass."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Writer" })).toBeVisible();
});

test("writer preserves input during backend failure and opens settings from recovery", async ({ page }) => {
  await page.goto("/writer");

  const idea = "Turn customer support surprises into launch-week content.";
  const ideaInput = page.getByRole("textbox", { name: "Idea" });

  await ideaInput.fill(idea);
  await page.getByRole("button", { name: "Generate" }).click();

  const recovery = page.getByRole("alert");
  await expect(recovery).toBeVisible();
  await expect(recovery.getByText("Route unavailable")).toBeVisible();
  await expect(ideaInput).toHaveValue(idea);
  await expect(recovery.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible();

  const bannerBox = await recovery.boundingBox();
  const ideaBox = await ideaInput.boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(ideaBox).not.toBeNull();
  expect(bannerBox!.y).toBeLessThan(ideaBox!.y);

  await recovery.getByRole("button", { name: "Open Settings" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Engine URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
});
