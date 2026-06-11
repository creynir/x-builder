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

// The exact, concrete set of parent environment variable names the codex
// generation run must pass through to the child process today. Pinned here as
// literals (NOT imported from the source constant) so the assertion survives a
// rename/relocation of the underlying allowlist while still failing if the
// effective env set ever gains or loses a variable.
const expectedCodexRunEnvAllowlist = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "CODEX_SQLITE_HOME",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_CA_CERTIFICATE",
  "SSL_CERT_FILE",
  "RUST_LOG",
  "TMPDIR",
  "TMP",
  "TEMP",
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

type CodexCliProviderConstructor = new (options: {
  runner: FakeProcessRunner;
  workspaceRoot: string;
}) => LlmProvider<DraftOutput>;

type CodexCommandBuilderInstance = {
  build: (options: { workspaceRoot: string; schemaFile: string; model?: string }) => readonly string[];
};

type CodexCommandBuilderConstructor = new () => CodexCommandBuilderInstance;

async function loadCodexCommandBuilder(): Promise<CodexCommandBuilderConstructor> {
  const module = (await import("../codex-cli-provider.js")) as {
    CodexCommandBuilder: CodexCommandBuilderConstructor;
  };

  return module.CodexCommandBuilder;
}

const testDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(testDir, "fixtures", "codex-cli");
const workspaceRoot = "/tmp/x-builder-codex-cli-provider-workspace";
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

async function loadCodexCliProvider(): Promise<CodexCliProviderConstructor> {
  const modulePath = "../codex-cli-provider.js";
  const module = (await import(modulePath)) as {
    CodexCliProvider: CodexCliProviderConstructor;
  };

  return module.CodexCliProvider;
}

async function readFixture(name: string): Promise<string> {
  return readFile(join(fixturesDir, name), "utf8");
}

async function createProvider(runner: FakeProcessRunner): Promise<LlmProvider<DraftOutput>> {
  const CodexCliProvider = await loadCodexCliProvider();

  return new CodexCliProvider({
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

function expectSafeFailure(result: StructuredLlmProviderResult<DraftOutput>, forbiddenText: readonly string[]): void {
  expect(result.status).toBe("failed");

  const publicFailureText = JSON.stringify(result);

  for (const value of forbiddenText) {
    expect(publicFailureText).not.toContain(value);
  }
  expect(publicFailureText).not.toContain('"stack"');
  expect(publicFailureText).not.toMatch(/\bError:\s/);
  expect(publicFailureText).not.toMatch(/\bat\s+\S+\s+\(/);
}

describe("codex cli provider", () => {
  it("returns typed structured output and runs codex with the read-only structured-output command", async () => {
    const stdout = `\n${await readFixture("final-stdout.json")}\n`;
    let schemaFileContent: unknown;
    const runner = fakeRunner(async (call) => {
      schemaFileContent = JSON.parse(await readFile(valueAfter(call.args, "--output-schema"), "utf8"));

      return successProcessResult(stdout);
    });
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "success",
      provider: "codex-cli",
      output: {
        draft: "Specific proof beats generic claims.",
        confidence: 0.91,
      },
      requestId: expect.any(String),
      durationMs: expect.any(Number),
      completedAt: expect.any(String),
    });
    expect(runner.run).toHaveBeenCalledOnce();

    const call = runner.calls[0] as CapturedRun;
    expect(call.command).toBe("codex");
    expect(call.args[0]).toBe("exec");
    expect(call.args).toContain("--ephemeral");
    expect(valueAfter(call.args, "--sandbox")).toBe("read-only");
    expect(valueAfter(call.args, "--cd")).toBe(workspaceRoot);
    expect(valueAfter(call.args, "--color")).toBe("never");
    expect(call.args.at(-1)).toBe("-");
    expect(schemaFileContent).toEqual(outputJsonSchema);
    expect(call.options).toMatchObject({
      cwd: workspaceRoot,
      timeoutMs: 12_345,
      maxStdoutBytes: 98_765,
    });
    // Invariant 4: the codex run supplies an explicit, defined allowlist rather
    // than relying on the runner's fallback.
    expect(call.options.envAllowlist).toBeDefined();
    expect(Array.isArray(call.options.envAllowlist)).toBe(true);
    // Invariant 1: the effective child-env variable SET is exactly these 12
    // concrete names. The runner copies the allowlisted names that exist in
    // process.env into a name->value map, so membership — not iteration order —
    // is the observed behavior; a correct reordering of the allowlist must stay
    // green while dropping/adding any variable must turn red. Asserting the
    // concrete literals (not the source constant) also keeps a rename/relocation
    // of the underlying allowlist green.
    expect(new Set(call.options.envAllowlist)).toEqual(new Set(expectedCodexRunEnvAllowlist));
    // No duplicates: the allowlist carries each name once, so the set size equals
    // the captured array length (a duplicate would inflate the array without
    // changing the set).
    expect((call.options.envAllowlist ?? []).length).toBe(expectedCodexRunEnvAllowlist.length);
    expect(call.options).not.toHaveProperty("env");
    expect(call.options.stdin).toEqual(expect.any(String));
    expect(call.options.stdin).toContain("draft_quality");
    expect(call.options.stdin).toMatch(/single\s+JSON\s+object/i);
    expect(call.options.stdin).toContain('"confidence"');
  });

  it("keeps request-supplied cwd-like metadata out of cwd and command arguments", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("final-stdout.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.options.cwd).toBe(workspaceRoot);
    expect(valueAfter(call.args, "--cd")).toBe(workspaceRoot);
    expect(call.args).not.toContain(requestSuppliedCwd);
  });

  it("passes shell metacharacters through stdin prompt text without building a shell command string", async () => {
    const unsafePrompt = "Summarize this; rm -rf / && echo HACKED | $(touch owned)";
    const runner = fakeRunner(successProcessResult(await readFixture("final-stdout.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(
      structuredRequest({
        turns: [
          {
            role: "system",
            content: "You evaluate draft quality.",
          },
          {
            role: "user",
            content: unsafePrompt,
          },
        ],
      }),
    );

    const call = runner.calls[0] as CapturedRun;
    expect(Array.isArray(call.args)).toBe(true);
    expect(call.command).toBe("codex");
    expect(call.command).not.toContain(unsafePrompt);
    expect(call.args).not.toContain(unsafePrompt);
    expect(call.args.join(" ")).not.toContain(unsafePrompt);
    expect(call.options.stdin).toContain(unsafePrompt);
  });

  it.each([
    ["invalid JSON", "invalid-json.txt"],
    ["leading prose before JSON", "mixed-prose-json.txt"],
    ["trailing prose after JSON", "trailing-prose-json.txt"],
    ["JSONL event stream", "jsonl-events.txt"],
  ])("returns invalid_provider_response for %s stdout", async (_caseName, fixtureName) => {
    const stdout = await readFixture(fixtureName);
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "invalid_provider_response",
      retryable: false,
      message: expect.any(String),
    });
    expectSafeFailure(result, [stdout.trim()]);
  });

  it("returns invalid_provider_response when stdout contains more than one JSON value", async () => {
    const stdout = '{"draft":"first","confidence":0.4}\n{"draft":"second","confidence":0.5}';
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "invalid_provider_response",
      retryable: false,
    });
    expectSafeFailure(result, [stdout]);
  });

  it("returns structured_output_invalid when parsed JSON fails the caller output parser", async () => {
    const stdout = JSON.stringify({
      draft: "Confidence is the wrong type.",
      confidence: "high",
    });
    const runner = fakeRunner(successProcessResult(stdout));
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "structured_output_invalid",
      retryable: false,
      message: expect.any(String),
    });
    expectSafeFailure(result, [stdout, "Expected number"]);
  });

  it("maps timeout results to retryable request_timeout failures", async () => {
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
      provider: "codex-cli",
      code: "request_timeout",
      retryable: true,
      message: expect.any(String),
      details: expect.objectContaining({
        provider: "codex-cli",
        durationMs: 12_345,
        stdoutBytes: 0,
        stderrBytes: 0,
      }),
    });
  });

  it("maps output limit failures to output_too_large", async () => {
    const stdout = "truncated structured output";
    const runner = fakeRunner(
      failedProcessResult("output_too_large", {
        stdout,
        stdoutBytes: 2_000_001,
        stream: "stdout",
      }),
    );
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "output_too_large",
      retryable: false,
      details: expect.objectContaining({
        provider: "codex-cli",
        stdoutBytes: 2_000_001,
        stream: "stdout",
      }),
    });
    expectSafeFailure(result, [stdout]);
  });

  it("maps process start failures to process_failed without leaking process internals", async () => {
    const path = "/Users/nataly/.codex/auth.json";
    const runner = fakeRunner(
      failedProcessResult("process_failed", {
        details: {
          path,
          stack: "Error: spawn failed\n    at internal",
        },
      }),
    );
    const provider = await createProvider(runner);

    const result = await provider.generateStructured(structuredRequest());

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "process_failed",
      retryable: false,
    });
    expectSafeFailure(result, [path, "spawn failed"]);
  });

  it("maps non-zero exits without exposing raw stderr, prompt text, auth paths, or stack traces", async () => {
    const promptSentinel = "PROMPT_SENTINEL_DO_NOT_LEAK";
    const stderrSentinel = "STDERR_SENTINEL_DO_NOT_LEAK";
    const authPath = "/Users/nataly/.codex/auth.json";
    const stderr = [
      `fatal: ${stderrSentinel}`,
      `auth file: ${authPath}`,
      "Error: sensitive stack",
      "    at runCodex (/tmp/internal.ts:1:1)",
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
          {
            role: "system",
            content: promptSentinel,
          },
          {
            role: "user",
            content: promptSentinel,
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "codex-cli",
      code: "nonzero_exit",
      retryable: false,
      message: expect.any(String),
      details: expect.objectContaining({
        provider: "codex-cli",
        exitCode: 17,
        signal: null,
        stderrBytes: byteLength(stderr),
      }),
    });
    expectSafeFailure(result, [promptSentinel, stderrSentinel, authPath, "sensitive stack"]);
  });

  it("builds codex argv with no -m flag when the request carries no model", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("final-stdout.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(structuredRequest());

    const call = runner.calls[0] as CapturedRun;
    expect(call.args).not.toContain("-m");
  });

  it("appends -m <model> to codex argv when the request carries a model", async () => {
    const runner = fakeRunner(successProcessResult(await readFixture("final-stdout.json")));
    const provider = await createProvider(runner);

    await provider.generateStructured(
      structuredRequest({
        options: {
          timeoutMs: 12_345,
          outputByteLimit: 98_765,
          attempts: 1,
          model: "gpt-5.2-codex",
        } as NormalizedStructuredLlmRequest<DraftOutput>["options"],
      }),
    );

    const call = runner.calls[0] as CapturedRun;
    expect(valueAfter(call.args, "-m")).toBe("gpt-5.2-codex");
  });
});

describe("codex command builder", () => {
  const builderOptions = {
    workspaceRoot,
    schemaFile: "/tmp/x-builder-codex-schema/draft_quality.json",
  };

  // Pin the exact argv the builder produces with no model so a regression in the
  // base command is caught alongside the new model flag.
  const baselineArgv = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--cd",
    workspaceRoot,
    "--output-schema",
    builderOptions.schemaFile,
    "--color",
    "never",
    "-",
  ];

  it("produces argv byte-identical to today's codex command when no model is set", async () => {
    const CodexCommandBuilder = await loadCodexCommandBuilder();
    const builder = new CodexCommandBuilder();

    const args = builder.build(builderOptions);

    expect([...args]).toEqual(baselineArgv);
    expect(args).not.toContain("-m");
  });

  it("produces the same argv when the model is an empty string (treated as absent)", async () => {
    const CodexCommandBuilder = await loadCodexCommandBuilder();
    const builder = new CodexCommandBuilder();

    const args = builder.build({ ...builderOptions, model: "" });

    expect([...args]).toEqual(baselineArgv);
    expect(args).not.toContain("-m");
  });

  it("appends -m <model> exactly once when a model is set", async () => {
    const CodexCommandBuilder = await loadCodexCommandBuilder();
    const builder = new CodexCommandBuilder();

    const args = builder.build({ ...builderOptions, model: "gpt-5.2-codex" });

    expect(valueAfter(args, "-m")).toBe("gpt-5.2-codex");
    expect(args.filter((arg) => arg === "-m")).toHaveLength(1);
  });
});
