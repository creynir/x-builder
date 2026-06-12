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

// The exact, concrete set of parent environment variable names the cursor
// generation run must pass through to the child process. Pinned here as literals
// (NOT imported from the source constant) so the assertion survives a
// rename/relocation of the underlying allowlist while still failing if the
// effective env set ever gains or loses a variable. CURSOR_API_KEY sits on top of
// the base list; cursor's primary auth is its file-based ~/.cursor config.
const expectedCursorRunEnvAllowlist = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "CURSOR_API_KEY",
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

type CursorCliProviderConstructor = new (options: {
  runner: FakeProcessRunner;
  workspaceRoot: string;
}) => LlmProvider<DraftOutput>;

type CursorCommandBuilderInstance = {
  build: (options: {
    workspaceRoot: string;
    prompt: string;
    model?: string;
  }) => readonly string[];
};

type CursorCommandBuilderConstructor = new () => CursorCommandBuilderInstance;

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(testDir, "fixtures", "cursor-cli");
const workspaceRoot = "/tmp/x-builder-cursor-cli-provider-workspace";
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

// The decoded draft payload carried by the captured cursor success fixtures, used
// as the expected typed output once the caller parser accepts it.
const draftFromSuccessFixture = {
  draft: "Specific proof beats generic claims.",
  confidence: 0.91,
};

async function loadCursorCliProvider(): Promise<CursorCliProviderConstructor> {
  const module = (await import("../cursor-cli-provider.js")) as {
    CursorCliProvider: CursorCliProviderConstructor;
  };

  return module.CursorCliProvider;
}

async function loadCursorCommandBuilder(): Promise<CursorCommandBuilderConstructor> {
  const module = (await import("../cursor-cli-provider.js")) as {
    CursorCommandBuilder: CursorCommandBuilderConstructor;
  };

  return module.CursorCommandBuilder;
}

async function loadCursorCliProcessEnvAllowlist(): Promise<readonly string[]> {
  const module = (await import("../cursor-cli-provider.js")) as {
    cursorCliProcessEnvAllowlist: readonly string[];
  };

  return module.cursorCliProcessEnvAllowlist;
}

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8");
}

async function createProvider(runner: FakeProcessRunner): Promise<LlmProvider<DraftOutput>> {
  const CursorCliProvider = await loadCursorCliProvider();

  return new CursorCliProvider({
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
    provider: "cursor-cli",
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

describe("cursor cli provider", () => {
  it("returns typed structured output decoded from the JSON-string result envelope", async () => {
    const stdout = `\n${await readFixture("draft-success-result-string.json")}\n`;
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "cursor-cli",
      output: draftFromSuccessFixture,
      requestId: expect.any(String),
      durationMs: expect.any(Number),
      completedAt: expect.any(String),
    });
    expect(runner.run).toHaveBeenCalledOnce();

    const call = runner.calls[0] as CapturedRun;
    expect(call.command).toBe("cursor-agent");
    expect(call.options).toMatchObject({
      cwd: workspaceRoot,
      timeoutMs: 12_345,
      maxStdoutBytes: 98_765,
    });
  });

  it("runs cursor-agent with ask mode, an enabled sandbox, trust, the workspace root, and an empty stdin", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-result-string.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.command).toBe("cursor-agent");
    expect(call.args).toContain("-p");
    expect(valueAfter(call.args, "--output-format")).toBe("json");
    expect(valueAfter(call.args, "--mode")).toBe("ask");
    expect(valueAfter(call.args, "--sandbox")).toBe("enabled");
    expect(call.args).toContain("--trust");
    expect(valueAfter(call.args, "--workspace")).toBe(workspaceRoot);
    // HARD acceptance criterion: stdin is the literal empty string (NOT undefined),
    // which closes the child's stdin pipe so cursor-agent cannot hang waiting on it.
    expect(call.options.stdin).toBe("");
    expect(call.options).toHaveProperty("stdin");
  });

  it("passes the prompt envelope as the final positional argument, never as a shell command string", async () => {
    const unsafePrompt = "Summarize this; rm -rf / && echo HACKED | $(touch owned)";
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-result-string.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(
      structuredRequest({
        turns: [
          { role: "system", content: "You evaluate draft quality." },
          { role: "user", content: unsafePrompt },
        ],
      }),
    );

    const call = runner.calls[0] as CapturedRun;
    const finalArg = call.args.at(-1) as string;
    // The envelope is the LAST positional arg, carries the role-tagged turns and
    // the restated schema, and is never folded into a shell command string.
    expect(finalArg).toContain(unsafePrompt);
    expect(finalArg).toContain("draft_quality");
    expect(finalArg).toMatch(/single\s+JSON\s+object/i);
    expect(finalArg).toContain('"confidence"');
    expect(call.command).toBe("cursor-agent");
    expect(call.command).not.toContain(unsafePrompt);
    expect(call.args.indexOf(finalArg)).toBe(call.args.length - 1);
  });

  it("keeps request-supplied cwd-like metadata out of cwd and command arguments", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-result-string.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.options.cwd).toBe(workspaceRoot);
    expect(valueAfter(call.args, "--workspace")).toBe(workspaceRoot);
    expect(call.args).not.toContain(requestSuppliedCwd);
  });

  it("supplies the cursor env allowlist as a defined set containing CURSOR_API_KEY over the base list", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-result-string.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.options.envAllowlist).toBeDefined();
    expect(Array.isArray(call.options.envAllowlist)).toBe(true);
    // Membership — not iteration order — is the observed behavior: the runner
    // copies allowlisted names that exist in process.env into a name->value map.
    expect(new Set(call.options.envAllowlist)).toEqual(new Set(expectedCursorRunEnvAllowlist));
    expect((call.options.envAllowlist ?? []).length).toBe(expectedCursorRunEnvAllowlist.length);
    expect(call.options).not.toHaveProperty("env");
  });

  it("decodes a result that is already a JSON object rather than a JSON string", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-result-object.json")));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "cursor-cli",
      output: draftFromSuccessFixture,
    });
  });

  it("strips a single ```json fence pair from a string result before parsing", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-result-fenced-string.json")));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "cursor-cli",
      output: draftFromSuccessFixture,
    });
  });

  it("accepts stdout that parses directly to the schema-shaped object with no envelope (tier 2)", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-direct-schema-object.json")));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "cursor-cli",
      output: draftFromSuccessFixture,
    });
  });

  it("scans for the last balanced top-level JSON object when stdout is prose-wrapped (tier 3)", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("prose-wrapped-json.txt")));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "cursor-cli",
      output: draftFromSuccessFixture,
    });
  });

  it("returns invalid_provider_response when stdout carries no JSON object anywhere (tier 4)", async () => {
    const stdout = await readFixture("no-json-output.txt");
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "cursor-cli",
      code: "invalid_provider_response",
      retryable: false,
      message: expect.any(String),
    });
    expectSafeFailure(result, [stdout.trim()]);
  });

  it("returns invalid_provider_response when stdout is empty after trimming", async () => {
    const stdout = await readFixture("empty-stdout.txt");
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "cursor-cli",
      code: "invalid_provider_response",
      retryable: false,
    });
  });

  it("honors an is_error envelope as a provider failure before any extraction", async () => {
    const stdout = await readFixture("provider-reported-error.json");
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "cursor-cli",
      code: "invalid_provider_response",
      retryable: false,
    });
    expectSafeFailure(result, [stdout.trim()]);
  });

  it("returns structured_output_invalid when the decoded payload fails the caller output parser", async () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: JSON.stringify({ draft: "Confidence is the wrong type.", confidence: "high" }),
    });
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "cursor-cli",
      code: "structured_output_invalid",
      retryable: false,
    });
    expectSafeFailure(result, ["Expected number"]);
  });

  it("maps a runner hang surfaced through the terminator to a retryable request_timeout failure", async () => {
    const runner = fakeRunner(
      failedProcessResult("request_timeout", {
        retryable: true,
        timedOut: true,
        signal: "SIGKILL",
        durationMs: 12_345,
      }),
    );
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "cursor-cli",
      code: "request_timeout",
      retryable: true,
      message: expect.any(String),
      details: expect.objectContaining({
        provider: "cursor-cli",
        durationMs: 12_345,
      }),
    });
  });

  it("fails fast with unsafe_request and never spawns when the prompt envelope exceeds the inline byte bound", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-result-string.json")));
    const provider = await createProvider(runner);

    // A schema whose serialized form alone blows past the 100 KB inline bound,
    // which inflates the envelope (the final positional arg) past the guard.
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
      provider: "cursor-cli",
      code: "unsafe_request",
      retryable: false,
      message: expect.any(String),
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("maps non-zero exits without exposing raw stderr, prompt text, auth paths, or stack traces", async () => {
    const promptSentinel = "PROMPT_SENTINEL_DO_NOT_LEAK";
    const stderrSentinel = "STDERR_SENTINEL_DO_NOT_LEAK";
    const authPath = "/Users/nataly/.cursor/cli-config.json";
    const stderr = [
      `fatal: ${stderrSentinel}`,
      `auth file: ${authPath}`,
      "Error: sensitive stack",
      "    at runCursor (/tmp/internal.ts:1:1)",
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
      provider: "cursor-cli",
      code: "nonzero_exit",
      retryable: false,
    });
    expectSafeFailure(result, [promptSentinel, stderrSentinel, authPath, "sensitive stack"]);
  });

  it("appends --model <value> when the request carries a model", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-result-string.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(
      structuredRequest({
        options: {
          timeoutMs: 12_345,
          outputByteLimit: 98_765,
          attempts: 1,
          model: "cursor-large",
        } as NormalizedStructuredLlmRequest<DraftOutput>["options"],
      }),
    );

    const call = runner.calls[0] as CapturedRun;
    expect(valueAfter(call.args, "--model")).toBe("cursor-large");
  });

  it("omits the --model flag when the request carries no model", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("draft-success-result-string.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.args).not.toContain("--model");
  });
});

describe("cursor command builder", () => {
  const builderOptions = {
    workspaceRoot,
    prompt: "Task instructions:\nJudge the draft.\n\nStructured output contract:\nName: draft_quality",
  };

  it("emits ask-mode, enabled-sandbox, trust, and workspace flags with the prompt as the final positional arg", async () => {
    const CursorCommandBuilder = await loadCursorCommandBuilder();
    const builder = new CursorCommandBuilder();

    const args = builder.build(builderOptions);

    expect(args).toContain("-p");
    expect(valueAfter(args, "--output-format")).toBe("json");
    expect(valueAfter(args, "--mode")).toBe("ask");
    expect(valueAfter(args, "--sandbox")).toBe("enabled");
    expect(args).toContain("--trust");
    expect(valueAfter(args, "--workspace")).toBe(workspaceRoot);
    expect(args.at(-1)).toBe(builderOptions.prompt);
  });

  it("omits the --model flag when no model is set", async () => {
    const CursorCommandBuilder = await loadCursorCommandBuilder();
    const builder = new CursorCommandBuilder();

    const args = builder.build(builderOptions);

    expect(args).not.toContain("--model");
  });

  it("treats an empty-string model as absent and omits the --model flag", async () => {
    const CursorCommandBuilder = await loadCursorCommandBuilder();
    const builder = new CursorCommandBuilder();

    const args = builder.build({ ...builderOptions, model: "" });

    expect(args).not.toContain("--model");
  });

  it("appends --model <value> exactly once when a model is set", async () => {
    const CursorCommandBuilder = await loadCursorCommandBuilder();
    const builder = new CursorCommandBuilder();

    const args = builder.build({ ...builderOptions, model: "cursor-large" });

    expect(valueAfter(args, "--model")).toBe("cursor-large");
    expect(args.filter((arg) => arg === "--model")).toHaveLength(1);
  });
});

describe("cursor cli process env allowlist", () => {
  it("extends the base allowlist with CURSOR_API_KEY", async () => {
    const allowlist = await loadCursorCliProcessEnvAllowlist();

    expect(new Set(allowlist)).toEqual(new Set(expectedCursorRunEnvAllowlist));
    expect(allowlist).toContain("CURSOR_API_KEY");
    // No duplicates: a name appears once, so the set size equals the array length.
    expect(allowlist.length).toBe(new Set(allowlist).size);
  });
});
