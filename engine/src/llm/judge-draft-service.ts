import {
  deriveJudgeVerdict,
  judgeVerdictSchema,
  type JudgeDraftResponse,
  type JudgeVerdict,
} from "@x-builder/shared";

import type {
  StructuredLlmProviderResult,
  StructuredLlmRequest,
} from "./structured-llm-service.js";

const judgeProviderId = "codex-cli";

// The verdict label is derived from scores.overall, so the model produces every
// field except the verdict.
const judgeModelOutputSchema = judgeVerdictSchema.omit({ verdict: true });

const judgeInstructions = [
  "You are a demanding editor judging a single draft post for X (Twitter),",
  "optimizing for replies and profile clicks while preserving an authentic human voice.",
  "Score each dimension from 0 to 100:",
  "- replies: how likely the right people are to reply (clear, answerable reply path).",
  "- profileClicks: how much it makes a reader want to check the author, without pitching.",
  "- impressions: broad-enough hook, timely and clear, low friction.",
  "- bookmarkValue: reusable insight, framework, or test worth saving.",
  "- dwellProxy: read-through quality (strong first line, scannable, one idea).",
  "- voiceMatch: reads as an authentic human voice, NOT generic AI-slop or corporate",
  "  polish. Do not assume any specific person's style.",
  "- negativeRisk: risk of negative signals (ragebait, misleading or overclaimed,",
  "  spammy engagement bait, generic AI hype). Higher means more risk.",
  "- answerEffort: how little effort a reply takes — 100 means a one-word answer,",
  "  0 means it demands an essay.",
  "- strangerAnswerability: how broadly answerable it is — 100 means anyone can",
  "  reply, 0 means only insiders can.",
  "- statusDependency: how self-evident the payoff is — 100 means it needs a famous",
  "  author bio to land, 0 means it stands on its own. Score the TEXT only, never",
  "  the (unknown) author's actual status.",
  "- replyVsQuoteOrientation: 0-100, where 100 means it collects replies and 0 means",
  "  it invites quote-tweets.",
  "- audienceMatch: how well the draft fits the supplied account profile (0-100).",
  "  When no account profile is provided, return null for audienceMatch.",
  "- overall: your holistic 0-100 judgment, accounting for the dimensions and the",
  "  negative risk.",
  "Penalize hashtag/emoji spam, em dashes, engagement bait, vague 'thoughts?' endings,",
  "unsupported absolutes, and no clear audience.",
  "Also set confidence (low, medium, or high), a one-line headline verdict, up to five",
  "concrete strengths, and up to five concrete improvements. Return only JSON matching",
  "the output schema.",
].join(" ");

// When the caller supplies an account profile, the model anchors audienceMatch to
// it; absent a profile this instruction tells the model to emit null for that
// single dimension while still scoring the other twelve.
const accountProfileInstruction = (accountProfile: string): string =>
  [
    "Account profile for audienceMatch (the author's audience/positioning):",
    accountProfile,
  ].join(" ");

const scoreProperty = { type: "integer", minimum: 0, maximum: 100 };
// audienceMatch is required on the wire but nullable: an integer score when an
// account profile anchors fit, an explicit null when none is supplied.
const nullableScoreProperty = {
  type: ["integer", "null"],
  minimum: 0,
  maximum: 100,
};

const verdictOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "confidence", "headline", "strengths", "improvements"],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "overall",
        "replies",
        "profileClicks",
        "impressions",
        "bookmarkValue",
        "dwellProxy",
        "voiceMatch",
        "negativeRisk",
        "answerEffort",
        "strangerAnswerability",
        "statusDependency",
        "replyVsQuoteOrientation",
        "audienceMatch",
      ],
      properties: {
        overall: scoreProperty,
        replies: scoreProperty,
        profileClicks: scoreProperty,
        impressions: scoreProperty,
        bookmarkValue: scoreProperty,
        dwellProxy: scoreProperty,
        voiceMatch: scoreProperty,
        negativeRisk: scoreProperty,
        answerEffort: scoreProperty,
        strangerAnswerability: scoreProperty,
        statusDependency: scoreProperty,
        replyVsQuoteOrientation: scoreProperty,
        audienceMatch: nullableScoreProperty,
      },
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
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

const toVerdict = (value: unknown): JudgeVerdict => {
  const output = judgeModelOutputSchema.parse(value);

  // Explicit verdict key LAST so the derived band always wins, regardless of what
  // the model returned (the omit() already strips any model-supplied verdict).
  return {
    ...output,
    verdict: deriveJudgeVerdict(output.scores.overall),
  };
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
  judge(text: string, accountProfile?: string): Promise<JudgeDraftOutcome>;
}

export type JudgeProviderResolver = string | (() => string | Promise<string>);

// Resolves the active provider's configured model per call; an empty or absent
// model means the provider keeps its own default (no -m flag).
export type JudgeModelResolver = () => string | undefined | Promise<string | undefined>;

const resolveValue = async <T>(source: T | (() => T | Promise<T>)): Promise<T> =>
  typeof source === "function" ? (source as () => T | Promise<T>)() : source;

export class JudgeDraftService implements JudgeDraft {
  constructor(
    private readonly llm: JudgeLlmGateway,
    private readonly resolveProvider: JudgeProviderResolver = judgeProviderId,
    private readonly resolveModel?: JudgeModelResolver,
  ) {}

  async judge(text: string, accountProfile?: string): Promise<JudgeDraftOutcome> {
    const provider = await resolveValue(this.resolveProvider);
    const model = await this.resolveModel?.();
    // Thread the account profile into the prompt envelope only when present, so a
    // profile-less judge keeps a clean envelope and the model returns a null
    // audienceMatch per the rubric instructions.
    const instructions =
      accountProfile !== undefined
        ? `${judgeInstructions} ${accountProfileInstruction(accountProfile)}`
        : judgeInstructions;
    const result = await this.llm.generateStructured({
      provider,
      purpose: "candidate_judge",
      instructions,
      turns: [{ role: "user", content: text }],
      structuredOutput: {
        name: "draft_judge_verdict",
        schema: verdictOutputSchema,
        parser: toVerdict,
      },
      ...(model !== undefined && model.length > 0 ? { options: { model } } : {}),
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
