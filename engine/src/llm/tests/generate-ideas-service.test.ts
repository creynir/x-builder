import { describe, expect, it, vi } from "vitest";
import {
  deriveApproved,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
  type JudgeVerdict,
} from "@x-builder/shared";

import { GenerateIdeasService, IdeaGenerationError } from "../generate-ideas-service";
import type { GenerationGuidanceResolver } from "../generation-guidance";
import {
  type JudgeDraft,
  type JudgeDraftOptions,
  type JudgeDraftOutcome,
} from "../judge-draft-service";
import {
  structuredLlmOptionLimits,
  type StructuredLlmProviderResult,
  type StructuredLlmRequest,
} from "../structured-llm-service";

// ---------------------------------------------------------------------------
// Fakes
//
// The service depends on a StructuredLlmService (for the generate step) and a
// JudgeDraft (for the per-candidate judge step). Both are replaced with
// in-process fakes so the service is exercised with zero child processes and a
// fully controlled generate/judge outcome.
//
// The generate-step fake is a typed mock function (call-count introspectable)
// so the idea-only path can assert generateStructured was never invoked.
// ---------------------------------------------------------------------------

type GeneratedShape = { candidates: Array<{ id: string; text: string }> };

const generatedCandidates: GeneratedShape = {
  candidates: [
    { id: "cand-0", text: "First angle on the topic." },
    { id: "cand-1", text: "Second angle on the topic." },
    { id: "cand-2", text: "Third angle on the topic." },
  ],
};

// A StructuredLlmService success result carrying a parsed { candidates } output.
const generateSuccess = (
  output: GeneratedShape = generatedCandidates,
): StructuredLlmProviderResult<GeneratedShape> => ({
  status: "success",
  provider: "codex-cli",
  requestId: "gen-req-1",
  output,
  durationMs: 11,
  completedAt: "2026-06-20T12:00:00.000Z",
});

const generateFailed = (): StructuredLlmProviderResult<GeneratedShape> => ({
  status: "failed",
  provider: "codex-cli",
  requestId: "gen-req-x",
  code: "structured_output_invalid",
  message: "The provider returned structured output that did not match the contract.",
  retryable: false,
  durationMs: 4,
  completedAt: "2026-06-20T12:00:00.000Z",
});

// A spy-backed StructuredLlmService fake. The mock records every call so a path
// that must not touch the LLM can assert a call-count of zero. The fake casts to
// the concrete StructuredLlmService the constructor expects; only
// generateStructured is exercised by the service.
const makeLlmFake = (
  result: StructuredLlmProviderResult<GeneratedShape> = generateSuccess(),
) => {
  const generateStructured = vi.fn(
    async (_request: StructuredLlmRequest<unknown>) =>
      result as StructuredLlmProviderResult<unknown>,
  );

  return {
    generateStructured,
    llm: { generateStructured } as unknown as ConstructorParameters<
      typeof GenerateIdeasService
    >[0],
  };
};

// Build a JudgeVerdict at a given overall score so deriveApproved is exercised
// against a real band, not a hand-set approved flag.
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

const judgeFailureOutcome = (code = "provider_unavailable"): JudgeDraftOutcome => ({
  status: "failed",
  retryable: true,
  code,
  message: code === "request_timeout" ? "judge request timed out" : "judge provider unavailable",
});

// A JudgeDraft fake driven by a sequence of outcomes resolved per call in the
// order the service issues judge() calls. Because the service judges in
// parallel via Promise.allSettled, the per-call selection is keyed on the draft
// text rather than invocation order: each generated candidate text maps to a
// fixed outcome, so a per-index failure is deterministic regardless of timing.
const makeJudgeFake = (byText: Map<string, JudgeDraftOutcome>): {
  judge: JudgeDraft["judge"];
  calls: Array<{ text: string; accountProfile?: string; options?: JudgeDraftOptions }>;
} => {
  const calls: Array<{ text: string; accountProfile?: string; options?: JudgeDraftOptions }> = [];
  const judge: JudgeDraft["judge"] = async (text, accountProfile, options) => {
    calls.push({ text, accountProfile, options });
    const outcome = byText.get(text);
    if (outcome === undefined) {
      throw new Error(`No judge outcome configured for text: ${text}`);
    }
    if (outcome.status === "failed") {
      // A failed outcome is a resolved (not rejected) value in the real service;
      // mirror that so Promise.allSettled sees a fulfilled failed outcome.
      return outcome;
    }
    return outcome;
  };

  return { judge, calls };
};

const resolveProvider = () => "codex-cli";
const resolveProfile = async (): Promise<string | undefined> => "An account profile.";

const formatRequest = (
  overrides: Partial<GenerateIdeaRequest> = {},
): GenerateIdeaRequest => ({
  format: "hot_take",
  ...overrides,
});

const guidanceBlockIntro = "Ground your drafts in the following guidance";

const makeGuidanceResolver = (guidance: string | undefined = "Use concrete details.") =>
  vi.fn(async (_request: Parameters<GenerationGuidanceResolver>[0]) => guidance);

const makeAllJudgedFake = (overall = 82) =>
  makeJudgeFake(
    new Map<string, JudgeDraftOutcome>(
      generatedCandidates.candidates.map((candidate) => [
        candidate.text,
        judgedOutcome(verdictWithOverall(overall)),
      ]),
    ),
  );

const createServiceWithGuidance = (
  llm: ConstructorParameters<typeof GenerateIdeasService>[0],
  judge: JudgeDraft,
  resolver: GenerationGuidanceResolver,
  profileResolver: () => Promise<string | undefined> = resolveProfile,
): GenerateIdeasService =>
  new GenerateIdeasService(
    llm,
    judge,
    resolveProvider,
    profileResolver,
    undefined,
    resolver as unknown as ConstructorParameters<typeof GenerateIdeasService>[5],
  );

describe("GenerateIdeasService format path", () => {
  it("calls the generation guidance resolver with the format request fields", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const { judge } = makeAllJudgedFake();
    const resolver = makeGuidanceResolver("Use the known launch story.");

    const service = createServiceWithGuidance(llm, { judge }, resolver);

    await service.generate(
      formatRequest({
        format: "founder_story",
        idea: "Why the launch shipped late",
        voiceProfileId: "voice-alpha",
        useKnownPostIds: ["post-1", "platform-2"],
      }),
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith({
      format: "founder_story",
      idea: "Why the launch shipped late",
      voiceProfileId: "voice-alpha",
      useKnownPostIds: ["post-1", "platform-2"],
    });
  });

  it("defaults omitted known post ids to an empty resolver request array", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const { judge } = makeAllJudgedFake();
    const resolver = makeGuidanceResolver("Use recent originals.");

    const service = createServiceWithGuidance(llm, { judge }, resolver);

    await service.generate(
      formatRequest({
        format: "hot_take",
        idea: "Why default context should be small",
      }),
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith({
      format: "hot_take",
      idea: "Why default context should be small",
      useKnownPostIds: [],
    });
  });

  it("appends non-empty resolver guidance through the structured LLM guidance block", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess());
    const { judge } = makeAllJudgedFake();
    const resolver = makeGuidanceResolver(
      "Use the requested format playbook.\nMirror the author's terse voice.",
    );

    const service = createServiceWithGuidance(llm, { judge }, resolver);

    await service.generate(formatRequest({ format: "hot_take" }));

    const instructions = generateStructured.mock.calls[0]?.[0].instructions;
    expect(instructions).toContain(guidanceBlockIntro);
    expect(instructions).toContain("Use the requested format playbook.");
    expect(instructions).toContain("Mirror the author's terse voice.");
  });

  it("continues without the guidance block when resolver output is blank", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess());
    const { judge } = makeAllJudgedFake();
    const resolver = makeGuidanceResolver("  \n\t  ");

    const service = createServiceWithGuidance(llm, { judge }, resolver);

    const response = (await service.generate(formatRequest())) as GenerateIdeaResponse;

    expect(response.candidates).toHaveLength(3);
    const instructions = generateStructured.mock.calls[0]?.[0].instructions;
    expect(instructions).not.toContain(guidanceBlockIntro);
  });

  it("continues with the base prompt and judges candidates when guidance resolution fails", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess());
    const { judge, calls } = makeAllJudgedFake();
    const resolver = vi.fn(
      async (_request: Parameters<GenerationGuidanceResolver>[0]): Promise<string | undefined> => {
        throw new Error("guidance unavailable");
      },
    );

    const service = createServiceWithGuidance(llm, { judge }, resolver);

    const response = (await service.generate(formatRequest())) as GenerateIdeaResponse;

    expect(response.candidates).toHaveLength(3);
    expect(calls).toHaveLength(3);
    const instructions = generateStructured.mock.calls[0]?.[0].instructions;
    expect(instructions).not.toContain(guidanceBlockIntro);
  });

  it("returns three candidates each carrying verdict and approved when every judge succeeds", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess());
    const verdicts = new Map<string, JudgeVerdict>([
      [generatedCandidates.candidates[0]!.text, verdictWithOverall(90)],
      [generatedCandidates.candidates[1]!.text, verdictWithOverall(78)],
      [generatedCandidates.candidates[2]!.text, verdictWithOverall(55)],
    ]);
    const { judge } = makeJudgeFake(
      new Map(
        [...verdicts].map(([text, verdict]) => [text, judgedOutcome(verdict)]),
      ),
    );

    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);
    const response = (await service.generate(formatRequest())) as GenerateIdeaResponse;

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(response.candidates).toHaveLength(3);

    for (const candidate of response.candidates) {
      expect(candidate).toHaveProperty("verdict");
      expect(candidate).toHaveProperty("approved");
      const expectedVerdict = verdicts.get(candidate.text)!;
      expect(candidate.verdict).toEqual(expectedVerdict);
      expect(candidate.approved).toBe(deriveApproved(expectedVerdict));
    }
  });

  it("caps the writer timeout to the structured LLM per-call maximum", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess());
    const { judge } = makeAllJudgedFake();
    const service = new GenerateIdeasService(
      llm,
      { judge },
      resolveProvider,
      resolveProfile,
      999_000,
    );

    await service.generate(formatRequest());

    const request = generateStructured.mock.calls[0]![0];
    expect(request.options?.timeoutMs).toBe(structuredLlmOptionLimits.timeoutMs);
  });

  it("uses the full small remaining chain budget for the writer timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));

    const { generateStructured, llm } = makeLlmFake(generateSuccess());
    const { judge } = makeAllJudgedFake();
    const service = new GenerateIdeasService(
      llm,
      { judge },
      resolveProvider,
      resolveProfile,
      45_000,
    );

    try {
      await service.generate(formatRequest());

      const request = generateStructured.mock.calls[0]![0];
      expect(request.options?.timeoutMs).toBe(45_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes one capped remaining timeout to all candidate judges", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const { judge, calls } = makeAllJudgedFake();
    const service = new GenerateIdeasService(
      llm,
      { judge },
      resolveProvider,
      resolveProfile,
      999_000,
    );

    await service.generate(formatRequest());

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.options?.timeoutMs)).toEqual([
      structuredLlmOptionLimits.timeoutMs,
      structuredLlmOptionLimits.timeoutMs,
      structuredLlmOptionLimits.timeoutMs,
    ]);
  });

  it("passes the same elapsed remaining timeout below the provider cap to all candidate judges", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));

    const generateStructured = vi.fn(async (_request: StructuredLlmRequest<unknown>) => {
      vi.setSystemTime(new Date("2026-06-20T12:00:30.000Z"));
      return generateSuccess() as StructuredLlmProviderResult<unknown>;
    });
    const llm = { generateStructured } as unknown as ConstructorParameters<
      typeof GenerateIdeasService
    >[0];
    const { judge, calls } = makeAllJudgedFake();
    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile, 90_000);

    try {
      await service.generate(formatRequest());

      expect(calls).toHaveLength(3);
      expect(calls.map((call) => call.options?.timeoutMs)).toEqual([
        60_000,
        60_000,
        60_000,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails the whole format generation when the chain budget is exhausted before judge fan-out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));

    const generateStructured = vi.fn(async (_request: StructuredLlmRequest<unknown>) => {
      vi.setSystemTime(new Date("2026-06-20T12:00:31.000Z"));
      return generateSuccess() as StructuredLlmProviderResult<unknown>;
    });
    const llm = { generateStructured } as unknown as ConstructorParameters<
      typeof GenerateIdeasService
    >[0];
    const { judge, calls } = makeAllJudgedFake();
    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile, 30_000);

    try {
      await expect(service.generate(formatRequest())).rejects.toMatchObject({
        code: "chain_budget_exhausted",
      });
      expect(calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("omits verdict and approved on the candidate whose judge failed while keeping the other two judged", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const [first, second, third] = generatedCandidates.candidates as [
      { id: string; text: string },
      { id: string; text: string },
      { id: string; text: string },
    ];
    const verdict0 = verdictWithOverall(88);
    const verdict2 = verdictWithOverall(72);
    const { judge } = makeJudgeFake(
      new Map<string, JudgeDraftOutcome>([
        [first.text, judgedOutcome(verdict0)],
        [second.text, judgeFailureOutcome()],
        [third.text, judgedOutcome(verdict2)],
      ]),
    );

    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);
    const response = (await service.generate(formatRequest({ format: "founder_story" }))) as GenerateIdeaResponse;

    expect(response.candidates).toHaveLength(3);

    const byText = new Map(response.candidates.map((candidate) => [candidate.text, candidate]));
    const failedCandidate = byText.get(second.text)!;
    expect(failedCandidate).not.toHaveProperty("verdict");
    expect(failedCandidate).not.toHaveProperty("approved");

    const judgedFirst = byText.get(first.text)!;
    expect(judgedFirst).toHaveProperty("verdict");
    expect(judgedFirst).toHaveProperty("approved");
    expect(judgedFirst.verdict).toEqual(verdict0);
    expect(judgedFirst.approved).toBe(deriveApproved(verdict0));

    const judgedThird = byText.get(third.text)!;
    expect(judgedThird).toHaveProperty("verdict");
    expect(judgedThird).toHaveProperty("approved");
    expect(judgedThird.verdict).toEqual(verdict2);
    expect(judgedThird.approved).toBe(deriveApproved(verdict2));
  });

  it("fails the whole format generation when a candidate judge times out", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const [first, second, third] = generatedCandidates.candidates as [
      { id: string; text: string },
      { id: string; text: string },
      { id: string; text: string },
    ];
    const { judge } = makeJudgeFake(
      new Map<string, JudgeDraftOutcome>([
        [first.text, judgedOutcome(verdictWithOverall(88))],
        [second.text, judgeFailureOutcome("request_timeout")],
        [third.text, judgedOutcome(verdictWithOverall(72))],
      ]),
    );

    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);

    await expect(service.generate(formatRequest())).rejects.toMatchObject({
      code: "request_timeout",
    });
  });

  it("fails the whole format generation when a candidate judge reports exhausted chain budget", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const [first, second, third] = generatedCandidates.candidates as [
      { id: string; text: string },
      { id: string; text: string },
      { id: string; text: string },
    ];
    const { judge } = makeJudgeFake(
      new Map<string, JudgeDraftOutcome>([
        [first.text, judgedOutcome(verdictWithOverall(88))],
        [second.text, judgeFailureOutcome("chain_budget_exhausted")],
        [third.text, judgedOutcome(verdictWithOverall(72))],
      ]),
    );

    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);

    await expect(service.generate(formatRequest())).rejects.toMatchObject({
      code: "chain_budget_exhausted",
    });
  });

  it("preserves the typed generate failure path even when guidance resolves", async () => {
    const { generateStructured, llm } = makeLlmFake(generateFailed());
    const { judge, calls } = makeJudgeFake(new Map());
    const resolver = makeGuidanceResolver("Use the compact guidance.");

    const service = createServiceWithGuidance(llm, { judge }, resolver);

    let thrown: unknown;
    try {
      await service.generate(formatRequest());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IdeaGenerationError);
    expect(thrown).toMatchObject({ code: "structured_output_invalid" });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledTimes(1);
    // A generate failure never reaches the judge step.
    expect(calls).toHaveLength(0);
  });

  it("returns three candidates with neither verdict nor approved when all three judges fail", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const { judge } = makeJudgeFake(
      new Map<string, JudgeDraftOutcome>(
        generatedCandidates.candidates.map((candidate) => [
          candidate.text,
          judgeFailureOutcome(),
        ]),
      ),
    );

    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);
    const response = (await service.generate(formatRequest())) as GenerateIdeaResponse;

    expect(response.candidates).toHaveLength(3);
    for (const candidate of response.candidates) {
      expect(candidate).not.toHaveProperty("verdict");
      expect(candidate).not.toHaveProperty("approved");
    }
  });

  it("judges candidates with an undefined profile and still attaches verdicts when the profile resolver throws", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const { judge, calls } = makeJudgeFake(
      new Map<string, JudgeDraftOutcome>(
        generatedCandidates.candidates.map((candidate) => [
          candidate.text,
          judgedOutcome(verdictWithOverall(82)),
        ]),
      ),
    );
    const throwingProfile = async (): Promise<string | undefined> => {
      throw new Error("profile resolution failed");
    };

    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, throwingProfile);
    const response = (await service.generate(formatRequest())) as GenerateIdeaResponse;

    expect(response.candidates).toHaveLength(3);
    // The judge was still invoked for every candidate, with an undefined profile.
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.accountProfile).toBeUndefined();
    }
    // A thrown profile resolver does not fail the candidates; verdicts are present.
    for (const candidate of response.candidates) {
      expect(candidate).toHaveProperty("verdict");
      expect(candidate).toHaveProperty("approved");
    }
  });

  it("computes approved consistent with the verdict band on every candidate", async () => {
    const { llm } = makeLlmFake(generateSuccess());
    const [first, second, third] = generatedCandidates.candidates as [
      { id: string; text: string },
      { id: string; text: string },
      { id: string; text: string },
    ];
    // One verdict per band: post_now and slight_rework approve; major_rework and
    // do_not_post do not. Three candidates cover three of the four bands; the
    // fourth band is exercised directly on deriveApproved below.
    const postNow = verdictWithOverall(90);
    const slightRework = verdictWithOverall(75);
    const doNotPost = verdictWithOverall(20);
    const { judge } = makeJudgeFake(
      new Map<string, JudgeDraftOutcome>([
        [first.text, judgedOutcome(postNow)],
        [second.text, judgedOutcome(slightRework)],
        [third.text, judgedOutcome(doNotPost)],
      ]),
    );

    const service = new GenerateIdeasService(llm, { judge }, resolveProvider, resolveProfile);
    const response = (await service.generate(formatRequest())) as GenerateIdeaResponse;

    const byText = new Map(response.candidates.map((candidate) => [candidate.text, candidate]));
    expect(byText.get(first.text)!.approved).toBe(true);
    expect(byText.get(second.text)!.approved).toBe(true);
    expect(byText.get(third.text)!.approved).toBe(false);

    // Band agreement: deriveApproved and the verdict label never disagree.
    expect(byText.get(first.text)!.approved).toBe(deriveApproved(postNow));
    expect(byText.get(second.text)!.approved).toBe(deriveApproved(slightRework));
    expect(byText.get(third.text)!.approved).toBe(deriveApproved(doNotPost));
    expect(deriveApproved(verdictWithOverall(50))).toBe(false);
  });
});

describe("GenerateIdeasService idea-only path", () => {
  it("never calls guidance, the structured LLM, or judge and returns the stub-shaped candidates without verdict or approved", async () => {
    const { generateStructured, llm } = makeLlmFake(generateSuccess());
    const judge = vi.fn(async () => judgedOutcome(verdictWithOverall(90)));
    const externalPatternProvider = vi.fn(
      async (_request: Parameters<GenerationGuidanceResolver>[0]) => [],
    );
    const resolver = vi.fn(async (request: Parameters<GenerationGuidanceResolver>[0]) => {
      await externalPatternProvider(request);
      return "Should not be read for idea-only generation.";
    });

    const service = createServiceWithGuidance(llm, { judge }, resolver);
    const response = (await service.generate({
      idea: "Why the best code is invisible",
    })) as GenerateIdeaResponse;

    // The idea-only branch must not touch guidance, the generate step, or the judge step.
    expect(resolver).toHaveBeenCalledTimes(0);
    expect(externalPatternProvider).toHaveBeenCalledTimes(0);
    expect(generateStructured).toHaveBeenCalledTimes(0);
    expect(judge).toHaveBeenCalledTimes(0);

    // Stub shape: exactly three candidates with the deterministic stub formats and
    // no judge-derived fields.
    expect(response.candidates).toHaveLength(3);
    expect(response.candidates.map((candidate) => candidate.format)).toEqual([
      "one-liner",
      "mini-framework",
      "debate-question",
    ]);
    for (const candidate of response.candidates) {
      expect(candidate).not.toHaveProperty("verdict");
      expect(candidate).not.toHaveProperty("approved");
    }
  });
});
