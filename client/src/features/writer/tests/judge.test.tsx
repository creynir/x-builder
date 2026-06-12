import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { judgeProviderLabels } from "@x-builder/shared";
import type { ApiError, JudgeDraftResponse, JudgeVerdict } from "@x-builder/shared";

import {
  createInitialModel,
  runJudgeDraft,
  type WriterApiClient,
  type WriterPageModel,
} from "../writer-workflow";
import { JudgePanel } from "../writer-page";

// The generalized judge-failure copy lives in the engine (server.ts judgeFailedError).
// Defined once here so a drift between the client fallback and the server string fails
// loudly against a single named expectation rather than a literal retyped per-assertion.
const SERVER_JUDGE_FAILED_MESSAGE = "The judge could not score this draft. Try again.";

const BANNED_JARGON = /codex exec|raw llm|llm judge|judge retry|retry judge/i;

const verdict: JudgeVerdict = {
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
  },
  headline: "Strong hook, weak closer.",
  strengths: ["Concrete claim up front"],
  improvements: ["Trim the middle paragraph"],
};

const judgedResponse: JudgeDraftResponse = {
  status: "judged",
  verdict,
  model: "claude-cli",
  judgedAt: "2026-06-10T12:00:00.000Z",
};

const buildApiClient = (judgeDraft: WriterApiClient["judgeDraft"]): WriterApiClient => ({
  analyzePosts: vi.fn() as unknown as WriterApiClient["analyzePosts"],
  generateIdea: vi.fn() as unknown as WriterApiClient["generateIdea"],
  judgeDraft,
});

const draftModel = (idea: string): WriterPageModel => ({ ...createInitialModel(), idea });

// Mirror WriterPage.publishModel: apply functional updates against running state.
const runWithPublish = (apiClient: WriterApiClient, model: WriterPageModel) => {
  let current = model;
  const publish = (
    update: WriterPageModel | ((value: WriterPageModel) => WriterPageModel),
  ): void => {
    current = typeof update === "function" ? update(current) : update;
  };

  return runJudgeDraft(apiClient, model, publish);
};

describe("runJudgeDraft", () => {
  it("sets a ready verdict on success and sends the trimmed draft", async () => {
    const judgeDraft = vi.fn(async () => judgedResponse);

    const next = await runWithPublish(buildApiClient(judgeDraft), draftModel("  a real draft  "));

    expect(judgeDraft).toHaveBeenCalledWith({ text: "a real draft" });
    expect(next.judge).toEqual({ status: "ready", verdict, model: "claude-cli" });
  });

  it("propagates the response model id onto the ready judge state", async () => {
    const judgeDraft = vi.fn(async () => ({ ...judgedResponse, model: "cursor-cli" }));

    const next = await runWithPublish(buildApiClient(judgeDraft), draftModel("a draft"));

    expect(next.judge.status).toBe("ready");
    if (next.judge.status === "ready") {
      // The producing provider must reach the panel; today the model is dropped.
      expect(next.judge.model).toBe("cursor-cli");
    }
  });

  it("does not call the judge for an empty draft", async () => {
    const judgeDraft = vi.fn();

    const next = await runWithPublish(buildApiClient(judgeDraft), draftModel("   "));

    expect(judgeDraft).not.toHaveBeenCalled();
    expect(next.judge.status).toBe("idle");
  });

  it("captures a failed verdict with the normalized api error", async () => {
    const apiError: ApiError = {
      code: "judge_failed",
      message: "The judge could not score this draft. Try again.",
      scope: "judge",
      retryable: true,
      status: 503,
    };
    const judgeDraft = vi.fn(async () => {
      throw Object.assign(new Error(apiError.message), { apiError });
    });

    const next = await runWithPublish(buildApiClient(judgeDraft), draftModel("a draft"));

    expect(next.judge.status).toBe("failed");
    if (next.judge.status === "failed") {
      expect(next.judge.error.code).toBe("judge_failed");
    }
  });

  it("falls back to the server's generalized judge-failed copy when the error is unparseable", async () => {
    // No `apiError` payload => the client fallback message must render, and it must be
    // byte-identical to the engine's judge_failed copy (asserted via the single named
    // expectation so any drift on either side fails loudly).
    const judgeDraft = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    const next = await runWithPublish(buildApiClient(judgeDraft), draftModel("a draft"));

    expect(next.judge.status).toBe("failed");
    if (next.judge.status === "failed") {
      expect(next.judge.error.message).toBe(SERVER_JUDGE_FAILED_MESSAGE);
    }
  });
});

describe("JudgePanel", () => {
  it("renders the verdict band, confidence, dimension scores, and critique", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{ status: "ready", verdict, model: "claude-cli" }}
        onJudge={() => {}}
        judgeReady
        draftReady
      />,
    );

    expect(html).toContain("Slight rework");
    expect(html).toContain("Confidence: medium");
    // All eight scoring dimensions must render.
    for (const label of [
      "Overall",
      "Replies",
      "Profile clicks",
      "Impressions",
      "Bookmark value",
      "Dwell",
      "Voice match",
      "Negative risk",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("78");
    expect(html).toContain("Strong hook, weak closer.");
    expect(html).toContain("Concrete claim up front");
    expect(html).toContain("Trim the middle paragraph");
  });

  it("attributes the verdict to the producing provider via the shared label catalog", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{ status: "ready", verdict, model: "claude-cli" }}
        onJudge={() => {}}
        judgeReady
        draftReady
      />,
    );

    // The attribution maps the response model id through the shared catalog
    // (claude-cli => "Claude judge"), not a hardcoded provider name.
    expect(html).toContain(`Judged by ${judgeProviderLabels["claude-cli"]}`);
  });

  it("attributes with the raw model id when it falls outside the provider catalog", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{ status: "ready", verdict, model: "quorum-cli" }}
        onJudge={() => {}}
        judgeReady
        draftReady
      />,
    );

    // Unknown ids have no catalog label; the raw id must render rather than blank.
    expect(html).toContain("Judged by quorum-cli");
  });

  it("keeps the attribution naming the verdict producer when a different provider is selected", () => {
    // The verdict was produced by claude-cli; the user has since selected an
    // unavailable provider (judgeReady false). Attribution binds to the PRODUCER,
    // so it must still name Claude judge, not the newly-selected provider.
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{ status: "ready", verdict, model: "claude-cli" }}
        onJudge={() => {}}
        judgeReady={false}
        draftReady
      />,
    );

    expect(html).toContain(`Judged by ${judgeProviderLabels["claude-cli"]}`);
  });

  it("renders the attribution for a max-length model id without breaking the summary row", () => {
    const longModelId = "z".repeat(120);
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{ status: "ready", verdict, model: longModelId }}
        onJudge={() => {}}
        judgeReady
        draftReady
      />,
    );

    expect(html).toContain(`Judged by ${longModelId}`);
    expect(html).toContain("Confidence: medium");
  });

  it("disables the judge button with a neutral, provider-agnostic hint when the judge is not ready", () => {
    const html = renderToStaticMarkup(
      <JudgePanel judge={{ status: "idle" }} onJudge={() => {}} judgeReady={false} draftReady />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain("The judge is unavailable right now. Check the provider in Settings.");
    // The neutral surface must not name a specific provider.
    expect(html.toLowerCase()).not.toContain("codex");
    expect(html).not.toMatch(BANNED_JARGON);
  });

  it("enables the judge button when the judge is ready and a draft is present", () => {
    const html = renderToStaticMarkup(
      <JudgePanel judge={{ status: "idle" }} onJudge={() => {}} judgeReady draftReady />,
    );

    // The judge readiness gate reads the judgeReady prop; with both gates
    // satisfied the button must be interactive rather than disabled.
    expect(html).toContain("Judge draft");
    expect(html).not.toContain("disabled");
  });

  it("disables the judge button for an empty draft", () => {
    const html = renderToStaticMarkup(
      <JudgePanel judge={{ status: "idle" }} onJudge={() => {}} judgeReady draftReady={false} />,
    );

    expect(html).toContain("disabled");
  });

  it("shows a loading affordance and disables the button while judging", () => {
    const html = renderToStaticMarkup(
      <JudgePanel judge={{ status: "loading" }} onJudge={() => {}} judgeReady draftReady />,
    );

    expect(html).toContain("Judging");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
  });

  it("labels the failed-state button with neutral retry copy outside the banned jargon family", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "failed",
          error: {
            code: "judge_failed",
            message: SERVER_JUDGE_FAILED_MESSAGE,
            scope: "judge",
            retryable: true,
            status: 503,
          },
        }}
        onJudge={() => {}}
        judgeReady
        draftReady
      />,
    );

    expect(html).toContain("Try judging again");
    // The previous "Retry judge" label matched the banned jargon family; the new copy must not.
    expect(html).not.toMatch(BANNED_JARGON);
  });

  it("renders a verdict with empty strengths and improvements while still attributing the provider", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: { ...verdict, strengths: [], improvements: [] },
          model: "claude-cli",
        }}
        onJudge={() => {}}
        judgeReady
        draftReady
      />,
    );

    expect(html).toContain("Strong hook, weak closer.");
    expect(html).not.toContain("Strengths");
    expect(html).not.toContain("Improvements");
    // Attribution renders even when the critique sections are empty.
    expect(html).toContain(`Judged by ${judgeProviderLabels["claude-cli"]}`);
  });

  it("renders the error message when judging failed", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "failed",
          error: {
            code: "judge_failed",
            message: SERVER_JUDGE_FAILED_MESSAGE,
            scope: "judge",
            retryable: true,
            status: 503,
          },
        }}
        onJudge={() => {}}
        judgeReady
        draftReady
      />,
    );

    expect(html).toContain(SERVER_JUDGE_FAILED_MESSAGE);
  });

  it("renders no Codex string and no banned jargon anywhere on the judge surface when unavailable", () => {
    const html = renderToStaticMarkup(
      <JudgePanel judge={{ status: "idle" }} onJudge={() => {}} judgeReady={false} draftReady />,
    );

    // Case-insensitive scan of the rendered markup: zero "codex" matches and zero
    // matches for the full banned-jargon regex family.
    expect(html.toLowerCase().includes("codex")).toBe(false);
    expect(BANNED_JARGON.test(html)).toBe(false);
  });
});
