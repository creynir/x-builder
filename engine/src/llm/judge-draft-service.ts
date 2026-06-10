import { judgeVerdictSchema, type JudgeDraftResponse, type JudgeVerdict } from "@x-builder/shared";

import type {
  StructuredLlmProviderResult,
  StructuredLlmRequest,
} from "./structured-llm-service.js";

const judgeProviderId = "codex-cli";

const judgeInstructions = [
  "You are a demanding editor judging a single draft post for X (Twitter).",
  "Rate the draft from 0 to 10 on how likely it is to earn genuine engagement,",
  "then justify the verdict.",
  "Return only a JSON object matching the provided output schema: an integer",
  "rating (0-10), a one-line headline verdict, up to five concrete strengths, and",
  "up to five concrete improvements. Be specific and concise; omit empty filler.",
].join(" ");

// Mirror judgeVerdictSchema, which strips unknown keys rather than rejecting
// them; keep this JSON Schema lenient on extra properties to tell the same story
// (and avoid false rejections from a verbose model).
const verdictOutputSchema: Record<string, unknown> = {
  type: "object",
  required: ["rating", "headline", "strengths", "improvements"],
  properties: {
    rating: { type: "integer", minimum: 0, maximum: 10 },
    headline: { type: "string", minLength: 1, maxLength: 160 },
    strengths: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    improvements: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
  },
};

/**
 * Narrow, judge-specialized view of StructuredLlmService so the service can be
 * unit-tested with an in-process fake (no codex, no child process).
 */
export interface JudgeLlmGateway {
  generateStructured(
    request: StructuredLlmRequest<JudgeVerdict>,
  ): Promise<StructuredLlmProviderResult<JudgeVerdict>>;
}

export type JudgeDraftOutcome =
  | { status: "judged"; response: JudgeDraftResponse }
  | { status: "failed"; retryable: boolean; code: string; message: string };

export interface JudgeDraft {
  judge(text: string): Promise<JudgeDraftOutcome>;
}

export class JudgeDraftService implements JudgeDraft {
  constructor(
    private readonly llm: JudgeLlmGateway,
    private readonly providerId: string = judgeProviderId,
  ) {}

  async judge(text: string): Promise<JudgeDraftOutcome> {
    const result = await this.llm.generateStructured({
      provider: this.providerId,
      purpose: "candidate_judge",
      instructions: judgeInstructions,
      turns: [{ role: "user", content: text }],
      structuredOutput: {
        name: "draft_judge_verdict",
        schema: verdictOutputSchema,
        parser: (value: unknown): JudgeVerdict => judgeVerdictSchema.parse(value),
      },
    });

    if (result.status === "success") {
      return {
        status: "judged",
        response: {
          status: "judged",
          verdict: result.output,
          model: result.provider,
          judgedAt: result.completedAt,
        },
      };
    }

    return {
      status: "failed",
      retryable: result.retryable,
      code: result.code,
      message: result.message,
    };
  }
}
