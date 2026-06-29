import {
  deriveApproved,
  type DetectedPostFormat,
  type GenerateIdeaRequest,
  type GenerateIdeaResponse,
  type GeneratedIdeaCandidate,
} from "@x-builder/shared";

import { ChainDeadline } from "./chain-deadline.js";
import type { GenerationGuidanceRequest, GenerationGuidanceResolver } from "./generation-guidance.js";
import {
  type JudgeDraft,
  type JudgeDraftOutcome,
  type JudgeProviderResolver,
} from "./judge-draft-service.js";
import {
  StructuredLlmService,
  structuredLlmOptionLimits,
  type StructuredLlmRequest,
} from "./structured-llm-service.js";

// Default per-chain budget for the full format-generation path: one writer call
// plus three fan-out judges all draw from this same wall-clock deadline.
const defaultChainTimeoutMs = 4 * 60_000;

// The generate step asks for exactly three candidates; the three rendering
// formats are assigned deterministically so each candidate carries one of the
// shell's distinct presentation styles, the same ones the idea-only stub emits.
const candidateRenderingFormats = [
  "one-liner",
  "mini-framework",
  "debate-question",
] as const;
const generatedCandidateCount = candidateRenderingFormats.length;

// The shape the model is asked to return: exactly three { id, text } drafts.
type GeneratedDrafts = {
  candidates: Array<{ id: string; text: string }>;
};

// A typed error so the route handler's catch maps fatal generation-chain failures
// to the generation_failed contract. Non-timeout judge failures still stay local
// to their candidate.
export class IdeaGenerationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "IdeaGenerationError";
  }
}

const chainFatalJudgeFailureCodes = new Set(["chain_budget_exhausted", "request_timeout"]);

const remainingLlmTimeoutMs = (deadline: ChainDeadline): number => {
  deadline.assertRemaining();
  return deadline.remainingMs(structuredLlmOptionLimits.timeoutMs);
};

const errorCodeFromUnknown = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const fatalJudgeError = (
  outcome: PromiseSettledResult<JudgeDraftOutcome>,
): IdeaGenerationError | undefined => {
  if (outcome.status === "rejected") {
    const code = errorCodeFromUnknown(outcome.reason);
    if (code !== undefined && chainFatalJudgeFailureCodes.has(code)) {
      const message = outcome.reason instanceof Error ? outcome.reason.message : code;
      return new IdeaGenerationError(message, code);
    }
    return undefined;
  }

  if (outcome.value.status === "failed" && chainFatalJudgeFailureCodes.has(outcome.value.code)) {
    return new IdeaGenerationError(outcome.value.message, outcome.value.code);
  }

  return undefined;
};

const generatedDraftsSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: generatedCandidateCount,
      maxItems: generatedCandidateCount,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 120 },
          text: { type: "string", minLength: 1, maxLength: 8_000 },
        },
      },
    },
  },
};

// Shape and validate the model output. The real StructuredLlmService runs this
// parser against raw provider output; an off-contract payload throws here and
// the LLM layer turns it into a structured_output_invalid failure.
const toGeneratedDrafts = (value: unknown): GeneratedDrafts => {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { candidates?: unknown }).candidates)
  ) {
    throw new Error("Generated output did not match the candidate contract.");
  }

  const candidates = (value as { candidates: unknown[] }).candidates.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== "string" ||
      typeof (entry as { text?: unknown }).text !== "string"
    ) {
      throw new Error("Generated candidate did not match the candidate contract.");
    }

    const { id, text } = entry as { id: string; text: string };
    return { id, text };
  });

  return { candidates };
};

// JudgeProviderResolver is `string | (() => string | Promise<string>)`; resolve
// either form to a concrete provider id, mirroring judge-draft-service.
const resolveProviderId = async (
  source: JudgeProviderResolver,
): Promise<string> =>
  typeof source === "function" ? source() : source;

const generationInstructions = (
  format: DetectedPostFormat,
  idea?: string,
  guidance?: string,
): string => {
  const lines = [
    "You are an expert X (Twitter) writer.",
    `Produce exactly ${generatedCandidateCount} distinct draft posts in the "${format}" format.`,
    "Each draft must take a genuinely different angle on the topic — no near-duplicates.",
    "Keep every draft Twitter-length and in an authentic human voice; avoid generic AI",
    "hype, hashtag/emoji spam, em dashes, and engagement bait.",
    idea !== undefined
      ? `Seed topic to build the drafts around: ${idea}`
      : "Choose a fresh, specific topic that suits the requested format.",
    "Return only JSON matching the output schema: a candidates array of exactly",
    `${generatedCandidateCount} items, each with a short id and the draft text.`,
  ];

  const base = lines.join(" ");

  // The configured guidance block can combine the requested playbook, external
  // pattern constraints, and the author's own voice examples.
  if (guidance !== undefined && guidance.trim().length > 0) {
    return `${base}\n\nGround your drafts in the following guidance. It may include the requested format playbook, external performance constraints, and the author's own voice samples. Prefer its specific recommendations over generic advice:\n\n${guidance.trim()}`;
  }

  return base;
};

export class GenerateIdeasService {
  private readonly chainTimeoutMs: number;

  constructor(
    private readonly llm: StructuredLlmService,
    private readonly judge: JudgeDraft,
    private readonly resolveProvider: JudgeProviderResolver,
    private readonly resolveJudgeAccountProfile: () => Promise<string | undefined>,
    chainTimeoutMs: number = defaultChainTimeoutMs,
    // Optional: resolves the request-aware generation guidance block. Absent →
    // drafts use the base template.
    private readonly resolveGenerationGuidance?: GenerationGuidanceResolver,
  ) {
    this.chainTimeoutMs = chainTimeoutMs;
  }

  async generate(input: GenerateIdeaRequest): Promise<GenerateIdeaResponse> {
    // Format path takes precedence: when a format is present the drafts are
    // generated by the LLM and judged. The idea-only path is the deterministic
    // stub and never touches the LLM or the judge.
    if (input.format === undefined) {
      return this.generateFromIdeaOnly(input);
    }

    return this.generateFromFormat({
      format: input.format,
      ...(input.idea === undefined ? {} : { idea: input.idea }),
      ...(input.voiceProfileId === undefined ? {} : { voiceProfileId: input.voiceProfileId }),
      useKnownPostIds: input.useKnownPostIds ?? [],
    });
  }

  // Idea-only path: deterministic stub, byte-for-byte the shell's three
  // rendering formats, no verdict/approved fields. No LLM call, no judge pass.
  private generateFromIdeaOnly(input: GenerateIdeaRequest): GenerateIdeaResponse {
    const idea = input.idea ?? "";

    return {
      candidates: [
        { id: "one-liner", format: "one-liner", text: idea },
        {
          id: "mini-framework",
          format: "mini-framework",
          text: `${idea}\n\n1. Name the constraint.\n2. Show the tradeoff.\n3. Make the decision.`,
        },
        {
          id: "debate-question",
          format: "debate-question",
          text: `${idea}\n\nWhat would change your mind?`,
        },
      ],
    };
  }

  private async generateFromFormat(
    guidanceRequest: GenerationGuidanceRequest,
  ): Promise<GenerateIdeaResponse> {
    const deadline = new ChainDeadline({ budgetMs: this.chainTimeoutMs });
    const provider = await resolveProviderId(this.resolveProvider);
    const guidance = await this.resolveGuidanceSafely(guidanceRequest);
    const { format, idea } = guidanceRequest;

    const request: StructuredLlmRequest<GeneratedDrafts> = {
      provider,
      purpose: "writer_variants",
      instructions: generationInstructions(format, idea, guidance),
      turns: [
        {
          role: "user",
          content:
            idea !== undefined
              ? `Format: ${format}. Seed topic: ${idea}.`
              : `Format: ${format}.`,
        },
      ],
      structuredOutput: {
        name: "generated_idea_candidates",
        schema: generatedDraftsSchema,
        parser: toGeneratedDrafts,
      },
      options: { timeoutMs: remainingLlmTimeoutMs(deadline) },
    };

    const result = await this.llm.generateStructured(request);

    // A generate-step failure is the only path that surfaces generation_failed:
    // throw a typed error the route handler maps to that contract.
    if (result.status === "failed") {
      throw new IdeaGenerationError(result.message, result.code);
    }

    const generated = result.output.candidates;

    // Fewer or more than the contracted count is a generate failure, not a
    // judge failure — the overlay must not render a short-changed batch.
    if (generated.length !== generatedCandidateCount) {
      throw new IdeaGenerationError(
        `Expected ${generatedCandidateCount} generated candidates, received ${generated.length}.`,
        "structured_output_invalid",
      );
    }

    // Resolve the judge profile once for the whole batch. A profile resolver
    // that throws must not fail any candidate — fall back to a profile-less
    // judge pass.
    const profile = await this.resolveProfileSafely();

    const judgeTimeoutMs = remainingLlmTimeoutMs(deadline);

    // Judge every candidate in parallel. Chain-budget and request-timeout
    // failures are fatal for the batch; other judge failures stay candidate-local.
    const judged = await Promise.allSettled(
      generated.map((candidate) =>
        this.judge.judge(candidate.text, profile, { timeoutMs: judgeTimeoutMs }),
      ),
    );

    const fatal = judged.map(fatalJudgeError).find((error) => error !== undefined);
    if (fatal !== undefined) {
      throw fatal;
    }

    const candidates: GeneratedIdeaCandidate[] = generated.map((candidate, index) => {
      const base: GeneratedIdeaCandidate = {
        id: candidate.id,
        format: candidateRenderingFormats[index]!,
        text: candidate.text,
      };

      const outcome = judged[index];

      // A judge that succeeded attaches verdict + derived approved. Non-fatal
      // failures leave the candidate without those keys — a genuine omission,
      // not undefined values.
      if (
        outcome !== undefined &&
        outcome.status === "fulfilled" &&
        outcome.value.status === "judged"
      ) {
        const verdict = outcome.value.response.verdict;
        return { ...base, verdict, approved: deriveApproved(verdict) };
      }

      return base;
    });

    return { candidates };
  }

  private async resolveProfileSafely(): Promise<string | undefined> {
    try {
      return await this.resolveJudgeAccountProfile();
    } catch {
      return undefined;
    }
  }

  // Resolve the generation guidance, never throwing: a missing resolver or a
  // failed read collapses to undefined so generation falls back to the template.
  private async resolveGuidanceSafely(
    request: GenerationGuidanceRequest,
  ): Promise<string | undefined> {
    if (this.resolveGenerationGuidance === undefined) {
      return undefined;
    }
    try {
      const guidance = await this.resolveGenerationGuidance(request);
      const trimmed = guidance?.trim();

      return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
    } catch {
      return undefined;
    }
  }
}
