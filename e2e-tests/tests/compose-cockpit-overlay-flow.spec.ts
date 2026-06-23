// E2E: runner ⇄ local mock x.com — the compose-cockpit overlay flows + the
// invariants that depend on the rendered overlay.
//
// Each test boots a real RunnerApp against the route-mocked x.com, injects the
// real @x-builder/overlay bundle, mounts it, and drives the compose flow through
// the SAME transport bindings the production overlay consumes — with only the LLM
// provider faked (deterministic, per-purpose) and a ready-judge readiness service.
// Assertions use semantic selectors (role/text the cockpit renders) and Playwright
// auto-waiting; there are NO hard sleeps, positional selectors, or timing
// assumptions.
//
// Playwright's locators pierce OPEN shadow roots, so getByText/getByRole reach
// into the overlay's <xb-overlay-root> shadow tree (mode "open", per bootstrap).

import { expect, test, type Locator, type Page } from "@playwright/test";

import { startRunner, type RunnerHarness } from "./support/runner-harness";

// The mock composer (X's contenteditable). Typing into it drives ComposeContext.
function composer(page: Page): Locator {
  return page.locator('div[data-testid="tweetTextarea_0"]');
}

// Type `text` into the contenteditable composer as a real user would. The cockpit
// reads the composer's textContent (debounced ~350 ms) to drive analyze/judge.
async function typeDraft(page: Page, text: string): Promise<void> {
  const el = composer(page);
  await el.click();
  await el.fill(""); // contenteditable fill clears
  await page.keyboard.type(text);
}

// A user-typed draft that lands in the slight_rework band (the fake judge scores
// any draft carrying the annotation quote at 78 → slight_rework, the correct
// state for OFFERING Apply-all) and contains the annotation quote the fake judge
// underlines (blue). The default fake policy quote is "specific phrase".
const TYPED_DRAFT =
  "Good onboarding gets the user to one finished task; that specific phrase is the whole job.";

// Flow A — type → user_written → blue annotations → Apply all → improved → green.
test("Flow A: typing fills the static column, the judge pulses then lands a verdict with blue annotations + Apply-all, and Apply-all rewrites to a green/approved generated post", async () => {
  const h: RunnerHarness = await startRunner();
  try {
    await h.mountOverlay();
    await typeDraft(h.page, TYPED_DRAFT);

    // Static engine fills fast with deterministic metrics.
    await expect(h.page.getByText("◆ Static engine")).toBeVisible();
    await expect(h.page.getByText("Static score")).toBeVisible();
    await expect(h.page.getByText("Reach prediction")).toBeVisible();

    // The judge pulses, then lands the verdict band + the 13-dimension grid. The
    // band Badge text is EXACTLY "Slight rework" (the aria-live announcement embeds
    // the same label in a longer string, so match exactly to target the Badge).
    // "Stranger answerability" is a distinctive dimension label that proves the
    // 13-dim ScoreBar grid rendered.
    await expect(h.page.getByText(/AI judge running/)).toBeVisible();
    await expect(h.page.getByText("Slight rework", { exact: true })).toBeVisible();
    await expect(h.page.getByText("Stranger answerability").first()).toBeVisible();

    // Blue annotation underlay is painted over the exact quoted substring.
    const blue = h.page.locator('[role="mark"]');
    await expect(blue.first()).toBeVisible();

    // user_written + judged ⇒ "Apply all suggestions" is offered.
    const applyAll = h.page.getByRole("button", { name: /Apply all suggestions/ });
    await expect(applyAll).toBeVisible();

    // Click Apply-all: the rewrite is written into the composer + re-pinned green.
    await applyAll.click();

    // On completion: generated state ⇒ "✓ Judge approved", green wash, blue hidden,
    // Apply-all gone (loop prevention).
    await expect(h.page.getByText("✓ Judge approved")).toBeVisible();
    await expect(applyAll).toHaveCount(0);
    await expect(blue).toHaveCount(0);
    // The improved text was written into the composer (explicit gesture).
    await expect(composer(h.page)).not.toHaveText(TYPED_DRAFT);
  } finally {
    await h.stop();
  }
});

// Flow B — generated entry from a refined candidate (pre-approved, no judge wait).
test("Flow B: clicking a generate category writes a pre-judged candidate, pins it green immediately, shows ✓ Judge approved, and never shows the judge pulse", async () => {
  const h = await startRunner();
  try {
    await h.mountOverlay();

    // The LEFT rail lists the cold-start categories from getGenerateCategories().
    const hotTake = h.page.getByRole("button", { name: "Hot take" });
    await expect(hotTake).toBeVisible();
    await hotTake.click();

    // The refined candidate carries verdict + approved ⇒ pinned green at once.
    await expect(h.page.getByText("✓ Judge approved")).toBeVisible();
    // A pre-judged entry skips the judge-pulse entirely.
    await expect(h.page.getByText(/AI judge running/)).toHaveCount(0);
    // No blue highlights in the generated (green) state.
    await expect(h.page.locator('[role="mark"]')).toHaveCount(0);
    // The composer received the written candidate text.
    await expect(composer(h.page)).not.toHaveText("");
  } finally {
    await h.stop();
  }
});

// Flow C — edit a generated post → flip to user_written → blue reappears.
test("Flow C: editing a generated (green) post flips provenance to user_written, drops the green wash, re-judges, and brings back the blue annotations + Apply-all", async () => {
  const h = await startRunner();
  try {
    await h.mountOverlay();

    // Reach the generated/green state via Flow B.
    await h.page.getByRole("button", { name: "Hot take" }).click();
    await expect(h.page.getByText("✓ Judge approved")).toBeVisible();

    // Edit the composer so its text no longer matches the green anchor, and make
    // sure the annotation quote is present so the re-judge produces a blue span.
    await composer(h.page).click();
    await h.page.keyboard.type(" plus an edited tail with the specific phrase added.");

    // Provenance flips → the approval badge clears, the judge re-runs, and blue
    // annotations + Apply-all return on the fresh verdict.
    await expect(h.page.getByText("✓ Judge approved")).toHaveCount(0);
    // Match the verdict Badge exactly (the aria-live announcement embeds the label).
    await expect(h.page.getByText("Slight rework", { exact: true })).toBeVisible();
    await expect(h.page.locator('[role="mark"]').first()).toBeVisible();
    await expect(h.page.getByRole("button", { name: /Apply all suggestions/ })).toBeVisible();
  } finally {
    await h.stop();
  }
});

// Flow E / Invariant #6 — highlight degrade: a quote edited out is silently
// dropped, no throw, typing stays responsive.
test("Flow E + Invariant #6: removing the annotated phrase silently drops its blue underlay without throwing, and the composer stays responsive", async () => {
  const h = await startRunner();
  const pageErrors: string[] = [];
  h.page.on("pageerror", (e) => pageErrors.push(e.message));
  try {
    await h.mountOverlay();
    await typeDraft(h.page, TYPED_DRAFT);

    // A blue underlay for "specific phrase" is present after the judge lands.
    await expect(h.page.locator('[role="mark"]').first()).toBeVisible();

    // Edit the phrase OUT of the composer entirely.
    await typeDraft(
      h.page,
      "Most onboarding decks explain the product when they should get the user to one finished task instead.",
    );

    // The corresponding blue rect is silently removed; no error thrown; typing
    // still produces a fresh static/judge pass (the static column stays rendered).
    await expect(h.page.locator('[role="mark"]')).toHaveCount(0);
    await expect(h.page.getByText("◆ Static engine")).toBeVisible();
    // The composer remains responsive — a further keystroke lands.
    await composer(h.page).click();
    await h.page.keyboard.type(" still typing.");
    await expect(composer(h.page)).toContainText("still typing.");
    expect(pageErrors).toEqual([]);
  } finally {
    await h.stop();
  }
});

// Flow F — static-fast-then-judge-pulse-then-fill sequence. The judge HANGS, so we
// can observe the static column filling and staying rendered while the judge runs.
test("Flow F: the static column fills before the judge completes and does not clear or show a loading state while the judge is still running", async () => {
  const h = await startRunner({ llmPolicy: { judge: "hang" } });
  try {
    await h.mountOverlay();
    await typeDraft(h.page, TYPED_DRAFT);

    // Static fills (deterministic, fast) while the judge is still pulsing.
    await expect(h.page.getByText("Static score")).toBeVisible();
    await expect(h.page.getByText("Reach prediction")).toBeVisible();
    await expect(h.page.getByText(/AI judge running/)).toBeVisible();

    // The judge never returns (hung), but the static column stays rendered — it
    // does not clear back to its scoring/loading slots.
    await expect(h.page.getByText("Static score")).toBeVisible();
    await expect(h.page.getByText(/AI judge running/)).toBeVisible();
  } finally {
    await h.stop();
  }
});

// Invariant #3 — static metrics render without the judge (judge hangs ⇒ timeout).
test("Invariant #3: with the judge hung, the static column still fills with valid deterministic metrics", async () => {
  const h = await startRunner({ llmPolicy: { judge: "hang" } });
  try {
    await h.mountOverlay();
    await typeDraft(h.page, TYPED_DRAFT);

    await expect(h.page.getByText("Static score")).toBeVisible({ timeout: 5_000 });
    await expect(h.page.getByText("Reach prediction")).toBeVisible();
    // Static did NOT block on the judge: it never shows a failed/empty state here.
    await expect(h.page.getByText(/Static scoring failed/)).toHaveCount(0);
  } finally {
    await h.stop();
  }
});

// Invariant #4 — judge-down ≠ static-down (judge returns failed).
test("Invariant #4: when the judge returns failed, the JudgeStrip shows the failure Alert + retry while the static column stays fully rendered", async () => {
  const h = await startRunner({ llmPolicy: { judge: "fail" } });
  try {
    await h.mountOverlay();
    await typeDraft(h.page, TYPED_DRAFT);

    // The judge channel surfaces its failure + a retry affordance.
    await expect(h.page.getByText(/AI judge failed/)).toBeVisible();
    await expect(h.page.getByRole("button", { name: "Retry judge" })).toBeVisible();
    // The static column is unaffected — it stays rendered with its metrics.
    await expect(h.page.getByText("Static score")).toBeVisible();
    await expect(h.page.getByText("Reach prediction")).toBeVisible();
  } finally {
    await h.stop();
  }
});

// Invariant #5 — apply-all loop prevention. After Flow A's generated/green state,
// "Apply all suggestions" must be ABSENT from the DOM.
test("Invariant #5: once the composer is in the generated (green) state, Apply all suggestions is absent from the DOM", async () => {
  const h = await startRunner();
  try {
    await h.mountOverlay();
    await typeDraft(h.page, TYPED_DRAFT);

    const applyAll = h.page.getByRole("button", { name: /Apply all suggestions/ });
    await expect(applyAll).toBeVisible();
    await applyAll.click();

    // Generated state reached: the apply-all affordance is gone (not just disabled).
    await expect(h.page.getByText("✓ Judge approved")).toBeVisible();
    await expect(applyAll).toHaveCount(0);
  } finally {
    await h.stop();
  }
});
