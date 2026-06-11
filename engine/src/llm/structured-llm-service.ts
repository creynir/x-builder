import { z } from "zod";

export const llmProviderIdSchema = z.string().min(1);
export const llmPurposeSchema = z.enum(["writer_first_pass", "writer_variants", "candidate_judge"]);
export const llmTurnRoleSchema = z.enum(["system", "user", "assistant"]);

export const defaultStructuredLlmOptions = {
  timeoutMs: 60_000,
  outputByteLimit: 500_000,
  attempts: 1,
} as const;

export const structuredLlmOptionLimits = {
  timeoutMs: 180_000,
  outputByteLimit: 2_000_000,
  attempts: 2,
} as const;

export const llmProviderErrorCodeSchema = z.enum([
  "provider_unavailable",
  "provider_unconfigured",
  "request_timeout",
  "process_failed",
  "nonzero_exit",
  "output_too_large",
  "invalid_provider_response",
  "structured_output_invalid",
  "unsafe_request",
]);

export type LlmProviderId = z.infer<typeof llmProviderIdSchema>;
export type LlmPurpose = z.infer<typeof llmPurposeSchema>;
export type LlmTurnRole = z.infer<typeof llmTurnRoleSchema>;
export type KnownLlmProviderErrorCode = z.infer<typeof llmProviderErrorCodeSchema>;
export type LlmProviderErrorCode = KnownLlmProviderErrorCode | (string & Record<never, never>);

export type LlmTurn = {
  role: LlmTurnRole;
  content: string;
};

export type StructuredOutputContract<TOutput> = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  parser: (value: unknown) => TOutput;
};

export type StructuredLlmExecutionOptions = {
  timeoutMs?: number;
  outputByteLimit?: number;
  attempts?: number;
  model?: string;
};

// model is optional with no default: an absent model must normalize to undefined,
// never a default value, so it is excluded from the Required<> that fills the bounds.
export type NormalizedStructuredLlmExecutionOptions =
  Required<Omit<StructuredLlmExecutionOptions, "model">> & { model?: string };

export type StructuredLlmRequest<TOutput> = {
  provider: LlmProviderId;
  purpose: LlmPurpose;
  instructions: string;
  turns: LlmTurn[];
  structuredOutput: StructuredOutputContract<TOutput>;
  options?: StructuredLlmExecutionOptions;
  metadata?: Record<string, unknown>;
};

export type NormalizedStructuredLlmRequest<TOutput> = Omit<StructuredLlmRequest<TOutput>, "options" | "structuredOutput"> & {
  structuredOutput: StructuredOutputContract<TOutput> & {
    strict: boolean;
  };
  options: NormalizedStructuredLlmExecutionOptions;
};

export type StructuredLlmUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type StructuredLlmSuccessResult<TOutput> = {
  status: "success";
  provider: LlmProviderId;
  requestId: string;
  output: TOutput;
  durationMs: number;
  completedAt: string;
  usage?: StructuredLlmUsage;
  rawText?: string;
};

export type StructuredLlmFailedResult = {
  status: "failed";
  provider: LlmProviderId;
  requestId: string;
  code: LlmProviderErrorCode;
  message: string;
  retryable: boolean;
  durationMs: number;
  completedAt: string;
  details?: Record<string, unknown>;
};

export type StructuredLlmProviderResult<TOutput> =
  | StructuredLlmSuccessResult<TOutput>
  | StructuredLlmFailedResult;

export interface LlmProvider<TProviderOutput> {
  id: LlmProviderId;
  generateStructured<TOutput>(
    request: NormalizedStructuredLlmRequest<TOutput>,
  ): Promise<StructuredLlmProviderResult<TProviderOutput>> | StructuredLlmProviderResult<TProviderOutput>;
}

export type StructuredLlmServiceOptions = {
  providers: Array<LlmProvider<unknown>>;
};

const llmTurnSchema = z.object({
  role: llmTurnRoleSchema,
  content: z.string().min(1),
});

const structuredOutputContractSchema = z.object({
  name: z.string().min(1),
  schema: z.record(z.unknown()),
  strict: z.boolean().optional().default(true),
  parser: z.function().args(z.unknown()).returns(z.unknown()),
});

const structuredLlmExecutionOptionsSchema = z
  .object({
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(structuredLlmOptionLimits.timeoutMs)
      .default(defaultStructuredLlmOptions.timeoutMs),
    outputByteLimit: z
      .number()
      .int()
      .positive()
      .max(structuredLlmOptionLimits.outputByteLimit)
      .default(defaultStructuredLlmOptions.outputByteLimit),
    attempts: z
      .number()
      .int()
      .positive()
      .max(structuredLlmOptionLimits.attempts)
      .default(defaultStructuredLlmOptions.attempts),
    model: z.string().min(1).optional(),
  })
  .default(defaultStructuredLlmOptions);

export const structuredLlmRequestSchema = z.object({
  provider: llmProviderIdSchema,
  purpose: llmPurposeSchema,
  instructions: z.string().min(1),
  turns: z.array(llmTurnSchema).min(1),
  structuredOutput: structuredOutputContractSchema,
  options: structuredLlmExecutionOptionsSchema,
  metadata: z.record(z.unknown()).optional(),
});

const structuredLlmUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const structuredLlmSuccessResultSchema = z.object({
  status: z.literal("success"),
  provider: llmProviderIdSchema,
  requestId: z.string().min(1),
  output: z.unknown(),
  durationMs: z.number().nonnegative(),
  completedAt: z.string().datetime(),
  usage: structuredLlmUsageSchema.optional(),
  rawText: z.string().optional(),
});

const safeDetailsSchema = z.record(z.unknown());

const structuredLlmFailedResultSchema = z.object({
  status: z.literal("failed"),
  provider: llmProviderIdSchema,
  requestId: z.string().min(1),
  code: llmProviderErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  durationMs: z.number().nonnegative(),
  completedAt: z.string().datetime(),
  details: safeDetailsSchema.optional(),
});

export const structuredLlmProviderResultSchema = z.discriminatedUnion("status", [
  structuredLlmSuccessResultSchema,
  structuredLlmFailedResultSchema,
]);

const nowIso = (): string => new Date().toISOString();

const elapsedMs = (startedAt: number): number => Math.max(0, Date.now() - startedAt);

const failure = (
  provider: LlmProviderId,
  code: KnownLlmProviderErrorCode,
  message: string,
  retryable: boolean,
  startedAt: number,
  details?: Record<string, unknown>,
): StructuredLlmFailedResult => ({
  status: "failed",
  provider,
  requestId: crypto.randomUUID(),
  code,
  message,
  retryable,
  durationMs: elapsedMs(startedAt),
  completedAt: nowIso(),
  ...(details ? { details: boundSafeDetails(details) } : {}),
});

const unsafeRequestFailure = (provider: LlmProviderId, startedAt: number): StructuredLlmFailedResult =>
  failure(provider, "unsafe_request", "The LLM request is invalid or exceeds allowed execution bounds.", false, startedAt);

const providerUnconfiguredFailure = (provider: LlmProviderId, startedAt: number): StructuredLlmFailedResult =>
  failure(provider, "provider_unconfigured", "The requested LLM provider is not configured.", false, startedAt);

const providerExceptionFailure = (provider: LlmProviderId, startedAt: number): StructuredLlmFailedResult =>
  failure(provider, "process_failed", "The LLM provider failed before returning a safe result.", false, startedAt);

const structuredOutputInvalidFailure = (provider: LlmProviderId, startedAt: number): StructuredLlmFailedResult =>
  failure(provider, "structured_output_invalid", "The provider returned structured output that did not match the contract.", false, startedAt);

const boundSafeDetails = (details: Record<string, unknown>): Record<string, unknown> => {
  const safeDetails: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details).slice(0, 16)) {
    if (key.toLowerCase().includes("stdout") || key.toLowerCase().includes("stderr")) {
      continue;
    }

    safeDetails[key] = typeof value === "string" && value.length > 1_000 ? `${value.slice(0, 1_000)}...` : value;
  }

  return safeDetails;
};

const hasRequiredSuccessOutput = (providerResult: unknown): boolean =>
  typeof providerResult === "object" &&
  providerResult !== null &&
  "output" in providerResult;

export class StructuredLlmService {
  private readonly providers: Map<LlmProviderId, LlmProvider<unknown>>;

  constructor(options: StructuredLlmServiceOptions) {
    this.providers = new Map(options.providers.map((provider) => [provider.id, provider]));
  }

  async generateStructured<TOutput>(
    request: StructuredLlmRequest<TOutput>,
  ): Promise<StructuredLlmProviderResult<TOutput>> {
    const startedAt = Date.now();
    const providerId = typeof request?.provider === "string" && request.provider.length > 0 ? request.provider : "unknown";
    const parsedRequest = structuredLlmRequestSchema.safeParse(request);

    if (!parsedRequest.success) {
      return unsafeRequestFailure(providerId, startedAt);
    }

    const normalizedRequest = parsedRequest.data as NormalizedStructuredLlmRequest<TOutput>;
    const provider = this.providers.get(normalizedRequest.provider);

    if (!provider) {
      return providerUnconfiguredFailure(normalizedRequest.provider, startedAt);
    }

    let lastFailure: StructuredLlmFailedResult | undefined;

    for (let attempt = 1; attempt <= normalizedRequest.options.attempts; attempt += 1) {
      const providerResult = await this.callProvider(provider, normalizedRequest, startedAt);

      if (providerResult.status === "success") {
        const parsedOutput = this.parseProviderOutput(providerResult.output, normalizedRequest, startedAt);

        if (parsedOutput.status === "failed") {
          return parsedOutput;
        }

        return {
          ...providerResult,
          output: parsedOutput.output,
        };
      }

      lastFailure = {
        ...providerResult,
        details: providerResult.details ? boundSafeDetails(providerResult.details) : undefined,
      };

      if (!providerResult.retryable || attempt === normalizedRequest.options.attempts) {
        return lastFailure;
      }
    }

    return lastFailure ?? providerExceptionFailure(normalizedRequest.provider, startedAt);
  }

  private async callProvider<TOutput>(
    provider: LlmProvider<unknown>,
    request: NormalizedStructuredLlmRequest<TOutput>,
    startedAt: number,
  ): Promise<StructuredLlmProviderResult<unknown>> {
    try {
      const providerResult = await provider.generateStructured(request);
      const parsedProviderResult = structuredLlmProviderResultSchema.safeParse(providerResult);

      if (
        !parsedProviderResult.success ||
        (parsedProviderResult.data.status === "success" && !hasRequiredSuccessOutput(providerResult))
      ) {
        return failure(
          request.provider,
          "invalid_provider_response",
          "The LLM provider returned an invalid service result.",
          false,
          startedAt,
        );
      }

      return parsedProviderResult.data as StructuredLlmProviderResult<unknown>;
    } catch {
      return providerExceptionFailure(request.provider, startedAt);
    }
  }

  private parseProviderOutput<TOutput>(
    output: unknown,
    request: NormalizedStructuredLlmRequest<TOutput>,
    startedAt: number,
  ): StructuredLlmProviderResult<TOutput> {
    try {
      return {
        status: "success",
        provider: request.provider,
        requestId: crypto.randomUUID(),
        output: request.structuredOutput.parser(output),
        durationMs: elapsedMs(startedAt),
        completedAt: nowIso(),
      };
    } catch {
      return structuredOutputInvalidFailure(request.provider, startedAt);
    }
  }
}
