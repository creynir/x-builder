// E2E: My Feedback Loop through the real runner transport and overlay UI.
//
// These flows run against mock X + temp local repositories. The overlay talks to
// the real page-exposed transport bindings; setup data uses the same bindings or
// the runner harness post-library seed helper. No live x.com, network metrics,
// developer storage, or hosted analytics are involved.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { startRunner, type RunnerHarness } from "./support/runner-harness";

const CAPTURED_TEXT =
  "Local-first tools survive the network being hostile. Design for offline and the online path gets simpler too.";
const AMBIGUOUS_TEXT = "A feedback loop needs explicit manual linking when two posts have the same text.";
const MANUAL_POST_ID = "1800000000000000199";

function composer(page: Page): Locator {
  return page.locator('div[data-testid="tweetTextarea_0"]');
}

async function typeDraft(page: Page, text: string): Promise<void> {
  const el = composer(page);
  await el.click();
  await el.fill("");
  await page.keyboard.type(text);
}

function feedbackRecordRequest(text: string, clientEventId: string) {
  return {
    clientEventId,
    action: "manual_record_posted_draft",
    text,
    snapshot: {
      detectedFormat: "genuine_question",
      scoreValue: 72,
      prediction: {
        status: "available",
        signals: [{ signal_key: "quality_voice", label: "Static score 72", multiplier: 0.8 }],
        predictedMidImpressions: 230,
        stallRange: { low: 120, high: 276 },
        escapeRange: { low: 570, high: 2280 },
        escapeProbability: 0.1,
        expectedReplies: 3,
        baseImpressions: 190,
        baseSource: "follower_estimate",
        qualityBasis: "static",
        reachModelVersion: "reach-v1",
      },
      scoringContext: { followers: 1000 },
      analyzerVersion: "deterministic-v1",
      analyzedAt: "2026-06-21T12:00:00.000Z",
    },
  };
}

async function feedbackSummary(h: RunnerHarness): Promise<any> {
  return h.callBinding("getFeedbackLoopSummary", { windowDays: 365, limit: 20 });
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "X Builder settings" }).click();
  await expect(page.getByRole("dialog", { name: "X Builder settings" })).toBeVisible();
}

test("generated draft is recorded once by the overlay and surfaces as pending/unlinked", async () => {
  const h = await startRunner();
  try {
    await h.mountOverlay();

    await h.page.getByRole("button", { name: "Hot take" }).click();

    await expect(h.page.getByText("Needs link")).toBeVisible();
    await expect
      .poll(async () => (await feedbackSummary(h)).totals.predictions)
      .toBe(1);

    const summary = await feedbackSummary(h);
    expect(summary.totals.pendingUnlinked).toBe(1);
    expect(summary.recent[0].status).toBe("pending_unlinked");
  } finally {
    await h.stop();
  }
});

test("typed draft analysis does not create a feedback prediction", async () => {
  const h = await startRunner();
  try {
    await h.mountOverlay();
    await typeDraft(
      h.page,
      "Good onboarding gets the user to one finished task; that specific phrase is the whole job.",
    );

    await expect(h.page.getByText("Static score")).toBeVisible();

    const summary = await feedbackSummary(h);
    expect(summary.totals.predictions).toBe(0);
  } finally {
    await h.stop();
  }
});

test("settings renders server-derived predicted-vs-actual summary for a captured post", async () => {
  const h = await startRunner();
  try {
    await h.mountOverlay();
    await h.callBinding(
      "recordFeedbackPrediction",
      feedbackRecordRequest(CAPTURED_TEXT, "captured-match"),
    );

    await expect
      .poll(async () => (await feedbackSummary(h)).recent[0]?.status)
      .toBe("linked");

    await openSettings(h.page);

    await expect(h.page.getByText("Auto-linked")).toBeVisible();
    await expect(h.page.getByText(CAPTURED_TEXT)).toBeVisible();
    await expect(h.page.getByText(/actual 51200/)).toBeVisible();
    await expect(
      h.page.getByText("This format is beating the current prediction baseline for this account."),
    ).toBeVisible();
  } finally {
    await h.stop();
  }
});

test("ambiguous settings row requires explicit manual link and refreshes to Linked manually", async () => {
  const h = await startRunner();
  try {
    await h.mountOverlay();
    await h.seedCapturedPost({
      platformPostId: MANUAL_POST_ID,
      text: AMBIGUOUS_TEXT,
      impressions: 640,
    });
    await h.seedCapturedPost({
      platformPostId: "1800000000000000200",
      text: AMBIGUOUS_TEXT,
      impressions: 610,
    });
    await h.callBinding(
      "recordFeedbackPrediction",
      feedbackRecordRequest(AMBIGUOUS_TEXT, "ambiguous-match"),
    );

    await expect
      .poll(async () => (await feedbackSummary(h)).recent[0]?.status)
      .toBe("ambiguous");

    await openSettings(h.page);

    await expect(h.page.getByText("Multiple possible posts found")).toBeVisible();
    const linkButton = h.page.getByRole("button", { name: "Link" });
    await expect(linkButton).toBeDisabled();

    await h.page.getByRole("button", { name: MANUAL_POST_ID }).click();
    await expect(linkButton).toBeEnabled();
    await linkButton.click();

    await expect(h.page.getByText("Linked manually")).toBeVisible();
    await expect(h.page.getByText(`Post ${MANUAL_POST_ID}`)).toBeVisible();
  } finally {
    await h.stop();
  }
});
