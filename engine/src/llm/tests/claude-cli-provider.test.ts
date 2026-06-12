import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  LlmProvider,
  NormalizedStructuredLlmRequest,
  StructuredLlmProviderResult,
} from "../structured-llm-service.js";

// The exact, concrete set of parent environment variable names the claude
// generation run must pass through to the child process today. Pinned here as
// literals (NOT imported from the source constant) so the assertion survives a
// rename/relocation of the underlying allowlist while still failing if the
// effective env set ever gains or loses a variable. The keychain auth path
// needs USER on top of the base list; ANTHROPIC_API_KEY is the key alternative.
const expectedClaudeRunEnvAllowlist = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "ANTHROPIC_API_KEY",
  "USER",
] as const;

type DraftOutput = {
  draft: string;
  confidence: number;
};

type CapturedRunOptions = {
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  stdin?: string;
  env?: Record<string, string>;
  envAllowlist?: readonly string[];
};

type CapturedRun = {
  command: string;
  args: readonly string[];
  options: CapturedRunOptions;
};

type FakeProcessResult = {
  status: "success" | "failed";
  code?: string;
  retryable?: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  timedOut?: boolean;
  stream?: "stdout" | "stderr";
  message?: string;
  details?: Record<string, unknown>;
};

type FakeProcessRunner = {
  run: ReturnType<typeof vi.fn>;
  calls: CapturedRun[];
};

type ClaudeCliProviderConstructor = new (options: {
  runner: FakeProcessRunner;
  workspaceRoot: string;
}) => LlmProvider<DraftOutput>;

type ClaudeCommandBuilderInstance = {
  build: (options: {
    workspaceRoot: string;
    schema: string;
    instructions: string;
    model?: string;
  }) => readonly string[];
};

type ClaudeCommandBuilderConstructor = new () => ClaudeCommandBuilderInstance;

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(testDir, "fixtures", "claude-cli");
const workspaceRoot = "/tmp/x-builder-claude-cli-provider-workspace";
const requestSuppliedCwd = "/tmp/request-supplied-cwd-must-not-win";

const draftOutputSchema = z.object({
  draft: z.string(),
  confidence: z.number().min(0).max(1),
});

const outputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["draft", "confidence"],
  properties: {
    draft: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

// The structured_output value carried by the captured success fixture, used as
// the expected typed output once the caller parser accepts it.
const draftFromSuccessFixture = {
  draft: "Specific proof beats generic claims.",
  confidence: 0.91,
};

async function loadClaudeCliProvider(): Promise<ClaudeCliProviderConstructor> {
  const module = (await import("../claude-cli-provider.js")) as {
    ClaudeCliProvider: ClaudeCliProviderConstructor;
  };

  return module.ClaudeCliProvider;
}

async function loadClaudeCommandBuilder(): Promise<ClaudeCommandBuilderConstructor> {
  const module = (await import("../claude-cli-provider.js")) as {
    ClaudeCommandBuilder: ClaudeCommandBuilderConstructor;
  };

  return module.ClaudeCommandBuilder;
}

async function loadClaudeCliProcessEnvAllowlist(): Promise<readonly string[]> {
  const module = (await import("../claude-cli-provider.js")) as {
    claudeCliProcessEnvAllowlist: readonly string[];
  };

  return module.claudeCliProcessEnvAllowlist;
}

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8");
}

async function createProvider(runner: FakeProcessRunner): Promise<LlmProvider<DraftOutput>> {
  const ClaudeCliProvider = await loadClaudeCliProvider();

  return new ClaudeCliProvider({
    runner,
    workspaceRoot,
  });
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function successProcessResult(stdout: string): FakeProcessResult {
  return {
    status: "success",
    stdout,
    stderr: "",
    exitCode: 0,
    signal: null,
    durationMs: 21,
    stdoutBytes: byteLength(stdout),
    stderrBytes: 0,
  };
}

function failedProcessResult(
  code: string,
  overrides: Partial<FakeProcessResult> = {},
): FakeProcessResult {
  const stdout = overrides.stdout ?? "";
  const stderr = overrides.stderr ?? "";

  return {
    status: "failed",
    code,
    retryable: false,
    stdout,
    stderr,
    exitCode: null,
    signal: null,
    durationMs: 35,
    stdoutBytes: byteLength(stdout),
    stderrBytes: byteLength(stderr),
    message: "Process failed safely.",
    ...overrides,
  };
}

function fakeRunner(
  result:
    | FakeProcessResult
    | ((call: CapturedRun) => FakeProcessResult | Promise<FakeProcessResult>),
): FakeProcessRunner {
  const calls: CapturedRun[] = [];
  const run = vi.fn(async (command: string, args: readonly string[], options: CapturedRunOptions) => {
    const call: CapturedRun = {
      command,
      args: [...args],
      options,
    };

    calls.push(call);

    return typeof result === "function" ? result(call) : result;
  });

  return {
    run,
    calls,
  };
}

function structuredRequest(
  overrides: Partial<NormalizedStructuredLlmRequest<DraftOutput>> = {},
): NormalizedStructuredLlmRequest<DraftOutput> {
  return {
    provider: "claude-cli",
    purpose: "candidate_judge",
    instructions: "Return a structured draft quality summary.",
    turns: [
      {
        role: "system",
        content: "You evaluate draft quality.",
      },
      {
        role: "user",
        content: "Score this draft for concrete evidence.",
      },
    ],
    structuredOutput: {
      name: "draft_quality",
      schema: outputJsonSchema,
      strict: true,
      parser: (value: unknown) => draftOutputSchema.parse(value),
    },
    options: {
      timeoutMs: 12_345,
      outputByteLimit: 98_765,
      attempts: 1,
    },
    metadata: {
      cwd: requestSuppliedCwd,
    },
    ...overrides,
  };
}

function valueAfter(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);

  expect(index).toBeGreaterThanOrEqual(0);
  expect(args[index + 1]).toEqual(expect.any(String));

  return args[index + 1] as string;
}

function expectSafeFailure(
  result: StructuredLlmProviderResult<DraftOutput>,
  forbiddenText: readonly string[],
): void {
  expect(result.status).toBe("failed");

  const publicFailureText = JSON.stringify(result);

  for (const value of forbiddenText) {
    expect(publicFailureText).not.toContain(value);
  }
  expect(publicFailureText).not.toContain('"stack"');
  expect(publicFailureText).not.toMatch(/\bError:\s/);
  expect(publicFailureText).not.toMatch(/\bat\s+\S+\s+\(/);
}

describe("claude cli provider", () => {
  it("returns typed structured output from the structured_output envelope while result is an empty string", async () => {
    const stdout = `\n${await readFixture("draft-success-structured-output.json")}\n`;
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "claude-cli",
      output: draftFromSuccessFixture,
      requestId: expect.any(String),
      durationMs: expect.any(Number),
      completedAt: expect.any(String),
    });
    expect(runner.run).toHaveBeenCalledOnce();

    const call = runner.calls[0] as CapturedRun;
    expect(call.command).toBe("claude");
    expect(call.options).toMatchObject({
      cwd: workspaceRoot,
      timeoutMs: 12_345,
      maxStdoutBytes: 98_765,
    });
  });

  it("runs claude in print mode with the json schema, tools disabled, and no session persistence", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.command).toBe("claude");
    expect(call.args).toContain("-p");
    expect(valueAfter(call.args, "--output-format")).toBe("json");
    expect(valueAfter(call.args, "--tools")).toBe("");
    expect(call.args).toContain("--no-session-persistence");
    expect(valueAfter(call.args, "--setting-sources")).toBe("");
    // --bare breaks OAuth/keychain (verified live); it must leave zero trace.
    expect(call.args).not.toContain("--bare");
  });

  it("passes the serialized schema inline to --json-schema, never as a file path", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    const schemaArg = valueAfter(call.args, "--json-schema");
    // INLINE-ONLY: a file-path value hangs claude, so the value must be the
    // serialized JSON schema, not a filesystem path to it.
    expect(JSON.parse(schemaArg)).toEqual(outputJsonSchema);
    expect(schemaArg).not.toMatch(/^(\/|\.\/|[A-Za-z]:\\)/);
    expect(schemaArg).not.toMatch(/\.json$/);
  });

  it("passes the request instructions through --system-prompt", async () => {
    const instructions = "SYSTEM_PROMPT_SENTINEL judge the draft.";
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest({ instructions }));

    const call = runner.calls[0] as CapturedRun;
    expect(valueAfter(call.args, "--system-prompt")).toBe(instructions);
  });

  it("rides conversation turns on stdin as a role-tagged block without restating the schema", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(
      structuredRequest({
        turns: [
          { role: "system", content: "You evaluate draft quality." },
          { role: "user", content: "TURN_CONTENT_SENTINEL score this." },
        ],
      }),
    );

    const call = runner.calls[0] as CapturedRun;
    expect(call.options.stdin).toEqual(expect.any(String));
    expect(call.options.stdin).toContain("TURN_CONTENT_SENTINEL score this.");
    expect(call.options.stdin).toMatch(/\[(system|user)\]/);
    // --json-schema is the native enforcement, so the schema is NOT restated in
    // the stdin prompt block.
    expect(call.options.stdin).not.toContain('"additionalProperties"');
    expect(call.options.stdin).not.toContain(JSON.stringify(outputJsonSchema));
  });

  it("keeps request-supplied cwd-like metadata out of cwd and command arguments", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.options.cwd).toBe(workspaceRoot);
    expect(call.args).not.toContain(requestSuppliedCwd);
  });

  it("supplies the claude env allowlist as a defined set containing USER and ANTHROPIC_API_KEY over the base list", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.options.envAllowlist).toBeDefined();
    expect(Array.isArray(call.options.envAllowlist)).toBe(true);
    // Membership — not iteration order — is the observed behavior: the runner
    // copies allowlisted names that exist in process.env into a name->value map.
    expect(new Set(call.options.envAllowlist)).toEqual(new Set(expectedClaudeRunEnvAllowlist));
    expect((call.options.envAllowlist ?? []).length).toBe(expectedClaudeRunEnvAllowlist.length);
    expect(call.options).not.toHaveProperty("env");
  });

  it("fails fast with unsafe_request and never spawns when schema plus instructions exceed the inline byte bound", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    // A schema whose serialized form alone blows past the 100 KB inline bound.
    const oversizedSchema = {
      type: "object",
      additionalProperties: false,
      required: ["draft", "confidence"],
      properties: {
        draft: { type: "string", description: "x".repeat(120_000) },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    } as const;

    const result = await provider.generateStructured(
      structuredRequest({
        structuredOutput: {
          name: "draft_quality",
          schema: oversizedSchema,
          strict: true,
          parser: (value: unknown) => draftOutputSchema.parse(value),
        },
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "unsafe_request",
      retryable: false,
      message: expect.any(String),
    });
    // The guard runs BEFORE any spawn: the fake runner must never be invoked.
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("returns invalid_provider_response when the envelope reports is_error true", async () => {
    const stdout = await readFixture("provider-reported-error.json");
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "invalid_provider_response",
      retryable: false,
      message: expect.any(String),
    });
    expectSafeFailure(result, [stdout.trim()]);
  });

  it("parses a bare JSON string result candidate when structured_output is absent", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-result-string-plain.json")));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "claude-cli",
      output: draftFromSuccessFixture,
    });
  });

  it("strips a single ```json fence pair from a string result before parsing", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-result-string-fenced.json")));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "claude-cli",
      output: draftFromSuccessFixture,
    });
  });

  it("returns invalid_provider_response when stdout is empty after trimming", async () => {
    const stdout = await readFixture("empty-stdout.txt");
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "invalid_provider_response",
      retryable: false,
    });
  });

  it("returns invalid_provider_response when the envelope carries no result candidate", async () => {
    const stdout = await readFixture("missing-result.json");
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "invalid_provider_response",
      retryable: false,
    });
  });

  it("returns invalid_provider_response when stdout is not valid JSON", async () => {
    const stdout = "claude: command produced human prose, not JSON";
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "invalid_provider_response",
      retryable: false,
    });
    expectSafeFailure(result, [stdout]);
  });

  it("returns structured_output_invalid when the result candidate fails the caller output parser", async () => {
    const envelope = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      structured_output: { draft: "Confidence is the wrong type.", confidence: "high" },
    });
    const runner = fakeRunner(successProcessResult(envelope));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "structured_output_invalid",
      retryable: false,
    });
    expectSafeFailure(result, ["Expected number"]);
  });

  it("maps timeout results to retryable request_timeout failures with safe copy", async () => {
    const runner = fakeRunner(
      failedProcessResult("request_timeout", {
        retryable: true,
        timedOut: true,
        durationMs: 12_345,
      }),
    );
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "request_timeout",
      retryable: true,
      message: expect.any(String),
    });
  });

  it("maps non-zero exits without exposing raw stderr, prompt text, auth paths, or stack traces", async () => {
    const promptSentinel = "PROMPT_SENTINEL_DO_NOT_LEAK";
    const stderrSentinel = "STDERR_SENTINEL_DO_NOT_LEAK";
    const authPath = "/Users/nataly/.claude/.credentials.json";
    const stderr = [
      `fatal: ${stderrSentinel}`,
      `auth file: ${authPath}`,
      "Error: sensitive stack",
      "    at runClaude (/tmp/internal.ts:1:1)",
    ].join("\n");
    const runner = fakeRunner(
      failedProcessResult("nonzero_exit", {
        stderr,
        stderrBytes: byteLength(stderr),
        exitCode: 17,
      }),
    );
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(
      structuredRequest({
        instructions: promptSentinel,
        turns: [
          { role: "system", content: promptSentinel },
          { role: "user", content: promptSentinel },
        ],
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude-cli",
      code: "nonzero_exit",
      retryable: false,
    });
    expectSafeFailure(result, [promptSentinel, stderrSentinel, authPath, "sensitive stack"]);
  });

  it("returns a success result even when usage fields are absent from the envelope", async () => {
    const envelope = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      structured_output: draftFromSuccessFixture,
    });
    const runner = fakeRunner(successProcessResult(envelope));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "claude-cli",
      output: draftFromSuccessFixture,
    });
    expect(result).not.toHaveProperty("usage");
  });

  it("maps usage input and output tokens into the structured usage type when present", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "claude-cli",
      usage: { inputTokens: 642, outputTokens: 188 },
    });
  });

  it("appends --model <value> when the request carries a model", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(
      structuredRequest({
        options: {
          timeoutMs: 12_345,
          outputByteLimit: 98_765,
          attempts: 1,
          model: "claude-opus-4-8",
        } as NormalizedStructuredLlmRequest<DraftOutput>["options"],
      }),
    );

    const call = runner.calls[0] as CapturedRun;
    expect(valueAfter(call.args, "--model")).toBe("claude-opus-4-8");
  });

  it("omits the --model flag when the request carries no model", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-structured-output.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.args).not.toContain("--model");
  });
});

describe("claude command builder", () => {
  const builderOptions = {
    workspaceRoot,
    schema: JSON.stringify(outputJsonSchema),
    instructions: "Judge the draft and return only structured output.",
  };

  it("emits print-mode isolation flags and inline json schema, with no --bare", async () => {
    const ClaudeCommandBuilder = await loadClaudeCommandBuilder();
    const builder = new ClaudeCommandBuilder();

    const args = builder.build(builderOptions);

    expect(args).toContain("-p");
    expect(valueAfter(args, "--output-format")).toBe("json");
    expect(valueAfter(args, "--tools")).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(valueAfter(args, "--setting-sources")).toBe("");
    expect(args).not.toContain("--bare");
    // The --json-schema value is the inline serialized schema, never a file path.
    const schemaArg = valueAfter(args, "--json-schema");
    expect(JSON.parse(schemaArg)).toEqual(outputJsonSchema);
    expect(schemaArg).not.toMatch(/\.json$/);
    expect(valueAfter(args, "--system-prompt")).toBe(builderOptions.instructions);
  });

  it("omits the --model flag when no model is set", async () => {
    const ClaudeCommandBuilder = await loadClaudeCommandBuilder();
    const builder = new ClaudeCommandBuilder();

    const args = builder.build(builderOptions);

    expect(args).not.toContain("--model");
  });

  it("treats an empty-string model as absent and omits the --model flag", async () => {
    const ClaudeCommandBuilder = await loadClaudeCommandBuilder();
    const builder = new ClaudeCommandBuilder();

    const args = builder.build({ ...builderOptions, model: "" });

    expect(args).not.toContain("--model");
  });

  it("appends --model <value> exactly once when a model is set", async () => {
    const ClaudeCommandBuilder = await loadClaudeCommandBuilder();
    const builder = new ClaudeCommandBuilder();

    const args = builder.build({ ...builderOptions, model: "claude-opus-4-8" });

    expect(valueAfter(args, "--model")).toBe("claude-opus-4-8");
    expect(args.filter((arg) => arg === "--model")).toHaveLength(1);
  });
});

describe("claude cli process env allowlist", () => {
  it("extends the base allowlist with USER and ANTHROPIC_API_KEY", async () => {
    const allowlist = await loadClaudeCliProcessEnvAllowlist();

    expect(new Set(allowlist)).toEqual(new Set(expectedClaudeRunEnvAllowlist));
    expect(allowlist).toContain("USER");
    expect(allowlist).toContain("ANTHROPIC_API_KEY");
    // No duplicates: a name appears once, so the set size equals the array length.
    expect(allowlist.length).toBe(new Set(allowlist).size);
  });
});
