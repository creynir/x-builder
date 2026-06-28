import {
  deriveApproved,
  type ApplyJudgeSuggestionsRequest,
  type ApplyJudgeSuggestionsResponse,
  type JudgeVerdict,
} from "@x-builder/shared";

import { ChainDeadline } from "./chain-deadline.js";
import {
  type JudgeDraft,
  type JudgeProviderResolver,
} from "./judge-draft-service.js";
import {
  StructuredLlmService,
  structuredLlmOptionLimits,
  type StructuredLlmRequest,
} from "./structured-llm-service.js";

// Default per-chain budget: the chain runs three LLM calls in series (judge ->
// rewrite -> re-judge), all drawing from the same wall-clock deadline.
const defaultChainTimeoutMs = 3 * 60_000;

// Caps that keep the prompt bounded: the verdict carries up to 12 annotations and
// up to 5 improvements, the same limits the judge output schema enforces.
const maxRewriteAnnotations = 12;
const maxRewriteImprovements = 5;

// A typed error so the route handler's catch maps any step failure (initial
// judge, rewrite, or re-judge) to the generation_failed contract.
export class ApplySuggestionsError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApplySuggestionsError";
  }
}

const remainingLlmTimeoutMs = (deadline: ChainDeadline): number => {
  deadline.assertRemaining();
  return deadline.remainingMs(structuredLlmOptionLimits.timeoutMs);
};

const rewriteOutputSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 8_000 },
  },
};

// Extract the rewritten draft, yielding the bare string. Robust to three shapes:
//   1. `{ text: "<draft>" }` — the schema-shaped object (codex's first parse).
//   2. `"<draft>"` — an already-extracted string. The structured-LLM pipeline
//      applies this parser TWICE (provider parse, then StructuredLlmService
//      re-parse), so the second pass MUST accept the bare string idempotently —
//      otherwise it throws → "structured output did not match the contract".
//   3. `"{\"text\":\"<draft>\"}"` — some models double-encode the draft as a JSON
//      `{text}` string INSIDE the text field; unwrap that envelope too.
const toRewrittenText = (value: unknown): string => {
  let current: unknown = value;

  for (let depth = 0; depth < 4; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      typeof (current as { text?: unknown }).text === "string"
    ) {
      current = (current as { text: string }).text;
      continue;
    }

    if (typeof current === "string") {
      const text: string = current;
      const trimmed = text.trim();
      // A string that is itself a `{"text": ...}` envelope → unwrap one level.
      if (trimmed.startsWith("{") && trimmed.includes('"text"')) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (
            parsed !== null &&
            typeof parsed === "object" &&
            typeof (parsed as { text?: unknown }).text === "string"
          ) {
            current = (parsed as { text: string }).text;
            continue;
          }
        } catch {
          // Not JSON — it is the final rewritten text.
        }
      }
      if (text.length > 0) {
        return text;
      }
    }

    break;
  }

  throw new Error("Rewrite output did not match the rewrite contract.");
};

// JudgeProviderResolver is `string | (() => string | Promise<string>)`; resolve
// either form to a concrete provider id, mirroring generate-ideas-service.
const resolveProviderId = async (
  source: JudgeProviderResolver,
): Promise<string> =>
  typeof source === "function" ? source() : source;

// Build the rewrite system prompt: each annotation becomes a span-level fix
// ("Fix: [quote] — [recommendation]"), each improvement a structural directive,
// and the model is told to preserve voice, topic, and length while applying
// every fix. Empty lists leave the model to improve on its own judgment.
const rewriteInstructions = (verdict: JudgeVerdict): string => {
  const lines = [
    "You are an expert X (Twitter) editor revising a single draft post.",
    "Apply every fix below while preserving the author's voice, keeping the same",
    "general topic, and holding to roughly the same length.",
  ];

  const fixes = verdict.annotations.slice(0, maxRewriteAnnotations);
  if (fixes.length > 0) {
    lines.push("Span-level fixes (apply each one):");
    for (const annotation of fixes) {
      lines.push(`Fix: ${annotation.quote} — ${annotation.recommendation}`);
    }
  }

  const improvements = verdict.improvements.slice(0, maxRewriteImprovements);
  if (improvements.length > 0) {
    lines.push("Structural improvements (apply each one):");
    for (const improvement of improvements) {
      lines.push(`Improvement: ${improvement}`);
    }
  }

  lines.push(
    "Return only JSON matching the output schema: a single text field carrying the",
    "rewritten draft as PLAIN TEXT (not nested JSON, no quotes around the whole draft).",
  );

  return lines.join(" ");
};

export class ApplyJudgeSuggestionsService {
  private readonly chainTimeoutMs: number;

  constructor(
    private readonly judge: JudgeDraft,
    private readonly llm: StructuredLlmService,
    private readonly resolveProvider: JudgeProviderResolver,
    private readonly resolveJudgeAccountProfile: () => Promise<string | undefined>,
    chainTimeoutMs: number = defaultChainTimeoutMs,
  ) {
    this.chainTimeoutMs = chainTimeoutMs;
  }

  async apply(
    request: ApplyJudgeSuggestionsRequest,
  ): Promise<ApplyJudgeSuggestionsResponse> {
    const deadline = new ChainDeadline({ budgetMs: this.chainTimeoutMs });
    const profile = await this.resolveProfileSafely();

    // Step 1 — judge the original. A failed judge is the never-recoverable head
    // of the chain: throw the typed error the route maps to generation_failed.
    const originalOutcome = await this.judge.judge(request.text, profile, {
      timeoutMs: remainingLlmTimeoutMs(deadline),
    });
    if (originalOutcome.status !== "judged") {
      throw new ApplySuggestionsError(
        originalOutcome.message,
        originalOutcome.code,
      );
    }
    const originalVerdict = originalOutcome.response.verdict;
    const originalOverall = originalVerdict.scores.overall;

    // Step 2 — rewrite, applying the verdict's annotations and improvements.
    const provider = await resolveProviderId(this.resolveProvider);

    const rewriteRequest: StructuredLlmRequest<string> = {
      provider,
      purpose: "writer_first_pass",
      instructions: rewriteInstructions(originalVerdict),
      turns: [{ role: "user", content: request.text }],
      structuredOutput: {
        name: "applied_suggestions_rewrite",
        schema: rewriteOutputSchema,
        parser: toRewrittenText,
      },
      options: { timeoutMs: remainingLlmTimeoutMs(deadline) },
    };

    const rewriteResult = await this.llm.generateStructured(rewriteRequest);
    if (rewriteResult.status === "failed") {
      throw new ApplySuggestionsError(rewriteResult.message, rewriteResult.code);
    }

    // The parser yields the rewritten string, so output is the text itself; the
    // unit fake sets output to that string directly.
    const rewrittenText = rewriteResult.output;

    // Step 3 — re-judge the rewrite. A failed re-judge throws as well, so the
    // route cannot return a rewrite whose quality is unknown.
    const rewriteOutcome = await this.judge.judge(rewrittenText, profile, {
      timeoutMs: remainingLlmTimeoutMs(deadline),
    });
    if (rewriteOutcome.status !== "judged") {
      throw new ApplySuggestionsError(
        rewriteOutcome.message,
        rewriteOutcome.code,
      );
    }
    const rewriteVerdict = rewriteOutcome.response.verdict;
    const rewriteOverall = rewriteVerdict.scores.overall;

    // Never-worse guard (strictly <=): a rewrite that scores no better than the
    // original is discarded and the original is returned unchanged. The verdict
    // and approved flag always describe the RETURNED text.
    if (rewriteOverall <= originalOverall) {
      return {
        text: request.text,
        verdict: originalVerdict,
        approved: deriveApproved(originalVerdict),
        improvedOverOriginal: false,
      };
    }

    return {
      text: rewrittenText,
      verdict: rewriteVerdict,
      approved: deriveApproved(rewriteVerdict),
      improvedOverOriginal: true,
    };
  }

  // A profile resolver that throws must not fail the chain: fall back to a
  // profile-less judge pass, the same contract GenerateIdeasService follows.
  private async resolveProfileSafely(): Promise<string | undefined> {
    try {
      return await this.resolveJudgeAccountProfile();
    } catch {
      return undefined;
    }
  }
}
