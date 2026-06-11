import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { KnownLlmProviderErrorCode } from "./structured-llm-service.js";

export const baseProcessEnvAllowlist = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SSL_CERT_FILE"] as const;

export type ProcessEnvAllowlistName = (typeof baseProcessEnvAllowlist)[number] | (string & Record<never, never>);

export type ProcessRunOptions = {
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  stdin?: string;
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
const terminationGraceMs = 100;
const forcedSettlementGraceMs = 500;

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
  const allowlist = options.envAllowlist ?? baseProcessEnvAllowlist;

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

type ProcessOutput = {
  stdout: BoundedOutput;
  stderr: BoundedOutput;
};

type SpawnProcessResult =
  | {
      status: "started";
      child: ChildProcessWithoutNullStreams;
    }
  | {
      status: "failed";
      result: ProcessRunResult;
    };

const createProcessOutput = (options: ProcessRunOptions): ProcessOutput => {
  const normalizeOutputText = logicalCwdOutputNormalizer(options.cwd);

  return {
    stdout: new BoundedOutput(options.maxStdoutBytes, normalizeOutputText),
    stderr: new BoundedOutput(options.maxStderrBytes, normalizeOutputText),
  };
};

const spawnProcess = (
  command: string,
  args: readonly string[],
  options: ProcessRunOptions,
  output: ProcessOutput,
  startedAt: number,
): SpawnProcessResult => {
  try {
    return {
      status: "started",
      child: spawn(command, [...args], {
        cwd: options.cwd,
        env: buildChildEnv(options),
        shell: false,
        stdio: "pipe",
      }),
    };
  } catch (error) {
    return {
      status: "failed",
      result: failureResult(
        {
          code: "process_failed",
          retryable: false,
          message: "Process failed to start.",
          details: processFailedDetails(error as NodeJS.ErrnoException),
        },
        startedAt,
        output.stdout,
        output.stderr,
        null,
        null,
      ),
    };
  }
};

class ProcessTerminator {
  private terminationRequested = false;
  private sigkillTimer: ReturnType<typeof setTimeout> | undefined;
  private forcedSettleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly forceSettle: () => void,
  ) {}

  request(): void {
    if (this.terminationRequested) {
      return;
    }

    this.terminationRequested = true;
    this.child.kill("SIGTERM");
    this.sigkillTimer = setTimeout(this.escalate, terminationGraceMs);
  }

  cleanup(): void {
    if (this.sigkillTimer) {
      clearTimeout(this.sigkillTimer);
    }

    if (this.forcedSettleTimer) {
      clearTimeout(this.forcedSettleTimer);
    }
  }

  private readonly escalate = (): void => {
    this.child.kill("SIGKILL");
    this.forcedSettleTimer ??= setTimeout(this.forceSettle, forcedSettlementGraceMs);
  };
}

class ProcessLifecycle {
  private pendingFailure: PendingFailure | undefined;
  private exitCode: number | null = null;
  private signal: NodeJS.Signals | null = null;
  private settled = false;
  private outputCaptureStopped = false;
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly terminator: ProcessTerminator;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly options: ProcessRunOptions,
    private readonly output: ProcessOutput,
    private readonly startedAt: number,
    private readonly resolve: (result: ProcessRunResult) => void,
  ) {
    this.terminator = new ProcessTerminator(this.child, this.forceSettle);
    this.timeout = setTimeout(() => {
      this.terminate({
        code: "request_timeout",
        retryable: true,
        message: "Process exceeded its timeout.",
        timedOut: true,
      });
    }, this.options.timeoutMs);
  }

  start(): void {
    this.child.stdout.on("data", this.handleStdout);
    this.child.stderr.on("data", this.handleStderr);
    this.child.on("error", this.handleError);
    this.child.on("exit", this.handleExit);
    this.child.on("close", this.handleClose);
  }

  private readonly handleStdout = (chunk: Buffer): void => {
    this.captureOutput("stdout", chunk);
  };

  private readonly handleStderr = (chunk: Buffer): void => {
    this.captureOutput("stderr", chunk);
  };

  private captureOutput(stream: OutputStreamName, chunk: Buffer): void {
    if (this.settled || this.outputCaptureStopped) {
      return;
    }

    const output = this.output[stream];
    const maxBytes = stream === "stdout" ? this.options.maxStdoutBytes : this.options.maxStderrBytes;

    if (output.append(chunk)) {
      this.terminate({
        code: "output_too_large",
        retryable: false,
        message: `Process ${stream} exceeded its byte limit.`,
        stream,
        details: {
          maxBytes,
        },
      });
    }
  }

  private terminate(failure: PendingFailure): void {
    this.pendingFailure ??= failure;
    this.stopOutputCapture();
    this.terminator.request();
  }

  private stopOutputCapture(): void {
    if (this.outputCaptureStopped) {
      return;
    }

    this.outputCaptureStopped = true;
    this.child.stdout.off("data", this.handleStdout);
    this.child.stderr.off("data", this.handleStderr);
    this.child.stdout.pause();
    this.child.stderr.pause();
  }

  private readonly handleError = (error: NodeJS.ErrnoException): void => {
    this.pendingFailure ??= {
      code: "process_failed",
      retryable: false,
      message: "Process failed to start.",
      details: processFailedDetails(error),
    };
    this.settle();
  };

  private readonly handleExit = (code: number | null, childSignal: NodeJS.Signals | null): void => {
    this.exitCode = code;
    this.signal = childSignal;
  };

  private readonly handleClose = (code: number | null, childSignal: NodeJS.Signals | null): void => {
    this.exitCode = code;
    this.signal = childSignal;
    this.settle();
  };

  private readonly forceSettle = (): void => {
    // The child did not emit "close" after SIGTERM + SIGKILL within the grace
    // window. Before we abandon the wait and resolve, make a final best-effort
    // kill and release its stdio so we do not leak file descriptors / a live
    // process behind a resolved promise.
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
    }

    this.child.stdout.destroy();
    this.child.stderr.destroy();
    this.child.stdin.destroy();
    this.settle();
  };

  private settle(): void {
    if (this.settled) {
      return;
    }

    this.settled = true;
    this.cleanup();
    this.resolve(this.result());
  }

  private result(): ProcessRunResult {
    if (this.pendingFailure) {
      const metadata = failureExitMetadata(this.pendingFailure, this.exitCode, this.signal);

      return failureResult(
        this.pendingFailure,
        this.startedAt,
        this.output.stdout,
        this.output.stderr,
        metadata.exitCode,
        metadata.signal,
      );
    }

    if (this.exitCode === 0) {
      return successResult(this.startedAt, this.output.stdout, this.output.stderr, this.exitCode, this.signal);
    }

    return failureResult(
      nonzeroExitFailure(this.exitCode, this.signal),
      this.startedAt,
      this.output.stdout,
      this.output.stderr,
      this.exitCode,
      this.signal,
    );
  }

  private cleanup(): void {
    clearTimeout(this.timeout);
    this.terminator.cleanup();

    this.child.off("error", this.handleError);
    this.child.off("exit", this.handleExit);
    this.child.off("close", this.handleClose);
    this.stopOutputCapture();
  }
}

const waitForProcessResult = (
  child: ChildProcessWithoutNullStreams,
  options: ProcessRunOptions,
  output: ProcessOutput,
  startedAt: number,
): Promise<ProcessRunResult> =>
  new Promise((resolve) => {
    new ProcessLifecycle(child, options, output, startedAt, resolve).start();
  });

const writeProcessStdin = (child: ChildProcessWithoutNullStreams, stdin: string | undefined): void => {
  if (stdin === undefined) {
    return;
  }

  child.stdin.on("error", () => undefined);
  child.stdin.end(stdin);
};

export class NodeProcessRunner implements ProcessRunner {
  async run(command: string, args: readonly string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
    const startedAt = Date.now();
    const output = createProcessOutput(options);
    const process = spawnProcess(command, args, options, output, startedAt);

    if (process.status === "failed") {
      return process.result;
    }

    writeProcessStdin(process.child, options.stdin);

    return await waitForProcessResult(process.child, options, output, startedAt);
  }
}
