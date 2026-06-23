import { describe, expect, it, vi } from "vitest";
import {
  deriveApproved,
  type ApplyJudgeSuggestionsRequest,
  type JudgeAnnotation,
  type JudgeVerdict,
} from "@x-builder/shared";

import { ApplyJudgeSuggestionsService } from "../apply-judge-suggestions-service";
import { type JudgeDraft, type JudgeDraftOutcome } from "../judge-draft-service";
import {
  type StructuredLlmProviderResult,
  type StructuredLlmRequest,
} from "../structured-llm-service";

// ---------------------------------------------------------------------------
// Fakes
//
// The service depends on a JudgeDraft (initial judge + re-judge) and a
// StructuredLlmService (the rewrite step). Both are replaced with in-process
// fakes so the three-step chain runs with zero child processes and a fully
// controlled outcome per step.
// ---------------------------------------------------------------------------

// Build a JudgeVerdict at a given overall score so the verdict band and
// deriveApproved are honest, never a hand-set approved flag. Bands follow the
// shared deriveJudgeVerdict thresholds (>=85 post_now, >=70 slight_rework,
// >=40 major_rework, else do_not_post).
const verdictWithOverall = (
  overall: number,
  overrides: Partial<JudgeVerdict> = {},
): JudgeVerdict => ({
  verdict:
    overall >= 85
      ? "post_now"
      : overall >= 70
        ? "slight_rework"
        : overall >= 40
          ? "major_rework"
          : "do_not_post",
  confidence: "medium",
  scores: {
    overall,
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
  headline: "A controlled verdict for the fake.",
  strengths: ["Concrete claim"],
  improvements: ["Trim the close"],
  annotations: [],
  ...overrides,
});

const judgedOutcome = (verdict: JudgeVerdict): JudgeDraftOutcome => ({
  status: "judged",
  response: {
    status: "judged",
    verdict,
    model: "codex-cli",
    judgedAt: "2026-06-20T12:00:00.000Z",
  },
});

const judgeFailureOutcome = (): JudgeDraftOutcome => ({
  status: "failed",
  retryable: true,
  code: "provider_unavailable",
  message: "judge provider unavailable",
});

// A per-call judge fake: it returns the outcome for the current call index
// (call 0 is the initial judge of the original, call 1 is the re-judge of the
// rewrite), so step 1 and step 3 can carry different scores. Every (text,
// profile) pair the service passes is recorded for inspection.
type JudgeCall = { text: string; accountProfile: string | undefined };

const makeJudgeFake = (outcomes: JudgeDraftOutcome[]) => {
  const calls: JudgeCall[] = [];

  const judgeFn: JudgeDraft["judge"] = async (text, accountProfile) => {
    const index = calls.length;
    calls.push({ text, accountProfile });

    const outcome = outcomes[index];
    if (outcome === undefined) {
      throw new Error(`No judge outcome configured for call index ${index}.`);
    }

    return outcome;
  };

  const judgeSpy = vi.fn(judgeFn);
  // A JudgeDraft is an object with a `judge` method; expose one so the service
  // can be constructed with it, and the spy so call counts stay assertable.
  const judge: JudgeDraft = { judge: judgeSpy };

  return { judge, judgeSpy, calls };
};

// A spy-backed StructuredLlmService fake for the rewrite step. The mock records
// every request (so the rewrite instructions can be inspected) and returns the
// configured result. The fake casts to the concrete StructuredLlmService the
// constructor expects; only generateStructured is exercised by the service.
//
// The service captures rewrittenText from the parsed structured output. The
// fake returns the rewritten string directly as `output` (no real parser runs),
// mirroring how the StructuredLlmService fakes are wired across the suite.
const rewriteSuccessText = (
  rewrittenText: string,
): StructuredLlmProviderResult<string> => ({
  status: "success",
  provider: "codex-cli",
  requestId: "rewrite-req-1",
  output: rewrittenText,
  durationMs: 9,
  completedAt: "2026-06-20T12:00:00.000Z",
});

const rewriteFailed = (): StructuredLlmProviderResult<string> => ({
  status: "failed",
  provider: "codex-cli",
  requestId: "rewrite-req-x",
  code: "request_timeout",
  message: "The rewrite call timed out.",
  retryable: true,
  durationMs: 4,
  completedAt: "2026-06-20T12:00:00.000Z",
});

const makeLlmFake = (result: StructuredLlmProviderResult<unknown>) => {
  const generateStructured = vi.fn(
    async (_request: StructuredLlmRequest<unknown>) => result,
  );

  return {
    generateStructured,
    llm: { generateStructured } as unknown as ConstructorParameters<
      typeof ApplyJudgeSuggestionsService
    >[1],
  };
};

const resolveProvider = () => "codex-cli";
const resolveProfile = async (): Promise<string | undefined> => undefined;

const buildService = (
  judge: JudgeDraft,
  llm: ConstructorParameters<typeof ApplyJudgeSuggestionsService>[1],
  profile: () => Promise<string | undefined> = resolveProfile,
) => new ApplyJudgeSuggestionsService(judge, llm, resolveProvider, profile);

const request = (text: string): ApplyJudgeSuggestionsRequest => ({ text });

describe("ApplyJudgeSuggestionsService", () => {
  it("returns the rewritten text and re-judge verdict when the rewrite scores higher", async () => {
    const originalVerdict = verdictWithOverall(60);
    const rewriteVerdict = verdictWithOverall(75);
    const { judge } = makeJudgeFake([
      judgedOutcome(originalVerdict),
      judgedOutcome(rewriteVerdict),
    ]);
    const { llm } = makeLlmFake(rewriteSuccessText("A sharper rewrite."));
    const service = buildService(judge, llm);

    const result = await service.apply(request("The original draft."));

    expect(result.text).toBe("A sharper rewrite.");
    expect(result.text).not.toBe("The original draft.");
    expect(result.improvedOverOriginal).toBe(true);
    expect(result.approved).toBe(true);
    expect(result.approved).toBe(deriveApproved(rewriteVerdict));
    expect(result.verdict).toEqual(rewriteVerdict);
  });

  it("returns the original text when the rewrite scores equal to the original (never-worse guard)", async () => {
    const originalVerdict = verdictWithOverall(72);
    const rewriteVerdict = verdictWithOverall(72);
    const { judge } = makeJudgeFake([
      judgedOutcome(originalVerdict),
      judgedOutcome(rewriteVerdict),
    ]);
    const { llm } = makeLlmFake(rewriteSuccessText("An equally good rewrite."));
    const service = buildService(judge, llm);

    const result = await service.apply(request("The original draft."));

    expect(result.text).toBe("The original draft.");
    expect(result.improvedOverOriginal).toBe(false);
    expect(result.verdict).toEqual(originalVerdict);
  });

  it("returns the original text when the rewrite scores worse, with approved derived from the original", async () => {
    const originalVerdict = verdictWithOverall(80);
    const rewriteVerdict = verdictWithOverall(65);
    const { judge } = makeJudgeFake([
      judgedOutcome(originalVerdict),
      judgedOutcome(rewriteVerdict),
    ]);
    const { llm } = makeLlmFake(rewriteSuccessText("A weaker rewrite."));
    const service = buildService(judge, llm);

    const result = await service.apply(request("The original draft."));

    expect(result.text).toBe("The original draft.");
    expect(result.improvedOverOriginal).toBe(false);
    expect(result.verdict).toEqual(originalVerdict);
    // Original overall 80 -> slight_rework -> approved true, independent of the
    // weaker rewrite that the guard discarded.
    expect(result.approved).toBe(true);
    expect(result.approved).toBe(deriveApproved(originalVerdict));
  });

  it("rejects when the initial judge fails", async () => {
    const { judge } = makeJudgeFake([judgeFailureOutcome()]);
    const { llm, generateStructured } = makeLlmFake(
      rewriteSuccessText("Unused rewrite."),
    );
    const service = buildService(judge, llm);

    await expect(service.apply(request("The original draft."))).rejects.toThrow();
    // The rewrite step never runs once the initial judge has failed.
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("rejects when the rewrite LLM call fails", async () => {
    const { judge } = makeJudgeFake([
      judgedOutcome(verdictWithOverall(60)),
      judgedOutcome(verdictWithOverall(90)),
    ]);
    const { llm } = makeLlmFake(rewriteFailed());
    const service = buildService(judge, llm);

    await expect(service.apply(request("The original draft."))).rejects.toThrow();
  });

  it("rejects when the re-judge fails", async () => {
    const { judge } = makeJudgeFake([
      judgedOutcome(verdictWithOverall(60)),
      judgeFailureOutcome(),
    ]);
    const { llm } = makeLlmFake(rewriteSuccessText("A rewrite that cannot be re-judged."));
    const service = buildService(judge, llm);

    await expect(service.apply(request("The original draft."))).rejects.toThrow();
  });

  it("feeds every annotation quote and recommendation plus each improvement into the rewrite instructions", async () => {
    const annotations: JudgeAnnotation[] = [
      {
        quote: "guaranteed results in thirty days",
        severity: "warning",
        recommendation: "remove the unsupported absolute",
      },
      {
        quote: "no effort needed",
        severity: "suggestion",
        recommendation: "set a realistic expectation",
      },
    ];
    const improvements = ["Trim the middle paragraph", "Sharpen the opening line"];
    const originalVerdict = verdictWithOverall(60, { annotations, improvements });
    const { judge } = makeJudgeFake([
      judgedOutcome(originalVerdict),
      judgedOutcome(verdictWithOverall(80)),
    ]);
    const { llm, generateStructured } = makeLlmFake(
      rewriteSuccessText("A rewrite that applies every fix."),
    );
    const service = buildService(judge, llm);

    await service.apply(request("guaranteed results in thirty days, no effort needed"));

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const rewriteRequest = generateStructured.mock.calls[0]![0];
    expect(rewriteRequest.purpose).toBe("writer_first_pass");

    const { instructions } = rewriteRequest;
    for (const annotation of annotations) {
      expect(instructions).toContain(annotation.quote);
      expect(instructions).toContain(annotation.recommendation);
    }
    for (const improvement of improvements) {
      expect(instructions).toContain(improvement);
    }
  });

  it("passes undefined to the judge and completes the chain when the profile resolver throws", async () => {
    const originalVerdict = verdictWithOverall(60);
    const rewriteVerdict = verdictWithOverall(78);
    const { judge, calls } = makeJudgeFake([
      judgedOutcome(originalVerdict),
      judgedOutcome(rewriteVerdict),
    ]);
    const { llm } = makeLlmFake(rewriteSuccessText("An improved rewrite."));
    const throwingProfile = async (): Promise<string | undefined> => {
      throw new Error("profile resolver exploded");
    };
    const service = buildService(judge, llm, throwingProfile);

    const result = await service.apply(request("The original draft."));

    // The thrown resolver is caught internally: both judge calls receive an
    // undefined profile and the chain still resolves to the improved rewrite.
    expect(result.improvedOverOriginal).toBe(true);
    expect(result.text).toBe("An improved rewrite.");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.accountProfile).toBeUndefined();
    }
  });
});
