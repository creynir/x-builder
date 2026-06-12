import {
  subsystemStatusSchema,
  type JudgeProviderId,
  type SubsystemStatus,
} from "@x-builder/shared";

import type { ProcessRunner, ProcessRunResult } from "./process-runner.js";

const defaultExecutionTimeoutMs = 750;
const outputByteLimit = 512;
const maxVersionLength = 80;

// The per-provider readiness contract the parameterized probe consumes. A spec
// fully describes how to run a provider's cheap `<command> --version` check and
// the surfaces (label/adapter/sandbox) the resulting status carries.
export type ProviderReadinessSpec = {
  command: string;
  adapter: JudgeProviderId;
  label: string;
  sandbox: string;
};

export type CliReadinessProbeOptions = {
  spec: ProviderReadinessSpec;
  runner: ProcessRunner;
  workspaceRoot: string;
  executionTimeoutMs?: number;
};

type CliReadinessDetails = {
  adapter: JudgeProviderId;
  command: string;
  commandAvailable: boolean;
  sandbox: string;
  executionTimeoutMs: number;
  version?: string;
};

export class CliReadinessProbe {
  private readonly spec: ProviderReadinessSpec;
  private readonly runner: ProcessRunner;
  private readonly workspaceRoot: string;
  private readonly executionTimeoutMs: number;

  constructor(options: CliReadinessProbeOptions) {
    this.spec = options.spec;
    this.runner = options.runner;
    this.workspaceRoot = options.workspaceRoot;
    this.executionTimeoutMs = options.executionTimeoutMs ?? defaultExecutionTimeoutMs;
  }

  async check(): Promise<SubsystemStatus> {
    const result = await this.runner.run(this.spec.command, ["--version"], {
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

    return this.subsystem("ready", {
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

    const capitalize = (s: string) => (s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);

    return this.subsystem("unavailable", {
      message: timedOut
        ? `${capitalize(this.spec.command)} version check timed out.`
        : commandAvailable
          ? `${capitalize(this.spec.command)} version check failed.`
          : `${capitalize(this.spec.command)} command is not available.`,
      retryable: true,
      details: this.details(commandAvailable),
    });
  }

  private details(commandAvailable: boolean): CliReadinessDetails {
    return {
      adapter: this.spec.adapter,
      command: this.spec.command,
      commandAvailable,
      sandbox: this.spec.sandbox,
      executionTimeoutMs: this.executionTimeoutMs,
    };
  }

  private subsystem(
    state: SubsystemStatus["state"],
    overrides: Pick<SubsystemStatus, "retryable" | "details"> &
      Partial<Pick<SubsystemStatus, "message">>,
  ): SubsystemStatus {
    return subsystemStatusSchema.parse({
      state,
      label: this.spec.label,
      checkedAt: new Date().toISOString(),
      ...overrides,
    });
  }
}

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
