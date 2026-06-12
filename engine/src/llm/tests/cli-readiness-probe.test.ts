import { describe, expect, it, vi } from "vitest";
import { subsystemStatusSchema, type SubsystemStatus } from "@x-builder/shared";

import {
  baseProcessEnvAllowlist,
  type ProcessRunner,
  type ProcessRunOptions,
  type ProcessRunResult,
} from "../process-runner.js";

// The codex provider's readiness contract, expressed as a spec the parameterized
// probe consumes. The probe must produce byte-identical details/labels to the
// pre-change CodexReadinessProbe for this exact spec.
const codexReadinessSpec = {
  command: "codex",
  adapter: "codex-cli" as const,
  label: "Codex judge",
  sandbox: "read-only" as const,
};

type ProviderReadinessSpec = {
  command: string;
  adapter: "codex-cli" | "claude-cli" | "cursor-cli";
  label: string;
  sandbox: string;
};

type CliReadinessProbeConstructor = new (options: {
  spec: ProviderReadinessSpec;
  runner: ProcessRunner;
  workspaceRoot: string;
  executionTimeoutMs?: number;
}) => { check: () => Promise<SubsystemStatus> };

type CapturedProcessRun = {
  command: string;
  args: readonly string[];
  options: ProcessRunOptions;
};

type FakeProcessRunner = ProcessRunner & {
  calls: CapturedProcessRun[];
};

const workspaceRoot = "/tmp/x-builder-cli-readiness-workspace";
const executionTimeoutMs = 321;

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

async function loadCliReadinessProbe(): Promise<CliReadinessProbeConstructor> {
  const module = (await import("../cli-readiness-probe.js")) as {
    CliReadinessProbe: CliReadinessProbeConstructor;
  };

  return module.CliReadinessProbe;
}

const fakeProcessRunner = (
  handler: (call: CapturedProcessRun) => Promise<ProcessRunResult> | ProcessRunResult,
): FakeProcessRunner => {
  const calls: CapturedProcessRun[] = [];

  return {
    calls,
    run: vi.fn(async (command, args, options) => {
      const call = { command, args, options };
      calls.push(call);

      return handler(call);
    }),
  };
};

const successfulProcessResult = (
  stdout: string,
  overrides: Partial<ProcessRunResult> = {},
): ProcessRunResult => {
  const stderr = overrides.stderr ?? "";

  return {
    status: "success",
    stdout,
    stderr,
    exitCode: 0,
    signal: null,
    durationMs: 4,
    stdoutBytes: byteLength(stdout),
    stderrBytes: byteLength(stderr),
    ...overrides,
  };
};

const failedProcessResult = (
  code: ProcessRunResult["code"],
  overrides: Partial<ProcessRunResult> = {},
): ProcessRunResult => {
  const stdout = overrides.stdout ?? "";
  const stderr = overrides.stderr ?? "";

  return {
    status: "failed",
    code,
    retryable: overrides.retryable ?? false,
    stdout,
    stderr,
    exitCode: overrides.exitCode ?? null,
    signal: overrides.signal ?? null,
    durationMs: overrides.durationMs ?? 4,
    stdoutBytes: byteLength(stdout),
    stderrBytes: byteLength(stderr),
    ...overrides,
  };
};

const createProbe = async (
  runner: ProcessRunner,
  options: { executionTimeoutMs?: number } = {},
) => {
  const CliReadinessProbe = await loadCliReadinessProbe();

  return new CliReadinessProbe({
    spec: codexReadinessSpec,
    runner,
    workspaceRoot,
    executionTimeoutMs: options.executionTimeoutMs ?? executionTimeoutMs,
  });
};

describe("CliReadinessProbe with the codex readiness spec", () => {
  it("runs the spec command with a cheap --version probe under the codex execution bounds", async () => {
    const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));
    const probe = await createProbe(runner);

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(runner.run).toHaveBeenCalledOnce();
    const [call] = runner.calls;
    if (!call) {
      throw new Error("Expected the readiness probe to invoke the fake process runner.");
    }
    expect(call.command).toBe("codex");
    expect(call.args).toEqual(["--version"]);
    expect(call.args).not.toContain("exec");
    expect(call.args).not.toContain("--output-schema");
    expect(call.options).toMatchObject({
      cwd: workspaceRoot,
      timeoutMs: executionTimeoutMs,
      maxStdoutBytes: 512,
      maxStderrBytes: 512,
      // The readiness probe must run the version check under the provider-neutral
      // base env allowlist, not a PATH-only env. cursor-agent's launcher needs
      // HOME ("HOME: unbound variable" crash), so a PATH-only readiness env
      // false-negatives Cursor while judging itself works.
      envAllowlist: [...baseProcessEnvAllowlist],
    });
    // Explicit regression guard: HOME must be in the readiness env (see above).
    expect(call.options.envAllowlist).toContain("HOME");
    expect(call.options).not.toHaveProperty("stdin");
    expect(status.state).toBe("ready");
  });

  it("defaults the execution timeout to 750ms when none is supplied", async () => {
    const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));
    const CliReadinessProbe = await loadCliReadinessProbe();
    const probe = new CliReadinessProbe({
      spec: codexReadinessSpec,
      runner,
      workspaceRoot,
    });

    const status = subsystemStatusSchema.parse(await probe.check());

    const [call] = runner.calls;
    expect(call?.options.timeoutMs).toBe(750);
    expect(status.details).toMatchObject({ executionTimeoutMs: 750 });
  });

  it("returns ready details byte-identical to the pre-change codex slot on success", async () => {
    const runner = fakeProcessRunner(() => successfulProcessResult("codex-cli 0.42.0\n"));
    const probe = await createProbe(runner);

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(status.state).toBe("ready");
    expect(status.label).toBe("Codex judge");
    expect(status.retryable).toBe(false);
    expect(status.details).toEqual({
      adapter: "codex-cli",
      command: "codex",
      commandAvailable: true,
      version: "codex-cli 0.42.0",
      sandbox: "read-only",
      executionTimeoutMs,
    });
  });

  it("reports unavailable with commandAvailable false when the binary is missing", async () => {
    const runner = fakeProcessRunner(() =>
      failedProcessResult("process_failed", {
        message: "spawn codex ENOENT",
        details: { path: "/Users/nataly/.codex/bin/codex" },
      }),
    );
    const probe = await createProbe(runner);

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(status.state).toBe("unavailable");
    expect(status.retryable).toBe(true);
    expect(status.details).toEqual({
      adapter: "codex-cli",
      command: "codex",
      commandAvailable: false,
      sandbox: "read-only",
      executionTimeoutMs,
    });
  });

  it("treats a non-process failure as unavailable while keeping the command available", async () => {
    const runner = fakeProcessRunner(() =>
      failedProcessResult("nonzero_exit", { exitCode: 1 }),
    );
    const probe = await createProbe(runner);

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(status.state).toBe("unavailable");
    expect(status.details).toEqual({
      adapter: "codex-cli",
      command: "codex",
      commandAvailable: true,
      sandbox: "read-only",
      executionTimeoutMs,
    });
  });

  it("maps a timed-out probe to a retryable unavailable status", async () => {
    const runner = fakeProcessRunner(() =>
      failedProcessResult("request_timeout", { timedOut: true, retryable: true }),
    );
    const probe = await createProbe(runner);

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(status.state).toBe("unavailable");
    expect(status.retryable).toBe(true);
    expect(status.message).toMatch(/timed out/i);
  });

  it("drops a version string that matches the no-leak regex while staying ready", async () => {
    const runner = fakeProcessRunner(() =>
      successfulProcessResult("/Users/nataly/.codex/auth.json leaked\n"),
    );
    const probe = await createProbe(runner);

    const status = subsystemStatusSchema.parse(await probe.check());

    expect(status.state).toBe("ready");
    expect(status.details).not.toHaveProperty("version");
    expect(status.details).toEqual({
      adapter: "codex-cli",
      command: "codex",
      commandAvailable: true,
      sandbox: "read-only",
      executionTimeoutMs,
    });
  });
});

describe("engine readiness probe package surface", () => {
  it("re-exports CliReadinessProbe from the engine package entrypoint", async () => {
    const engineModule = (await import("../../index.js")) as Record<string, unknown>;

    expect(engineModule).toHaveProperty("CliReadinessProbe");
    expect(typeof engineModule.CliReadinessProbe).toBe("function");
  });

  it("no longer re-exports the codex-specific readiness probe class", async () => {
    const engineModule = (await import("../../index.js")) as Record<string, unknown>;

    expect(engineModule).not.toHaveProperty("CodexReadinessProbe");
  });
});
