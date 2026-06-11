import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  LlmProvider,
  StructuredLlmProviderResult,
  StructuredLlmRequest,
  StructuredLlmService as StructuredLlmServiceType,
} from "../structured-llm-service.js";

type DraftOutput = {
  draft: string;
  score: number;
};

type StructuredLlmServiceConstructor = new (options: {
  providers: Array<LlmProvider<unknown>>;
}) => StructuredLlmServiceType;

type FakeProvider = LlmProvider<unknown> & {
  generateStructured: ReturnType<typeof vi.fn>;
};

const supportedPurposes = ["writer_first_pass", "writer_variants", "candidate_judge"] as const;

const providerFailureCases = [
  ["provider_unavailable", true],
  ["request_timeout", true],
  ["process_failed", false],
  ["nonzero_exit", false],
  ["output_too_large", false],
  ["invalid_provider_response", false],
] as const;

const draftOutputSchema = z.object({
  draft: z.string(),
  score: z.number(),
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["draft", "score"],
  properties: {
    draft: { type: "string" },
    score: { type: "number" },
  },
} as const;

async function loadStructuredLlmService(): Promise<StructuredLlmServiceConstructor> {
  const module = (await import("../structured-llm-service.js")) as {
    StructuredLlmService: StructuredLlmServiceConstructor;
  };

  return module.StructuredLlmService;
}

async function createService(provider: FakeProvider): Promise<StructuredLlmServiceType> {
  const StructuredLlmService = await loadStructuredLlmService();

  return new StructuredLlmService({
    providers: [provider],
  });
}

function request(
  overrides: Partial<StructuredLlmRequest<DraftOutput>> = {},
): StructuredLlmRequest<DraftOutput> {
  return {
    provider: "codex-cli",
    purpose: "writer_first_pass",
    instructions: "Return a structured draft quality summary.",
    turns: [
      {
        role: "system",
        content: "You evaluate draft quality.",
      },
      {
        role: "user",
        content: "Score this draft.",
      },
      {
        role: "assistant",
        content: "Ready for the draft.",
      },
    ],
    structuredOutput: {
      name: "draft_quality",
      schema: jsonSchema,
      parser: (value: unknown) => draftOutputSchema.parse(value),
    },
    ...overrides,
  };
}

function successResult(output: unknown): StructuredLlmProviderResult<unknown> {
  return {
    status: "success",
    provider: "codex-cli",
    requestId: "provider-request-1",
    output,
    durationMs: 12,
    completedAt: "2026-06-09T10:00:00.000Z",
    usage: {
      inputTokens: 12,
      outputTokens: 8,
    },
    rawText: JSON.stringify(output),
  };
}

function failedResult(
  code: string,
  retryable: boolean,
  details: Record<string, unknown> = {
    stage: "fake-provider",
  },
): StructuredLlmProviderResult<unknown> {
  return {
    status: "failed",
    provider: "codex-cli",
    requestId: "provider-request-1",
    code,
    message: "Provider failed safely.",
    retryable,
    durationMs: 9,
    completedAt: "2026-06-09T10:00:00.000Z",
    details,
  };
}

function fakeProvider(
  generateStructured: FakeProvider["generateStructured"] = vi.fn(async () =>
    successResult({
      draft: "Specific proof beats generic claims.",
      score: 91,
    }),
  ),
): FakeProvider {
  return {
    id: "codex-cli",
    checkReadiness: vi.fn(async () => ({
      state: "ready",
      label: "Codex CLI",
      retryable: false,
      details: {
        adapter: "codex-cli",
      },
      checkedAt: "2026-06-09T10:00:00.000Z",
    })),
    generateStructured,
  } as FakeProvider;
}

describe("structured LLM service", () => {
  it.each(supportedPurposes)(
    "passes %s requests to the provider and returns typed output",
    async (purpose) => {
      const provider = fakeProvider();
      const service = await createService(provider);

      const result = await service.generateStructured(request({ purpose }));

      expect(result).toMatchObject({
        status: "success",
        provider: "codex-cli",
        output: {
          draft: "Specific proof beats generic claims.",
          score: 91,
        },
        requestId: expect.any(String),
        durationMs: expect.any(Number),
        completedAt: expect.any(String),
        usage: {
          inputTokens: 12,
          outputTokens: 8,
        },
      });
      expect(provider.generateStructured).toHaveBeenCalledOnce();
      expect(provider.generateStructured).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "codex-cli",
          purpose,
          options: {
            timeoutMs: 60_000,
            outputByteLimit: 500_000,
            attempts: 1,
          },
          structuredOutput: expect.objectContaining({
            name: "draft_quality",
            strict: true,
          }),
        }),
      );
    },
  );

  it("returns typed output for a valid request and successful fake provider", async () => {
    const provider = fakeProvider();
    const service = await createService(provider);

    const result = await service.generateStructured(request());

    expect(result).toMatchObject({
      status: "success",
      provider: "codex-cli",
      output: {
        draft: "Specific proof beats generic claims.",
        score: 91,
      },
      requestId: expect.any(String),
      durationMs: expect.any(Number),
      completedAt: expect.any(String),
      usage: {
        inputTokens: 12,
        outputTokens: 8,
      },
    });
    expect(provider.generateStructured).toHaveBeenCalledOnce();
    expect(provider.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex-cli",
        purpose: "writer_first_pass",
        options: {
          timeoutMs: 60_000,
          outputByteLimit: 500_000,
          attempts: 1,
        },
        structuredOutput: expect.objectContaining({
          name: "draft_quality",
          strict: true,
        }),
      }),
    );
  });

  it("retries a retryable provider failure at most once when two attempts are requested", async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValueOnce(failedResult("provider_unavailable", true))
      .mockResolvedValueOnce(
        successResult({
          draft: "The retry returned valid structured output.",
          score: 77,
        }),
      );
    const provider = fakeProvider(generateStructured);
    const service = await createService(provider);

    const result = await service.generateStructured(
      request({
        options: {
          attempts: 2,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "success",
      output: {
        draft: "The retry returned valid structured output.",
        score: 77,
      },
    });
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

  it("stops after two total attempts when retryable provider failures continue", async () => {
    const generateStructured = vi.fn(async () => failedResult("provider_unavailable", true));
    const provider = fakeProvider(generateStructured);
    const service = await createService(provider);

    const result = await service.generateStructured(
      request({
        options: {
          attempts: 2,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "provider_unavailable",
      retryable: true,
      message: "Provider failed safely.",
    });
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

  it("returns structured_output_invalid without retrying when provider output fails the parser", async () => {
    const generateStructured = vi.fn(async () =>
      successResult({
        draft: 404,
        score: "invalid",
      }),
    );
    const provider = fakeProvider(generateStructured);
    const service = await createService(provider);

    const result = await service.generateStructured(
      request({
        options: {
          attempts: 2,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "structured_output_invalid",
      retryable: false,
      message: expect.any(String),
      requestId: expect.any(String),
      durationMs: expect.any(Number),
      completedAt: expect.any(String),
    });
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("returns provider_unconfigured for an unsupported provider id", async () => {
    const provider = fakeProvider();
    const service = await createService(provider);

    const result = await service.generateStructured(
      request({
        provider: "openai-responses",
      } as Partial<StructuredLlmRequest<DraftOutput>>),
    );

    expect(result).toMatchObject({
      status: "failed",
      code: "provider_unconfigured",
      retryable: false,
      provider: "openai-responses",
      message: expect.any(String),
    });
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it("returns unsafe_request for invalid execution bounds before calling a provider", async () => {
    const provider = fakeProvider();
    const service = await createService(provider);

    const result = await service.generateStructured(
      request({
        options: {
          attempts: 3,
          timeoutMs: 180_001,
          outputByteLimit: 2_000_001,
        },
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "unsafe_request",
      retryable: false,
      message: expect.any(String),
    });
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it.each(providerFailureCases)(
    "resolves %s provider failures as failed results instead of throwing",
    async (code, retryable) => {
      const provider = fakeProvider(vi.fn(async () => failedResult(code, retryable)));
      const service = await createService(provider);

      await expect(service.generateStructured(request())).resolves.toMatchObject({
        status: "failed",
        provider: "codex-cli",
        code,
        retryable,
        message: "Provider failed safely.",
      });
      expect(provider.generateStructured).toHaveBeenCalledOnce();
    },
  );

  it("normalizes a request with no model option to an undefined model rather than a default", async () => {
    const provider = fakeProvider();
    const service = await createService(provider);

    await service.generateStructured(request());

    const normalized = provider.generateStructured.mock.calls[0]![0];
    expect(normalized.options.model).toBeUndefined();
  });

  it("passes a non-empty model option through to the provider request unchanged", async () => {
    const provider = fakeProvider();
    const service = await createService(provider);

    await service.generateStructured(
      request({
        options: {
          model: "gpt-5.2-codex",
        },
      }),
    );

    const normalized = provider.generateStructured.mock.calls[0]![0];
    expect(normalized.options.model).toBe("gpt-5.2-codex");
  });

  it("rejects an empty-string model option as an unsafe request before calling a provider", async () => {
    const provider = fakeProvider();
    const service = await createService(provider);

    const result = await service.generateStructured(
      request({
        options: {
          model: "",
        },
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      code: "unsafe_request",
      retryable: false,
    });
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it("does not log prompts or raw provider output details", async () => {
    const promptSentinel = "SENSITIVE_PROMPT_SENTINEL_DO_NOT_LOG";
    const rawStdoutSentinel = "RAW_STDOUT_SENTINEL_DO_NOT_LOG";
    const rawStderrSentinel = "RAW_STDERR_SENTINEL_DO_NOT_LOG";
    const logSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];

    try {
      const provider = fakeProvider(
        vi.fn(async () =>
          failedResult("invalid_provider_response", false, {
            rawStdout: rawStdoutSentinel,
            rawStderr: rawStderrSentinel,
          }),
        ),
      );
      const service = await createService(provider);

      const result = await service.generateStructured(
        request({
          instructions: promptSentinel,
          turns: [
            {
              role: "system",
              content: promptSentinel,
            },
            {
              role: "user",
              content: promptSentinel,
            },
            {
              role: "assistant",
              content: promptSentinel,
            },
          ],
        }),
      );

      expect(result).toMatchObject({
        status: "failed",
        provider: "codex-cli",
        code: "invalid_provider_response",
      });
      expect(provider.generateStructured).toHaveBeenCalledOnce();

      const loggedText = logSpies
        .flatMap((spy) => spy.mock.calls)
        .flatMap((call) => call.map((argument) => String(argument)))
        .join("\n");

      expect(loggedText).not.toContain(promptSentinel);
      expect(loggedText).not.toContain(rawStdoutSentinel);
      expect(loggedText).not.toContain(rawStderrSentinel);
    } finally {
      for (const spy of logSpies) {
        spy.mockRestore();
      }
    }
  });
});
