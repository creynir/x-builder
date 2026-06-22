import { describe, expect, it, vi } from "vitest";
import { judgeVerdictSchema, type JudgeVerdict } from "@x-builder/shared";

import { JudgeDraftService } from "../judge-draft-service";
import {
  StructuredLlmService,
  type StructuredLlmProviderResult,
  type StructuredLlmRequest,
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

const verdict: JudgeVerdict = {
  verdict: "slight_rework",
  confidence: "medium",
  scores,
  headline: "Strong, specific, reply-friendly.",
  strengths: ["Concrete claim up front"],
  improvements: ["Trim the middle paragraph"],
  annotations: [],
};

const successResult: StructuredLlmProviderResult<JudgeVerdict> = {
  status: "success",
  provider: "codex-cli",
  requestId: "req-1",
  output: verdict,
  durationMs: 12,
  completedAt: "2026-06-10T12:00:00.000Z",
};

const failure = (
  code: string,
  retryable: boolean,
): StructuredLlmProviderResult<JudgeVerdict> => ({
  status: "failed",
  provider: "codex-cli",
  requestId: "req-x",
  code,
  message: "codex unavailable: /Users/secret/path",
  retryable,
  durationMs: 5,
  completedAt: "2026-06-10T12:00:00.000Z",
});

describe("JudgeDraftService", () => {
  it("builds a candidate_judge request and maps a success result to a judged response", async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredLlmRequest<JudgeVerdict>) => successResult,
    );
    const service = new JudgeDraftService({ generateStructured });

    const outcome = await service.judge("My draft worth judging.");

    expect(outcome).toEqual({
      status: "judged",
      response: {
        status: "judged",
        verdict,
        model: "codex-cli",
        judgedAt: "2026-06-10T12:00:00.000Z",
      },
    });

    const request = generateStructured.mock.calls[0]![0];
    expect(request.provider).toBe("codex-cli");
    expect(request.purpose).toBe("candidate_judge");
    expect(request.turns.find((turn) => turn.role === "user")?.content).toContain(
      "My draft worth judging.",
    );
    expect(request.options?.timeoutMs).toBe(180_000);
  });

  it("requires additionalProperties false on every object in the judge output schema for strict structured-output providers", async () => {
    // Strict structured-output providers (codex 0.139 / gpt-5.5 routing
    // --output-schema through OpenAI structured output) reject any object node
    // that does not set "additionalProperties": false with HTTP 400
    // ("'additionalProperties' is required to be supplied and to be false").
    // The schema is module-private, so capture it from the request the service
    // builds through the injected fake gateway.
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });

    await service.judge("draft");

    const schema = captured[0]!.structuredOutput.schema;

    // Pin the two known object nodes explicitly so the contract is legible.
    expect(schema.additionalProperties).toBe(false);
    const scoresNode = (schema.properties as Record<string, unknown>).scores as
      | Record<string, unknown>
      | undefined;
    expect(scoresNode?.additionalProperties).toBe(false);

    // Falsifiable, future-proof guard: EVERY object node anywhere in the schema
    // must set additionalProperties:false, so any object node added later
    // without it also turns this red.
    const objectNodesMissingFlag = (node: unknown, path: string): string[] => {
      if (Array.isArray(node)) {
        return node.flatMap((child, index) =>
          objectNodesMissingFlag(child, `${path}[${index}]`),
        );
      }
      if (node === null || typeof node !== "object") {
        return [];
      }
      const record = node as Record<string, unknown>;
      const offenders: string[] = [];
      if (record.type === "object" && record.additionalProperties !== false) {
        offenders.push(path);
      }
      for (const [key, value] of Object.entries(record)) {
        offenders.push(...objectNodesMissingFlag(value, `${path}.${key}`));
      }
      return offenders;
    };

    expect(objectNodesMissingFlag(schema, "schema")).toEqual([]);
  });

  it("derives the verdict band from overall in the structured-output parser", async () => {
    // The parser receives the model output (no verdict field) and derives the
    // verdict from scores.overall, so the verdict can never disagree with the score.
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });

    await service.judge("draft");

    const parse = captured[0]!.structuredOutput.parser;
    const modelOutput = {
      confidence: "medium",
      scores: { ...scores, overall: 90 },
      headline: "Strong.",
      strengths: ["clear"],
      improvements: ["trim"],
    };

    expect(parse(modelOutput).verdict).toBe("post_now");
    expect(parse({ ...modelOutput, scores: { ...scores, overall: 78 } }).verdict).toBe("slight_rework");
    expect(parse({ ...modelOutput, scores: { ...scores, overall: 55 } }).verdict).toBe("major_rework");
    expect(parse({ ...modelOutput, scores: { ...scores, overall: 30 } }).verdict).toBe("do_not_post");
    // A model-supplied verdict must be ignored; the derived band wins.
    expect(
      parse({ ...modelOutput, verdict: "post_now", scores: { ...scores, overall: 30 } }).verdict,
    ).toBe("do_not_post");
    expect(() => parse({ ...modelOutput, scores: { ...scores, replies: 999 } })).toThrow();
  });

  it("maps a retryable provider failure to a failed outcome", async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredLlmRequest<JudgeVerdict>) => failure("provider_unavailable", true),
    );
    const service = new JudgeDraftService({ generateStructured });

    const outcome = await service.judge("draft");

    expect(outcome).toEqual({
      status: "failed",
      retryable: true,
      code: "provider_unavailable",
      message: "codex unavailable: /Users/secret/path",
    });
  });

  it("preserves a non-retryable failure such as structured_output_invalid", async () => {
    const generateStructured = vi.fn(
      async (_request: StructuredLlmRequest<JudgeVerdict>) =>
        failure("structured_output_invalid", false),
    );
    const service = new JudgeDraftService({ generateStructured });

    const outcome = await service.judge("draft");

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.retryable).toBe(false);
      expect(outcome.code).toBe("structured_output_invalid");
    }
  });

  it("returns a non-retryable provider_unconfigured failure when no provider is registered", async () => {
    const service = new JudgeDraftService(new StructuredLlmService({ providers: [] }));

    const outcome = await service.judge("draft");

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.retryable).toBe(false);
      expect(outcome.code).toBe("provider_unconfigured");
    }
  });

  it("resolves the provider id from a resolver function per call", async () => {
    const generateStructured = vi.fn(
      async (request: StructuredLlmRequest<JudgeVerdict>) => ({
        ...successResult,
        provider: request.provider,
      }),
    );
    const resolveProvider = vi.fn(() => "claude-cli");
    const service = new JudgeDraftService({ generateStructured }, resolveProvider);

    const outcome = await service.judge("My draft worth judging.");

    expect(resolveProvider).toHaveBeenCalledOnce();
    expect(generateStructured.mock.calls[0]![0].provider).toBe("claude-cli");
    expect(outcome).toMatchObject({
      status: "judged",
      response: { model: "claude-cli" },
    });
  });

  it("re-runs an async resolver function on every judge call (no caching)", async () => {
    const generateStructured = vi.fn(
      async (request: StructuredLlmRequest<JudgeVerdict>) => ({
        ...successResult,
        provider: request.provider,
      }),
    );
    const providers = ["codex-cli", "cursor-cli"];
    const resolveProvider = vi.fn(async () => providers.shift() ?? "codex-cli");
    const service = new JudgeDraftService({ generateStructured }, resolveProvider);

    await service.judge("first draft");
    await service.judge("second draft");

    expect(resolveProvider).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[0]![0].provider).toBe("codex-cli");
    expect(generateStructured.mock.calls[1]![0].provider).toBe("cursor-cli");
  });
});

// The serialized prompt the model sees: instructions, every turn's content, and
// any metadata flattened to one string. Used to assert that an account profile
// reaches the envelope without pinning which field carries it.
const serializeRequestPrompt = (request: StructuredLlmRequest<JudgeVerdict>): string =>
  JSON.stringify({
    instructions: request.instructions,
    turns: request.turns,
    metadata: request.metadata ?? null,
  });

describe("JudgeDraftService account profile and rubric", () => {
  it("passes a supplied account profile into the structured-prompt envelope", async () => {
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });

    const accountProfile = "Indie hacker shipping a local-first writing tool for founders.";
    await service.judge("A draft worth judging.", accountProfile);

    expect(serializeRequestPrompt(captured[0]!)).toContain(accountProfile);
  });

  it("does not leak an account profile into the envelope when none is provided", async () => {
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });

    await service.judge("A draft worth judging.");

    expect(serializeRequestPrompt(captured[0]!)).not.toContain("Indie hacker shipping");
  });

  it("describes the five new dimensions in the judge instructions and output schema", async () => {
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });

    await service.judge("draft");

    const request = captured[0]!;
    const newDimensions = [
      "answerEffort",
      "strangerAnswerability",
      "statusDependency",
      "replyVsQuoteOrientation",
      "audienceMatch",
    ];

    // The output schema the provider receives must require all thirteen scores.
    const scoresNode = (
      (request.structuredOutput.schema.properties as Record<string, unknown>).scores as Record<
        string,
        unknown
      >
    );
    const scoreProperties = scoresNode.properties as Record<string, unknown>;
    for (const dimension of newDimensions) {
      expect(scoreProperties).toHaveProperty(dimension);
    }
    expect(scoresNode.required).toEqual(expect.arrayContaining(newDimensions));

    // The instructions must brief the model on the new dimensions and on the
    // null-audienceMatch rule when no profile is present.
    for (const dimension of newDimensions) {
      expect(request.instructions).toContain(dimension);
    }
    expect(request.instructions).toContain("null");
  });

  it("instructs a null audienceMatch when judging without an account profile", async () => {
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });

    await service.judge("draft");

    // audienceMatch is required on the wire and explicitly nullable: the schema
    // the provider receives must carry it as a score property.
    const request = captured[0]!;
    const scoresNode = (request.structuredOutput.schema.properties as Record<string, unknown>)
      .scores as Record<string, unknown>;
    const scoreProperties = scoresNode.properties as Record<string, unknown>;
    expect(scoreProperties).toHaveProperty("audienceMatch");
    expect((scoresNode.required as string[]) ?? []).toContain("audienceMatch");
  });

  it("validates the thirteen-dimension gateway output through the verdict schema", async () => {
    // A success result already carries the full thirteen-dim verdict fixture; the
    // service must surface it unchanged (proving it does not strip the new dims).
    const generateStructured = vi.fn(
      async (_request: StructuredLlmRequest<JudgeVerdict>) => successResult,
    );
    const service = new JudgeDraftService({ generateStructured });

    const outcome = await service.judge("A draft worth judging.");

    expect(outcome.status).toBe("judged");
    if (outcome.status !== "judged") {
      throw new Error("Expected a judged outcome.");
    }
    expect(outcome.response.verdict.scores).toMatchObject({
      answerEffort: 55,
      strangerAnswerability: 48,
      statusDependency: 30,
      replyVsQuoteOrientation: 62,
      audienceMatch: null,
    });
  });
});

// Span-level annotations. The model emits a `quote` (verbatim substring),
// a `severity`, and a one-line `recommendation`; the service threads these through
// the structured-output parser into verdict.annotations alongside the aggregate
// scores. The model output never carries a `verdict` key (omit({ verdict })) and
// the annotations field is optional at the model layer, defaulted at the Zod layer.
describe("JudgeDraftService span annotations", () => {
  // A model output as the provider returns it: every verdict field except the
  // derived `verdict` band. annotations is appended per-test.
  const modelOutput = {
    confidence: "medium" as const,
    scores: { ...scores },
    headline: "Strong, specific, reply-friendly.",
    strengths: ["Concrete claim up front"],
    improvements: ["Trim the middle paragraph"],
  };

  // Capture the structured-output parser the service hands the provider; this IS
  // toVerdict (the production parse path), so parsing model output through it
  // exercises judgeModelOutputSchema + the verdict-band derivation exactly as the
  // real StructuredLlmService.parseProviderOutput does.
  const captureParser = async () => {
    const captured: StructuredLlmRequest<JudgeVerdict>[] = [];
    const service = new JudgeDraftService({
      generateStructured: async (request) => {
        captured.push(request);
        return successResult;
      },
    });
    await service.judge("guaranteed results in thirty days, no effort needed");
    return captured[0]!;
  };

  it("threads model-emitted annotations through into verdict.annotations", async () => {
    const request = await captureParser();

    const verdict = request.structuredOutput.parser({
      ...modelOutput,
      annotations: [
        { quote: "exact phrase", severity: "warning", recommendation: "be more specific" },
      ],
    });

    expect(verdict.annotations).toHaveLength(1);
    expect(verdict.annotations[0]!.quote).toBe("exact phrase");
    expect(verdict.annotations[0]!.severity).toBe("warning");
    expect(verdict.annotations[0]!.recommendation).toBeTruthy();
    expect(verdict.annotations[0]!.recommendation.length).toBeGreaterThan(0);
  });

  it("defaults verdict.annotations to [] when the model omits the field", async () => {
    const request = await captureParser();

    // modelOutput has no `annotations` key at all.
    const verdict = request.structuredOutput.parser({ ...modelOutput });

    expect(verdict.annotations).toEqual([]);
    expect(verdict.annotations).not.toBeUndefined();
    expect(verdict.annotations).not.toBeNull();
  });

  it("leaves aggregate scores, verdict band, and headline unaffected by annotations", async () => {
    const request = await captureParser();
    const parser = request.structuredOutput.parser;

    const withAnnotations = parser({
      ...modelOutput,
      annotations: [
        { quote: "guaranteed results", severity: "warning", recommendation: "remove the unsupported absolute" },
      ],
    });
    const withoutAnnotations = parser({ ...modelOutput });

    expect(withAnnotations.scores.overall).toBe(withoutAnnotations.scores.overall);
    expect(withAnnotations.scores).toEqual(withoutAnnotations.scores);
    expect(withAnnotations.verdict).toBe(withoutAnnotations.verdict);
    expect(withAnnotations.headline).toBe(withoutAnnotations.headline);
  });

  it("rejects annotations: null at the parse layer (structured_output_invalid path)", async () => {
    const request = await captureParser();

    // Zod's .default([]) only fills `undefined`, not `null`; a model that emits an
    // explicit null annotations array fails the contract. The real
    // StructuredLlmService catches this throw and surfaces structured_output_invalid;
    // toVerdict never returns a verdict with a null annotations field.
    expect(() => request.structuredOutput.parser({ ...modelOutput, annotations: null })).toThrow();
  });

  it("briefs the model on emitting exact-substring annotations and exposes an optional annotations property in the output schema", async () => {
    const request = await captureParser();

    // Prompt: the instructions must tell the model to emit annotations with a
    // verbatim quote substring (Green appends this sentence to judgeInstructions).
    expect(request.instructions).toContain("annotations");
    expect(request.instructions.toLowerCase()).toContain("substring");

    // Output schema: an optional `annotations` array property capped at 12 items,
    // each { quote, severity, recommendation }, and NOT promoted to required.
    const schema = request.structuredOutput.schema;
    const properties = schema.properties as Record<string, unknown>;
    const annotationsNode = properties.annotations as Record<string, unknown> | undefined;

    expect(annotationsNode).toBeDefined();
    expect(annotationsNode!.type).toBe("array");
    expect(annotationsNode!.maxItems).toBe(12);

    const items = annotationsNode!.items as Record<string, unknown>;
    expect(items.type).toBe("object");
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(expect.arrayContaining(["quote", "severity", "recommendation"]));
    const itemProps = items.properties as Record<string, unknown>;
    expect(itemProps).toHaveProperty("quote");
    expect(itemProps).toHaveProperty("severity");
    expect(itemProps).toHaveProperty("recommendation");
    expect((itemProps.severity as Record<string, unknown>).enum).toEqual(["suggestion", "warning"]);

    // Optional at the model layer: annotations must NOT be in the top-level required set.
    expect(schema.required as string[]).not.toContain("annotations");
  });
});

// The shared judgeVerdictSchema owns the annotations contract; the engine
// consumes it. These round-trips pin the additive default behavior at the schema
// boundary independent of the service wiring.
describe("judgeVerdictSchema annotations round-trip", () => {
  const baseVerdict = {
    verdict: "slight_rework" as const,
    confidence: "medium" as const,
    scores: { ...scores },
    headline: "Strong, specific, reply-friendly.",
    strengths: ["Concrete claim up front"],
    improvements: ["Trim the middle paragraph"],
  };

  it("round-trips a verdict that carries annotations", () => {
    const parsed = judgeVerdictSchema.parse({
      ...baseVerdict,
      annotations: [
        { quote: "guaranteed results", severity: "warning", recommendation: "remove the unsupported absolute" },
      ],
    });

    expect(parsed.annotations).toHaveLength(1);
    expect(parsed.annotations[0]).toEqual({
      quote: "guaranteed results",
      severity: "warning",
      recommendation: "remove the unsupported absolute",
    });
  });

  it("coerces a verdict without an annotations key to []", () => {
    const parsed = judgeVerdictSchema.parse({ ...baseVerdict });

    expect(parsed.annotations).toEqual([]);
  });
});
