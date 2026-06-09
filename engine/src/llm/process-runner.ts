import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { KnownLlmProviderErrorCode } from "./structured-llm-service.js";

export const defaultProcessEnvAllowlist = [
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

export type ProcessEnvAllowlistName = (typeof defaultProcessEnvAllowlist)[number] | (string & Record<never, never>);

export type ProcessRunOptions = {
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  env?: Record<string, string>;
  envAllowlist?: readonly ProcessEnvAllowlistName[];
};

export type ProcessRunFailureCode = Extract<
  KnownLlmProviderErrorCode,
  "request_timeout" | "process_failed" | "nonzero_exit" | "output_too_large"
>;

export type ProcessRunResult = {
  status: "success" | "failed";
  code?: ProcessRunFailureCode;
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

export interface ProcessRunner {
  run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult>;
}

type OutputStreamName = "stdout" | "stderr";

type PendingFailure = {
  code: ProcessRunFailureCode;
  retryable: boolean;
  message: string;
  timedOut?: boolean;
  stream?: OutputStreamName;
  details?: Record<string, unknown>;
};

class BoundedOutput {
  private readonly chunks: Buffer[] = [];
  private byteCount = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly normalizeText: (value: string) => string,
  ) {}

  append(chunk: Buffer): boolean {
    const previousByteCount = this.byteCount;
    this.byteCount += chunk.byteLength;

    if (previousByteCount < this.maxBytes) {
      this.chunks.push(chunk.subarray(0, this.maxBytes - previousByteCount));
    }

    return this.byteCount > this.maxBytes;
  }

  text(): string {
    return this.normalizeText(Buffer.concat(this.chunks).toString("utf8"));
  }

  bytes(): number {
    return this.byteCount;
  }
}

const elapsedMs = (startedAt: number): number => Math.max(0, Date.now() - startedAt);

const logicalCwdOutputNormalizer = (cwd: string): ((value: string) => string) => {
  if (process.platform !== "darwin" || !cwd.startsWith("/var/")) {
    return (value) => value;
  }

  const darwinPhysicalCwd = `/private${cwd}`;

  return (value) => value.replaceAll(darwinPhysicalCwd, cwd);
};

const buildChildEnv = (options: ProcessRunOptions): NodeJS.ProcessEnv => {
  if (options.env) {
    return { ...options.env };
  }

  const env: NodeJS.ProcessEnv = {};
  const allowlist = options.envAllowlist ?? defaultProcessEnvAllowlist;

  for (const name of allowlist) {
    const value = process.env[name];

    if (value !== undefined) {
      env[name] = value;
    }
  }

  return env;
};

const processFailedDetails = (error: NodeJS.ErrnoException): Record<string, unknown> => ({
  ...(error.code ? { errorCode: error.code } : {}),
  ...(error.errno ? { errno: error.errno } : {}),
  ...(error.syscall ? { syscall: error.syscall } : {}),
  ...(error.path ? { path: error.path } : {}),
});

const failureResult = (
  failure: PendingFailure,
  startedAt: number,
  stdout: BoundedOutput,
  stderr: BoundedOutput,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): ProcessRunResult => ({
  status: "failed",
  code: failure.code,
  retryable: failure.retryable,
  stdout: stdout.text(),
  stderr: stderr.text(),
  exitCode,
  signal,
  durationMs: elapsedMs(startedAt),
  stdoutBytes: stdout.bytes(),
  stderrBytes: stderr.bytes(),
  ...(failure.timedOut ? { timedOut: true } : {}),
  ...(failure.stream ? { stream: failure.stream } : {}),
  message: failure.message,
  ...(failure.details ? { details: failure.details } : {}),
});

const failureExitMetadata = (
  failure: PendingFailure,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): { exitCode: number | null; signal: NodeJS.Signals | null } => {
  if (failure.code === "process_failed") {
    return {
      exitCode: null,
      signal: null,
    };
  }

  return {
    exitCode,
    signal,
  };
};

const successResult = (
  startedAt: number,
  stdout: BoundedOutput,
  stderr: BoundedOutput,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): ProcessRunResult => ({
  status: "success",
  stdout: stdout.text(),
  stderr: stderr.text(),
  exitCode,
  signal,
  durationMs: elapsedMs(startedAt),
  stdoutBytes: stdout.bytes(),
  stderrBytes: stderr.bytes(),
});

const nonzeroExitFailure = (exitCode: number | null, signal: NodeJS.Signals | null): PendingFailure => ({
  code: "nonzero_exit",
  retryable: false,
  message: "Process exited with a non-zero status.",
  details: {
    exitCode,
    signal,
  },
});

export class NodeProcessRunner implements ProcessRunner {
  async run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
    const startedAt = Date.now();
    const normalizeOutputText = logicalCwdOutputNormalizer(options.cwd);
    const stdout = new BoundedOutput(options.maxStdoutBytes, normalizeOutputText);
    const stderr = new BoundedOutput(options.maxStderrBytes, normalizeOutputText);
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: buildChildEnv(options),
        shell: false,
        stdio: "pipe",
      });
    } catch (error) {
      return failureResult(
        {
          code: "process_failed",
          retryable: false,
          message: "Process failed to start.",
          details: processFailedDetails(error as NodeJS.ErrnoException),
        },
        startedAt,
        stdout,
        stderr,
        null,
        null,
      );
    }

    return await new Promise<ProcessRunResult>((resolve) => {
      let pendingFailure: PendingFailure | undefined;
      let exitCode: number | null = null;
      let signal: NodeJS.Signals | null = null;
      let settled = false;

      const timeout = setTimeout(() => {
        pendingFailure ??= {
          code: "request_timeout",
          retryable: true,
          message: "Process exceeded its timeout.",
          timedOut: true,
        };
        child.kill("SIGTERM");
      }, options.timeoutMs);

      const settle = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (pendingFailure) {
          const metadata = failureExitMetadata(pendingFailure, exitCode, signal);

          resolve(failureResult(pendingFailure, startedAt, stdout, stderr, metadata.exitCode, metadata.signal));
          return;
        }

        if (exitCode === 0) {
          resolve(successResult(startedAt, stdout, stderr, exitCode, signal));
          return;
        }

        resolve(failureResult(nonzeroExitFailure(exitCode, signal), startedAt, stdout, stderr, exitCode, signal));
      };

      const terminateForOutputCap = (stream: OutputStreamName): void => {
        pendingFailure ??= {
          code: "output_too_large",
          retryable: false,
          message: `Process ${stream} exceeded its byte limit.`,
          stream,
        };
        child.kill("SIGTERM");
      };

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.append(chunk)) {
          terminateForOutputCap("stdout");
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.append(chunk)) {
          terminateForOutputCap("stderr");
        }
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        pendingFailure ??= {
          code: "process_failed",
          retryable: false,
          message: "Process failed to start.",
          details: processFailedDetails(error),
        };
      });

      child.on("exit", (code, childSignal) => {
        exitCode = code;
        signal = childSignal;
      });

      child.on("close", (code, childSignal) => {
        exitCode = code;
        signal = childSignal;
        settle();
      });
    });
  }
}
