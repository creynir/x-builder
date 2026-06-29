import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  type ApplyJudgeSuggestionsRequest,
  type GenerateIdeaRequest,
  type JudgeVerdict,
  type ReplyComposerContext,
} from "@x-builder/shared";

import { ApplyJudgeSuggestionsService } from "../apply-judge-suggestions-service";
import { GenerateIdeasService } from "../generate-ideas-service";
import {
  JudgeDraftService,
  type JudgeDraft,
  type JudgeDraftOptions,
  type JudgeDraftOutcome,
} from "../judge-draft-service";
import type {
  StructuredLlmProviderResult,
  StructuredLlmRequest,
} from "../structured-llm-service";

const scores = {
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
};

const replyContext: ReplyComposerContext = {
  source: "same_dialog_dom",
  targetAuthorHandle: "alice",
  targetDisplayName: "Alice Example",
  targetText: "Ship the boring version first. The clever version rarely survives contact.",
  targetStatusId: "1930000000000000001",
  targetUrl: "https://x.com/alice/status/1930000000000000001",
  leadingTargetHandle: {
    handle: "alice",
    state: "present",
  },
};

const verdictWithOverall = (overall: number): JudgeVerdict => ({
  verdict:
    overall >= 85
      ? "post_now"
      : overall >= 70
        ? "slight_rework"
        : overall >= 40
          ? "major_rework"
          : "do_not_post",
  confidence: "medium",
  scores: { ...scores, overall },
  headline: "A controlled verdict for the fake.",
  strengths: ["Concrete claim"],
  improvements: ["Trim the close"],
  annotations: [],
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

const judgeSuccessResult: StructuredLlmProviderResult<JudgeVerdict> = {
  status: "success",
  provider: "codex-cli",
  requestId: "judge-req-1",
  output: verdictWithOverall(78),
  durationMs: 12,
  completedAt: "2026-06-20T12:00:00.000Z",
};

const generatedCandidates = {
  candidates: [
    { id: "cand-0", text: "First angle on the topic." },
    { id: "cand-1", text: "Second angle on the topic." },
    { id: "cand-2", text: "Third angle on the topic." },
  ],
};

type GeneratedShape = typeof generatedCandidates;

const generateSuccess: StructuredLlmProviderResult<GeneratedShape> = {
  status: "success",
  provider: "codex-cli",
  requestId: "gen-req-1",
  output: generatedCandidates,
  durationMs: 11,
  completedAt: "2026-06-20T12:00:00.000Z",
};

const rewriteSuccessText = (rewrittenText: string): StructuredLlmProviderResult<string> => ({
  status: "success",
  provider: "codex-cli",
  requestId: "rewrite-req-1",
  output: rewrittenText,
  durationMs: 9,
  completedAt: "2026-06-20T12:00:00.000Z",
});

const makeLlmFake = <T>(result: StructuredLlmProviderResult<T>) => {
  const generateStructured = vi.fn(
    async (_request: StructuredLlmRequest<unknown>) =>
      result as StructuredLlmProviderResult<unknown>,
  );
  return { generateStructured, llm: { generateStructured } as never };
};

type JudgeCall = {
  text: string;
  accountProfile: string | undefined;
  options: JudgeDraftOptions | undefined;
};

const makeJudgeByTextFake = () => {
  const calls: JudgeCall[] = [];
  const judge: JudgeDraft["judge"] = async (text, accountProfile, options) => {
    calls.push({ text, accountProfile, options });
    return judgedOutcome(verdictWithOverall(78));
  };
  return { judge, calls };
};

const makeJudgeSequenceFake = (outcomes: JudgeDraftOutcome[]) => {
  const calls: JudgeCall[] = [];
  const judgeFn: JudgeDraft["judge"] = async (text, accountProfile, options) => {
    const outcome = outcomes[calls.length];
    calls.push({ text, accountProfile, options });
    if (outcome === undefined) {
      throw new Error("No judge outcome configured.");
    }
    return outcome;
  };
  return { judge: { judge: vi.fn(judgeFn) } satisfies JudgeDraft, calls };
};

const resolveProvider = () => "codex-cli";
const resolveProfile = async (): Promise<string | undefined> => undefined;

const serializePrompt = (request: StructuredLlmRequest<unknown>): string =>
  JSON.stringify({ instructions: request.instructions, turns: request.turns });

describe("reply-aware judge consumers", () => {
  it("extends JudgeDraftOptions with optional replyContext", () => {
    expectTypeOf<JudgeDraftOptions>().toEqualTypeOf<{
      timeoutMs?: number;
      replyContext?: ReplyComposerContext;
    }>();
  });

  it("adds reply framing and untrusted target context to judge prompts", async () => {
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return judgeSuccessResult;
      },
    });

    await service.judge("good point", undefined, { replyContext });

    const prompt = serializePrompt(captured[0]!);
    expect(prompt).toContain("reply");
    expect(prompt).toContain("@alice");
    expect(prompt).toContain(replyContext.targetText);
    expect(prompt.toLowerCase()).toContain("untrusted");
    expect(prompt.toLowerCase()).toContain("structural");
    expect(prompt).toContain("good point");
  });
});

describe("reply-aware generation consumers", () => {
  it("adds reply framing to format generation and passes replyContext into candidate judges", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess);
    const { judge, calls } = makeJudgeByTextFake();
    const service = new GenerateIdeasService(
      llm,
      { judge },
      resolveProvider,
      async () => "An account profile.",
    );

    await service.generate({ format: "hot_take", replyContext } satisfies GenerateIdeaRequest);

    const request = generateStructured.mock.calls[0]![0];
    const prompt = serializePrompt(request);
    expect(prompt).toContain("reply");
    expect(prompt).toContain("@alice");
    expect(prompt).toContain(replyContext.targetText);
    expect(prompt.toLowerCase()).toContain("untrusted");
    expect(prompt.toLowerCase()).toContain("without the structural");

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect((call.options as { replyContext?: ReplyComposerContext } | undefined)?.replyContext)
        .toEqual(replyContext);
    }
  });

  it("normalizes generated reply candidates to authored bodies before judging and returning", async () => {
    const duplicateHandleResult: StructuredLlmProviderResult<GeneratedShape> = {
      ...generateSuccess,
      output: {
        candidates: [
          { id: "cand-0", text: "@alice agree with this" },
          { id: "cand-1", text: "second body" },
          { id: "cand-2", text: "third body" },
        ],
      },
    };
    const { llm } = makeLlmFake(duplicateHandleResult);
    const { judge, calls } = makeJudgeByTextFake();
    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);

    const response = await service.generate({
      format: "hot_take",
      replyContext,
    } satisfies GenerateIdeaRequest);

    expect(calls.map((call) => call.text)).toEqual([
      "agree with this",
      "second body",
      "third body",
    ]);
    expect(response.candidates.map((candidate) => candidate.text)).toEqual([
      "agree with this",
      "second body",
      "third body",
    ]);
  });

  it("rejects generated prefix-only reply candidates before judging", async () => {
    const prefixOnlyResult: StructuredLlmProviderResult<GeneratedShape> = {
      ...generateSuccess,
      output: {
        candidates: [
          { id: "cand-0", text: "@alice" },
          { id: "cand-1", text: "second body" },
          { id: "cand-2", text: "third body" },
        ],
      },
    };
    const { llm } = makeLlmFake(prefixOnlyResult);
    const judge = vi.fn(async () => judgedOutcome(verdictWithOverall(90)));
    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);

    await expect(
      service.generate({ format: "hot_take", replyContext } satisfies GenerateIdeaRequest),
    ).rejects.toMatchObject({ code: "structured_output_invalid" });
    expect(judge).not.toHaveBeenCalled();
  });

  it("keeps idea-only generation deterministic even when replyContext is supplied", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess);
    const judge = vi.fn(async () => judgedOutcome(verdictWithOverall(90)));
    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);

    const response = await service.generate({
      idea: "Why the best code is invisible",
      replyContext,
    } satisfies GenerateIdeaRequest);

    expect(generateStructured).toHaveBeenCalledTimes(0);
    expect(judge).toHaveBeenCalledTimes(0);
    expect(response.candidates.map((candidate) => candidate.text)).toEqual([
      "Why the best code is invisible",
      "Why the best code is invisible\n\n1. Name the constraint.\n2. Show the tradeoff.\n3. Make the decision.",
      "Why the best code is invisible\n\nWhat would change your mind?",
    ]);
  });
});

describe("reply-aware apply suggestions consumer", () => {
  it("propagates replyContext through original judge, rewrite prompt, and re-judge while returning body-only text", async () => {
    const { judge, calls } = makeJudgeSequenceFake([
      judgedOutcome(verdictWithOverall(60)),
      judgedOutcome(verdictWithOverall(82)),
    ]);
    const { generateStructured, llm } = makeLlmFake(rewriteSuccessText("@alice sharper body"));
    const service = new ApplyJudgeSuggestionsService(judge, llm, resolveProvider, resolveProfile);

    const result = await service.apply({
      text: "good point",
      replyContext,
    } satisfies ApplyJudgeSuggestionsRequest);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toBe("good point");
    expect(calls[1]?.text).toBe("sharper body");
    for (const call of calls) {
      expect((call.options as { replyContext?: ReplyComposerContext } | undefined)?.replyContext)
        .toEqual(replyContext);
    }

    const rewriteRequest = generateStructured.mock.calls[0]![0];
    const prompt = serializePrompt(rewriteRequest);
    expect(prompt).toContain("reply");
    expect(prompt).toContain("@alice");
    expect(prompt).toContain(replyContext.targetText);
    expect(prompt.toLowerCase()).toContain("untrusted");
    expect(prompt.toLowerCase()).toContain("structural");
    expect(prompt).toContain("good point");

    expect(result.text).toBe("sharper body");
    expect(result.improvedOverOriginal).toBe(true);
  });
});
