import { expect, test } from "@playwright/test";

import { sampleVerdict, stubEngine } from "./support/engine-stub";

test("judges a pasted draft and renders the verdict panel with provider attribution", async ({ page }) => {
  await stubEngine(page, { slotState: "ready" });
  await page.goto("/writer");
  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();

  await page.getByRole("textbox", { name: "Draft" }).fill(
    "Most onboarding advice is wrong. You need one screen where the user finishes their first real task.",
  );

  const judgeButton = page.getByRole("button", { name: "Judge draft" });
  await expect(judgeButton).toBeEnabled();
  await judgeButton.click();

  const judgePanel = page.getByRole("region", { name: "Draft judge" });
  await expect(judgePanel.getByText("Slight rework")).toBeVisible();
  await expect(judgePanel.getByText("Confidence: medium")).toBeVisible();
  await expect(judgePanel.getByText("Overall")).toBeVisible();
  await expect(judgePanel.getByText(sampleVerdict.headline)).toBeVisible();
  await expect(judgePanel.getByText(sampleVerdict.strengths[0]!)).toBeVisible();
  await expect(judgePanel.getByText(sampleVerdict.improvements[0]!)).toBeVisible();
  // The stubbed response model "codex-cli" maps through the shared catalog to "Codex judge".
  await expect(judgePanel.getByText("Judged by Codex judge")).toBeVisible();
});

test("disables the judge button with a neutral hint when the provider is unavailable", async ({ page }) => {
  await stubEngine(page, { slotState: "unavailable" });
  await page.goto("/writer");
  await expect(page.getByRole("heading", { level: 1, name: "Studio" })).toBeVisible();

  await page.getByRole("textbox", { name: "Draft" }).fill("A draft that cannot be judged right now.");

  await expect(page.getByRole("button", { name: "Judge draft" })).toBeDisabled();
  await expect(
    page.getByText("The judge is unavailable right now. Check the provider in Settings."),
  ).toBeVisible();
});
