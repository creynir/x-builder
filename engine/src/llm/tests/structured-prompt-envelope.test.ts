import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type {
  LlmProvider,
  NormalizedStructuredLlmRequest,
} from "../structured-llm-service.js";

// The codex prompt is extracted verbatim into a shared engine helper
// (buildStructuredPromptEnvelope) consumed by BOTH codex and cursor. Codex must
// stay BYTE-IDENTICAL: this expected string is the exact prompt the codex
// provider produced before the extraction, reconstructed independently here so a
// drift in the shared helper or in codex's wiring turns the snapshot red.
const expectedCodexPromptEnvelope = [
  "Task instructions:",
  "Judge the draft and return only structured output.",
  "",
  "Conversation:",
  "[system]\nYou evaluate draft quality.",
  "[user]\nScore this draft for concrete evidence.",
  "",
  "Structured output contract:",
  "Name: draft_quality",
  "Strict: true",
  "Return exactly one single JSON object that conforms to this JSON Schema.",
  "Do not include Markdown, code fences, prose before or after JSON, JSONL events, or additional JSON values.",
  JSON.stringify(
    {
      type: "object",
      additionalProperties: false,
      required: ["draft", "confidence"],
      properties: {
        draft: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    null,
    2,
  ),
].join("\n");

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
  envAllowlist?: readonly string[];
};

type CapturedRun = {
  command: string;
  args: readonly string[];
  options: CapturedRunOptions;
};

type FakeProcessResult = {
  status: "success" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
};

type FakeProcessRunner = {
  run: ReturnType<typeof vi.fn>;
  calls: CapturedRun[];
};

type CodexCliProviderConstructor = new (options: {
  runner: FakeProcessRunner;
  workspaceRoot: string;
}) => LlmProvider<DraftOutput>;

type BuildStructuredPromptEnvelope = <TOutput>(
  request: NormalizedStructuredLlmRequest<TOutput>,
) => string;

const testDir = dirname(fileURLToPath(import.meta.url));
const codexFixturesDir = join(testDir, "fixtures", "codex-cli");
const workspaceRoot = "/tmp/x-builder-structured-prompt-envelope-workspace";

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

async function loadBuildStructuredPromptEnvelope(): Promise<BuildStructuredPromptEnvelope> {
  const module = (await import("../structured-prompt-envelope.js")) as {
    buildStructuredPromptEnvelope: BuildStructuredPromptEnvelope;
  };

  return module.buildStructuredPromptEnvelope;
}

async function loadCodexCliProvider(): Promise<CodexCliProviderConstructor> {
  const module = (await import("../codex-cli-provider.js")) as {
    CodexCliProvider: CodexCliProviderConstructor;
  };

  return module.CodexCliProvider;
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

function fakeRunner(result: FakeProcessResult): FakeProcessRunner {
  const calls: CapturedRun[] = [];
  const run = vi.fn(async (command: string, args: readonly string[], options: CapturedRunOptions) => {
    calls.push({ command, args: [...args], options });

    return result;
  });

  return { run, calls };
}

function structuredRequest(): NormalizedStructuredLlmRequest<DraftOutput> {
  return {
    provider: "codex-cli",
    purpose: "candidate_judge",
    instructions: "Judge the draft and return only structured output.",
    turns: [
      { role: "system", content: "You evaluate draft quality." },
      { role: "user", content: "Score this draft for concrete evidence." },
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
    metadata: {},
  };
}

describe("buildStructuredPromptEnvelope shared helper", () => {
  it("produces the verbatim codex prompt envelope shape (instructions, role-tagged turns, restated contract, inline schema)", async () => {
    const buildStructuredPromptEnvelope = await loadBuildStructuredPromptEnvelope();

    const envelope = buildStructuredPromptEnvelope(structuredRequest());

    // Byte-identical snapshot of the exact pre-extraction codex prompt string.
    expect(envelope).toBe(expectedCodexPromptEnvelope);
  });

  it("restates Strict as false when the structured output is not strict", async () => {
    const buildStructuredPromptEnvelope = await loadBuildStructuredPromptEnvelope();
    const request = structuredRequest();

    const envelope = buildStructuredPromptEnvelope({
      ...request,
      structuredOutput: { ...request.structuredOutput, strict: false },
    });

    expect(envelope).toContain("Strict: false");
    expect(envelope).not.toContain("Strict: true");
  });
});

describe("codex prompt remains byte-identical after the envelope extraction", () => {
  it("emits the exact codex prompt envelope on stdin, unchanged by the shared helper", async () => {
    const runner = fakeRunner(
      successProcessResult(await readFile(join(codexFixturesDir, "final-stdout.json"), "utf8")),
    );
    const CodexCliProvider = await loadCodexCliProvider();
    const provider = new CodexCliProvider({ runner, workspaceRoot });

    await provider.generateStructured(structuredRequest());

    expect(runner.run).toHaveBeenCalledOnce();
    const call = runner.calls[0] as CapturedRun;
    // The codex provider passes its prompt via stdin; it must equal the extracted
    // helper's output exactly, proving the extraction changed nothing for codex.
    expect(call.options.stdin).toBe(expectedCodexPromptEnvelope);
  });

  it("emits the same prompt the shared helper produces for the same request", async () => {
    const buildStructuredPromptEnvelope = await loadBuildStructuredPromptEnvelope();
    const runner = fakeRunner(
      successProcessResult(await readFile(join(codexFixturesDir, "final-stdout.json"), "utf8")),
    );
    const CodexCliProvider = await loadCodexCliProvider();
    const provider = new CodexCliProvider({ runner, workspaceRoot });
    const request = structuredRequest();

    await provider.generateStructured(request);

    const call = runner.calls[0] as CapturedRun;
    expect(call.options.stdin).toBe(buildStructuredPromptEnvelope(request));
  });
});
