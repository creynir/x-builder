// E2E: External X signals settings through the real runner transport.
//
// The overlay is mounted over mock x.com with real page-exposed transport
// bindings. Mock X emits its own GET GraphQL responses; the runner observes
// them and writes registered external-source evidence into the external ledger
// while own-post capture stays separate.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { startRunner, type RunnerHarness } from "./support/runner-harness";

type CaptureSummary = { postsCaptured: number; followers?: number; screenName?: string };
type ExternalOverview = { totals: { evidence: number; patterns: number }; sources: unknown[] };

async function captureSummary(h: RunnerHarness): Promise<CaptureSummary> {
  return (await h.callBinding("getCaptureSummary")) as CaptureSummary;
}

async function externalOverview(h: RunnerHarness): Promise<ExternalOverview> {
  return (await h.callBinding("getExternalXSignalsOverview", {
    includeRemoved: true,
    sourceLimit: 10,
    patternLimit: 10,
    recentEvidenceLimit: 10,
    refreshRunLimit: 10,
  })) as ExternalOverview;
}

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "X Builder settings" }).click();
  const dialog = page.getByRole("dialog", { name: "X Builder settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function replayExternalGraphQl(page: Page, screenName: string): Promise<void> {
  await page.evaluate(async (value) => {
    const fn = (window as unknown as { __mockXLoadCannedGraphQl?: (name: string) => Promise<void> })
      .__mockXLoadCannedGraphQl;
    if (typeof fn !== "function") {
      throw new Error("Mock X GraphQL replay hook is not installed.");
    }
    await fn(value);
  }, screenName);
}

async function expectHeadingOrder(dialog: Locator): Promise<void> {
  const headings = (await dialog.locator("h3").allTextContents()).map((text) => text.trim());
  expect(headings.indexOf("External X signals")).toBeGreaterThan(
    headings.indexOf("Feedback loop"),
  );
  expect(headings.indexOf("External X signals")).toBeLessThan(headings.indexOf("X archive"));
}

function sourceRow(page: Page): Locator {
  return page.locator("[data-external-x-source-row]").filter({ hasText: "@external_builder" });
}

test("settings manages external X sources from observed page GraphQL without changing own capture summary", async () => {
  const h = await startRunner();
  try {
    await expect
      .poll(async () => (await captureSummary(h)).postsCaptured, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(5);
    const ownBefore = await captureSummary(h);

    await h.mountOverlay();
    const dialog = await openSettings(h.page);
    await expectHeadingOrder(dialog);
    await expect(pageSectionText(h.page, "External X signals")).not.toContainText("Captured posts");
    const initialBox = await dialog.boundingBox();

    await dialog.getByLabel("External X handle").fill("@external_builder");
    await dialog.getByRole("button", { name: "Add" }).click();

    const row = sourceRow(h.page);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Evidence");
    await expect(row).toContainText("0");
    await expect(row).toContainText("Waiting");
    const afterAddBox = await dialog.boundingBox();
    expect(Math.round(afterAddBox!.width)).toBe(Math.round(initialBox!.width));

    await replayExternalGraphQl(h.page, "external_builder");
    await expect.poll(async () => (await externalOverview(h)).totals.evidence).toBeGreaterThan(0);
    await expect.poll(async () => (await externalOverview(h)).totals.patterns).toBeGreaterThan(0);
    await row.getByRole("button", { name: "Refresh" }).click();

    await expect(row).toContainText(/Evidence[1-9]/);
    await expect(h.page.locator("[data-external-x-pattern-row]").first()).toBeVisible();
    await expect(h.page.getByText("Evidence-backed patterns")).toBeVisible();

    const ownAfterExternal = await captureSummary(h);
    expect(ownAfterExternal.postsCaptured).toBe(ownBefore.postsCaptured);

    await row.getByRole("button", { name: "Remove" }).click();
    await expect(h.page.getByText("No external sources")).toBeVisible();
    expect((await captureSummary(h)).postsCaptured).toBe(ownBefore.postsCaptured);

    expect(h.log.craftedGraphQlWrites()).toEqual([]);
    expect(h.log.internalApiMutations()).toEqual([]);
    expect(h.log.graphQlFor("UserTweets").length).toBeGreaterThan(1);
  } finally {
    await h.stop();
  }
});

function pageSectionText(page: Page, heading: string): Locator {
  return page.locator("section", { has: page.getByRole("heading", { name: heading }) });
}
