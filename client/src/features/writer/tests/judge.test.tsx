import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { judgeProviderLabels } from "@x-builder/shared";
import type {
  ApiError,
  JudgeDraftResponse,
  JudgeScores,
  JudgeVerdict,
} from "@x-builder/shared";

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
    answerEffort: 55,
    strangerAnswerability: 48,
    statusDependency: 30,
    replyVsQuoteOrientation: 62,
    audienceMatch: null,
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

// Verdict builder for the judge panel render tests. The base carries all
// thirteen dimensions (the eight legacy + the five behavioral). `audienceMatch`
// is required on the wire but nullable; callers override individual scores to
// exercise the null-recovery, numeric, and pole-edge variants without retyping
// the whole verdict.
const buildVerdict = (scores: Partial<JudgeScores> = {}): JudgeVerdict => ({
  ...verdict,
  scores: { ...verdict.scores, ...scores },
});

// SSR-faithful element-tree traversal (the harness is node-env, no DOM and no
// testing-library). renderToStaticMarkup drops event handlers, so handler
// wiring is verified by walking the rendered React element tree and invoking
// the captured handler — the same component-level pattern foundation.test.tsx
// uses for the Switch onChange.
type ChildShape = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

const flattenElements = (node: unknown): ChildShape[] => {
  if (node === null || node === undefined || typeof node !== "object") {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((child) => flattenElements(child));
  }

  const element = node as ChildShape;
  const here = element.type !== undefined ? [element] : [];

  return [...here, ...flattenElements(element.props?.children)];
};

const findByAriaLabel = (element: ReactElement, label: string): ChildShape => {
  const match = flattenElements(element).find(
    (child) => child.props?.["aria-label"] === label,
  );

  if (match === undefined) {
    throw new Error(`Expected an element with aria-label "${label}".`);
  }

  return match;
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

// Extracts the `<dl class="xb-judge-scores">…</dl>` block so row assertions are
// scoped to the scores list and never accidentally match the summary or
// critique sections elsewhere on the panel.
const scoresList = (html: string): string => {
  const inner = html.match(/<dl class="xb-judge-scores">([\s\S]*?)<\/dl>/)?.[1];

  if (inner === undefined) {
    throw new Error("Expected an xb-judge-scores <dl> in the rendered panel.");
  }

  return inner;
};

// Every score row labels itself with a single <dt>; counting them is the
// stable "how many rows" contract independent of each row's inner markup.
const countRows = (html: string): number =>
  (scoresList(html).match(/<dt[\s>]/g) ?? []).length;

describe("JudgePanel score dimensions", () => {
  it("renders all thirteen scoring dimensions, leaving the eight legacy rows unchanged", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({ audienceMatch: 72, replyVsQuoteOrientation: 80 }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );

    // Eight legacy + five behavioral dimensions = thirteen rows in the list.
    expect(countRows(html)).toBe(13);

    // The eight legacy rows still render with their original labels and values.
    const scores = scoresList(html);
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
      expect(scores).toContain(label);
    }
    expect(scores).toContain("78");
    expect(scores).toContain("10");
  });

  it("renders the three new numeric behavioral dimensions like the existing numeric rows, with their values", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({
            answerEffort: 55,
            strangerAnswerability: 48,
            statusDependency: 30,
            audienceMatch: 72,
            replyVsQuoteOrientation: 80,
          }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );

    const scores = scoresList(html);
    expect(scores).toContain("Answer effort");
    expect(scores).toContain("55");
    expect(scores).toContain("Stranger answerability");
    expect(scores).toContain("48");
    expect(scores).toContain("Status dependency");
    expect(scores).toContain("30");
  });

  it("renders the new behavioral dimensions at the 0 and 100 boundaries", () => {
    const lowHtml = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({
            answerEffort: 0,
            strangerAnswerability: 0,
            statusDependency: 0,
            audienceMatch: 0,
            replyVsQuoteOrientation: 0,
          }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );
    const highHtml = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({
            answerEffort: 100,
            strangerAnswerability: 100,
            statusDependency: 100,
            audienceMatch: 100,
            replyVsQuoteOrientation: 100,
          }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );

    // Both boundary verdicts still render the full thirteen-row list.
    expect(countRows(lowHtml)).toBe(13);
    expect(countRows(highHtml)).toBe(13);
    // A 0 must render as the value, not be dropped as falsy.
    expect(scoresList(lowHtml)).toContain("Answer effort");
    expect(scoresList(lowHtml)).toContain("0");
    expect(scoresList(highHtml)).toContain("100");
  });
});

describe("JudgePanel audience-match row", () => {
  it("renders a numeric audience-match score as a normal row", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({ audienceMatch: 72 }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );

    const scores = scoresList(html);
    expect(scores).toContain("Audience match");
    expect(scores).toContain("72");
    // A scored audience-match never shows the missing-profile recovery copy.
    expect(scores).not.toContain("Needs account profile");
    expect(scores).not.toContain("Add account profile");
  });

  it("renders the missing-profile recovery copy and an uncertain value when audience-match is null", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({ audienceMatch: null }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );

    const scores = scoresList(html);
    // Null audience-match reads as a recovery prompt, not a number.
    expect(scores).toContain("Audience match");
    expect(scores).toContain("Needs account profile");
    // The uncertain value is styled with the --text-uncertain token, applied via
    // the codebase's "uncertain" class signal (cf. xb-badge--uncertain).
    expect(scores).toMatch(/class="[^"]*uncertain/);
  });

  it("offers an Add-account-profile ghost button wired to onOpenSettings when audience-match is null", () => {
    const onOpenSettings = vi.fn();
    // Invoke the component (cf. foundation.test.tsx Switch({…})) so the returned
    // host tree's props.children is traversable; a non-invoked JSX element keeps
    // its children unrendered and findByAriaLabel could never reach the button.
    const element = JudgePanel({
      judge: {
        status: "ready",
        verdict: buildVerdict({ audienceMatch: null }),
        model: "claude-cli",
      },
      onJudge: () => {},
      onOpenSettings,
      judgeReady: true,
      draftReady: true,
    });

    // The recovery affordance is an accessible button naming the Settings target.
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Add account profile");
    expect(html).toContain('aria-label="Add account profile in Settings"');

    // It is a ghost-variant Button, and its click handler is the panel's
    // onOpenSettings prop. SSR drops handlers from markup, so wiring is verified
    // by invoking the captured handler on the rendered element tree.
    const button = findByAriaLabel(element, "Add account profile in Settings");
    expect(button.props?.className).toMatch(/xb-button--ghost/);
    const onClick = button.props?.onClick as (() => void) | undefined;
    expect(onClick).toBeTypeOf("function");
    onClick?.();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("does not render the recovery button when audience-match is a number", () => {
    const onOpenSettings = vi.fn();
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({ audienceMatch: 72 }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={onOpenSettings}
        judgeReady
        draftReady
      />,
    );

    expect(html).not.toContain("Add account profile in Settings");
  });
});

describe("JudgePanel reply-vs-quote orientation scale", () => {
  it("renders a display-only labeled pole scale with the value, not a ScoreBar or progressbar", () => {
    const html = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({ replyVsQuoteOrientation: 80 }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );

    const scores = scoresList(html);
    // Poled scale labelled at both ends; the value reads through.
    expect(scores).toContain("Reply-oriented");
    expect(scores).toContain("Quote-oriented");
    expect(scores).toContain("80");
    // Display-only: it must NOT be a ScoreBar/progressbar control.
    expect(scores).not.toContain('role="progressbar"');
    expect(scores).not.toContain("xb-score-bar");
    // It is a numeric pole position, not an enum string like "reply"/"quote".
    expect(scores).not.toMatch(/>(reply|quote)<\/dd>/i);
  });

  it("renders the orientation poles at the fully-quote (0) and fully-reply (100) ends", () => {
    const quoteHtml = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({ replyVsQuoteOrientation: 0 }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );
    const replyHtml = renderToStaticMarkup(
      <JudgePanel
        judge={{
          status: "ready",
          verdict: buildVerdict({ replyVsQuoteOrientation: 100 }),
          model: "claude-cli",
        }}
        onJudge={() => {}}
        onOpenSettings={() => {}}
        judgeReady
        draftReady
      />,
    );

    // 0 = fully quote, 100 = fully reply; both render the labeled poles and the
    // boundary value, and neither degrades into a progressbar.
    expect(scoresList(quoteHtml)).toContain("Quote-oriented");
    expect(scoresList(quoteHtml)).toContain("0");
    expect(scoresList(quoteHtml)).not.toContain('role="progressbar"');
    expect(scoresList(replyHtml)).toContain("Reply-oriented");
    expect(scoresList(replyHtml)).toContain("100");
    expect(scoresList(replyHtml)).not.toContain('role="progressbar"');
  });
});
