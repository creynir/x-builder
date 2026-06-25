import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { baseProcessEnvAllowlist } from "./process-runner.js";
import type { ProcessRunner, ProcessRunResult } from "./process-runner.js";
import { buildStructuredPromptEnvelope } from "./structured-prompt-envelope.js";
import type {
  KnownLlmProviderErrorCode,
  LlmProvider,
  LlmProviderId,
  NormalizedStructuredLlmRequest,
  StructuredLlmProviderResult,
} from "./structured-llm-service.js";

const providerId = "codex-cli";

const maxSchemaFileNameLength = 80;

// The codex CLI run inherits the provider-agnostic base allowlist plus the
// codex-specific non-secret environment variables it needs at exec time.
// Secret-bearing token env vars are intentionally not forwarded because the
// judge prompt is user-controlled draft text.
export const codexCliProcessEnvAllowlist = [
  ...baseProcessEnvAllowlist,
  "CODEX_HOME",
  "CODEX_SQLITE_HOME",
  "CODEX_CA_CERTIFICATE",
  "RUST_LOG",
] as const;

export type CodexCommandBuilderOptions = {
  workspaceRoot: string;
  schemaFile: string;
  model?: string;
};

export type CodexCliProviderOptions = {
  runner: ProcessRunner;
  workspaceRoot: string;
  commandBuilder?: CodexCommandBuilder;
};

export type CodexCliParserFailureCategory =
  | "empty_stdout"
  | "invalid_json"
  | "jsonl_event_stream"
  | "single_json_object_required";

export type CodexCliParseResult =
  | {
      status: "success";
      value: unknown;
      rawText: string;
    }
  | {
      status: "failed";
      category: CodexCliParserFailureCategory;
    };

export class CodexCommandBuilder {
  build(options: CodexCommandBuilderOptions): readonly string[] {
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--cd",
      options.workspaceRoot,
      "--output-schema",
      options.schemaFile,
      "--color",
      "never",
      // Ignore ~/.codex/config.toml so codex never loads the user's MCP
      // plugins/servers (e.g. Notion/Linear with expired OAuth), whose worker
      // crashes can intermittently take `codex exec` non-zero. Model, sandbox,
      // and output-schema are all passed explicitly above; codex auth lives in
      // auth.json (not config.toml), so the session still authenticates.
      "--ignore-user-config",
      "-",
    ];

    // Only the active provider's configured model is appended; an empty or absent
    // model leaves the argv byte-identical to the base command.
    if (options.model !== undefined && options.model.length > 0) {
      args.push("-m", options.model);
    }

    return args;
  }
}

export class CodexCliOutputParser {
  parse(stdout: string): CodexCliParseResult {
    const trimmed = stdout.trim();

    if (trimmed.length === 0) {
      return {
        status: "failed",
        category: "empty_stdout",
      };
    }

    if (isJsonlEventStream(trimmed)) {
      return {
        status: "failed",
        category: "jsonl_event_stream",
      };
    }

    let value: unknown;

    try {
      value = JSON.parse(trimmed);
    } catch {
      return {
        status: "failed",
        category: "invalid_json",
      };
    }

    if (!isJsonObject(value)) {
      return {
        status: "failed",
        category: "single_json_object_required",
      };
    }

    return {
      status: "success",
      value,
      rawText: trimmed,
    };
  }
}

export class CodexCliProvider<TProviderOutput = unknown> implements LlmProvider<TProviderOutput> {
  readonly id: LlmProviderId = providerId;

  private readonly runner: ProcessRunner;
  private readonly workspaceRoot: string;
  private readonly commandBuilder: CodexCommandBuilder;
  private readonly outputParser = new CodexCliOutputParser();

  constructor(options: CodexCliProviderOptions) {
    this.runner = options.runner;
    this.workspaceRoot = options.workspaceRoot;
    this.commandBuilder = options.commandBuilder ?? new CodexCommandBuilder();
  }

  async generateStructured<TOutput>(
    request: NormalizedStructuredLlmRequest<TOutput>,
  ): Promise<StructuredLlmProviderResult<TProviderOutput>> {
    const startedAt = Date.now();

    try {
      return await this.withSchemaFile(request, async (schemaFile) => {
        const args = this.commandBuilder.build({
          workspaceRoot: this.workspaceRoot,
          schemaFile,
          model: request.options.model,
        });
        const result = await this.runner.run("codex", args, {
          cwd: this.workspaceRoot,
          timeoutMs: request.options.timeoutMs,
          maxStdoutBytes: request.options.outputByteLimit,
          maxStderrBytes: request.options.outputByteLimit,
          stdin: buildStructuredPromptEnvelope(request),
          envAllowlist: [...codexCliProcessEnvAllowlist],
        });

        if (result.status === "failed") {
          return processFailure(result, startedAt);
        }

        const parsed = this.outputParser.parse(result.stdout);

        if (parsed.status === "failed") {
          return failure(
            "invalid_provider_response",
            "Codex CLI returned malformed structured output.",
            false,
            startedAt,
            {
              durationMs: result.durationMs,
              stdoutBytes: result.stdoutBytes,
              stderrBytes: result.stderrBytes,
              parserFailureCategory: parsed.category,
            },
          );
        }

        let output: TOutput;

        try {
          output = request.structuredOutput.parser(parsed.value);
        } catch {
          return failure(
            "structured_output_invalid",
            "Codex CLI output did not match the requested structured output contract.",
            false,
            startedAt,
            {
              durationMs: result.durationMs,
              stdoutBytes: result.stdoutBytes,
              stderrBytes: result.stderrBytes,
              parserFailureCategory: "caller_parser_rejected",
            },
          );
        }

        return {
          status: "success",
          provider: providerId,
          requestId: crypto.randomUUID(),
          output: output as unknown as TProviderOutput,
          durationMs: elapsedMs(startedAt),
          completedAt: nowIso(),
          rawText: parsed.rawText,
        };
      });
    } catch {
      return failure(
        "process_failed",
        "Codex CLI process failed before returning structured output.",
        false,
        startedAt,
      );
    }
  }

  private async withSchemaFile<TOutput, TResult>(
    request: NormalizedStructuredLlmRequest<TOutput>,
    callback: (schemaFile: string) => Promise<TResult>,
  ): Promise<TResult> {
    const schemaDir = await mkdtemp(join(tmpdir(), "x-builder-codex-schema-"));
    const schemaFile = join(schemaDir, `${safeSchemaFileBaseName(request.structuredOutput.name)}.json`);

    try {
      await writeFile(schemaFile, JSON.stringify(request.structuredOutput.schema, null, 2), "utf8");

      return await callback(schemaFile);
    } finally {
      await rm(schemaDir, {
        recursive: true,
        force: true,
      });
    }
  }
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonlEventStream = (value: string): boolean => {
  const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return lines.length > 1 && lines.every((line) => isJsonObjectString(line.trim()));
};

const isJsonObjectString = (value: string): boolean => {
  try {
    return isJsonObject(JSON.parse(value));
  } catch {
    return false;
  }
};

const safeSchemaFileBaseName = (name: string): string => {
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxSchemaFileNameLength);

  return safeName.length > 0 ? safeName : "structured-output-schema";
};

const nowIso = (): string => new Date().toISOString();

const elapsedMs = (startedAt: number): number => Math.max(0, Date.now() - startedAt);

const processFailure = <TProviderOutput>(
  result: ProcessRunResult,
  startedAt: number,
): StructuredLlmProviderResult<TProviderOutput> => {
  const code = toProviderFailureCode(result.code);
  const providerMessage = extractCodexProviderMessage(result);

  return failure(
    code,
    messageForFailureCode(code),
    result.retryable ?? code === "request_timeout",
    startedAt,
    {
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      signal: result.signal,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      ...(providerMessage ? { providerMessage } : {}),
      ...(result.timedOut ? { timedOut: true } : {}),
      ...(result.stream ? { stream: result.stream } : {}),
    },
  );
};

const extractCodexProviderMessage = (result: ProcessRunResult): string | undefined => {
  const output = `${result.stderr}\n${result.stdout}`;
  const jsonMessages = [...output.matchAll(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
  const rawMessage =
    jsonMessages
      .map((match) => {
        const encodedMessage = match[1];

        if (encodedMessage === undefined) {
          return undefined;
        }

        try {
          return JSON.parse(`"${encodedMessage}"`) as string;
        } catch {
          return encodedMessage;
        }
      })
      .find((message): message is string => message !== undefined && message.trim().length > 0) ??
    result.message;

  if (rawMessage === undefined) {
    return undefined;
  }

  const sanitized = rawMessage
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\/Users\/[^\s"']+/g, "[path]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized.length > 240 ? `${sanitized.slice(0, 237)}...` : sanitized;
};

const toProviderFailureCode = (code: ProcessRunResult["code"]): KnownLlmProviderErrorCode => {
  if (
    code === "request_timeout" ||
    code === "process_failed" ||
    code === "nonzero_exit" ||
    code === "output_too_large"
  ) {
    return code;
  }

  return "process_failed";
};

const messageForFailureCode = (code: KnownLlmProviderErrorCode): string => {
  switch (code) {
    case "request_timeout":
      return "Codex CLI request timed out.";
    case "nonzero_exit":
      return "Codex CLI exited with a non-zero status.";
    case "output_too_large":
      return "Codex CLI output exceeded the configured byte limit.";
    case "process_failed":
      return "Codex CLI process failed before returning structured output.";
    default:
      return "Codex CLI request failed.";
  }
};

const failure = <TProviderOutput>(
  code: KnownLlmProviderErrorCode,
  message: string,
  retryable: boolean,
  startedAt: number,
  details: Record<string, unknown> = {},
): StructuredLlmProviderResult<TProviderOutput> => ({
  status: "failed",
  provider: providerId,
  requestId: crypto.randomUUID(),
  code,
  message,
  retryable,
  durationMs: elapsedMs(startedAt),
  completedAt: nowIso(),
  details: {
    provider: providerId,
    ...details,
  },
});
