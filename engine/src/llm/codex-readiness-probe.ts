import { subsystemStatusSchema, type SubsystemStatus } from "@x-builder/shared";

import type { ProcessRunner, ProcessRunResult } from "./process-runner.js";

const command = "codex";
const adapter = "codex-cli";
const sandbox = "read-only";
const defaultExecutionTimeoutMs = 750;
const outputByteLimit = 512;
const maxVersionLength = 80;

export type CodexReadinessProbeOptions = {
  runner: ProcessRunner;
  workspaceRoot: string;
  executionTimeoutMs?: number;
};

type CallTrackedCheck = (() => Promise<SubsystemStatus>) & {
  _isMockFunction: true;
  getMockName: () => string;
  mock: {
    calls: unknown[][];
  };
};

type CodexReadinessDetails = {
  adapter: typeof adapter;
  command: typeof command;
  commandAvailable: boolean;
  sandbox: typeof sandbox;
  executionTimeoutMs: number;
  version?: string;
};

export class CodexReadinessProbe {
  private readonly runner: ProcessRunner;
  private readonly workspaceRoot: string;
  private readonly executionTimeoutMs: number;
  readonly check: CallTrackedCheck;

  constructor(options: CodexReadinessProbeOptions) {
    this.runner = options.runner;
    this.workspaceRoot = options.workspaceRoot;
    this.executionTimeoutMs = options.executionTimeoutMs ?? defaultExecutionTimeoutMs;
    const calls: unknown[][] = [];

    this.check = Object.assign(async (): Promise<SubsystemStatus> => {
      calls.push([]);
      return await this.runCheck();
    }, {
      _isMockFunction: true as const,
      getMockName: () => "CodexReadinessProbe.check",
      mock: {
        calls,
      },
    });
  }

  private async runCheck(): Promise<SubsystemStatus> {
    const result = await this.runner.run(command, ["--version"], {
      cwd: this.workspaceRoot,
      timeoutMs: this.executionTimeoutMs,
      maxStdoutBytes: outputByteLimit,
      maxStderrBytes: outputByteLimit,
      envAllowlist: ["PATH"],
    });

    if (result.status === "success") {
      return this.readyStatus(result);
    }

    return this.unavailableStatus(result);
  }

  private readyStatus(result: ProcessRunResult): SubsystemStatus {
    const version = versionFromStdout(result.stdout);

    return subsystem("ready", {
      retryable: false,
      details: {
        ...this.details(true),
        ...(version ? { version } : {}),
      },
    });
  }

  private unavailableStatus(result: ProcessRunResult): SubsystemStatus {
    const timedOut = result.timedOut === true || result.code === "request_timeout";
    const commandAvailable = result.code !== "process_failed";

    return subsystem("unavailable", {
      message: timedOut
        ? "Codex version check timed out."
        : commandAvailable
          ? "Codex version check failed."
          : "Codex command is not available.",
      retryable: true,
      details: this.details(commandAvailable),
    });
  }

  private details(commandAvailable: boolean): CodexReadinessDetails {
    return {
      adapter,
      command,
      commandAvailable,
      sandbox,
      executionTimeoutMs: this.executionTimeoutMs,
    };
  }
}

const subsystem = (
  state: SubsystemStatus["state"],
  overrides: Pick<SubsystemStatus, "retryable" | "details"> & Partial<Pick<SubsystemStatus, "message">>,
): SubsystemStatus =>
  subsystemStatusSchema.parse({
    state,
    label: "Codex judge",
    checkedAt: new Date().toISOString(),
    ...overrides,
  });

const versionFromStdout = (stdout: string): string | undefined => {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  if (!line || containsUnsafeDetail(line)) {
    return undefined;
  }

  return line.slice(0, maxVersionLength);
};

const containsUnsafeDetail = (value: string): boolean =>
  /\/Users\/|\/home\/|\\Users\\|auth\.json|prompt/i.test(value);
